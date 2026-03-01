#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const logger = require('./automation/logger');

const ROOT_DIR = __dirname;
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, 'pdfs');
const LANGUAGES = ['en', 'es', 'ru'];

// A4 aspect ratio: 297mm / 210mm
const A4_ASPECT = 297 / 210;
// Search flexibility for finding safe cut points (in screenshot pixels, at 2x DPI)
// 800px at 2x = 400 CSS pixels — enough room to skip past a typical image
const CUT_FLEXIBILITY = 800;

function parseArgs(argv) {
    const args = { chapter: null, lang: 'en', allLangs: false, outputDir: DEFAULT_OUTPUT_DIR };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--lang' && argv[i + 1]) { args.lang = argv[++i]; }
        else if (arg === '--all-langs') { args.allLangs = true; }
        else if (arg === '--output' && argv[i + 1]) { args.outputDir = argv[++i]; }
        else if (arg === '--help') {
            console.log(`
Usage: node generate-pdf.js [chapter] [options]

Arguments:
  chapter              Chapter folder name (e.g., "beavers", "bears")
                       If omitted, generates for ALL chapters

Options:
  --lang <code>        Language: en, es, ru (default: en)
  --all-langs          Generate PDFs for all languages
  --output <dir>       Output directory (default: ./pdfs/)
  --help               Show this help

Examples:
  node generate-pdf.js bears
  node generate-pdf.js bears --lang ru
  node generate-pdf.js bears --all-langs
  node generate-pdf.js                    # All chapters, English
`);
            process.exit(0);
        }
        else if (!arg.startsWith('-')) { args.chapter = arg; }
    }
    return args;
}

function discoverChapters() {
    return fs.readdirSync(ROOT_DIR).filter(name => {
        if (name === 'node_modules' || name === 'pdfs' || name.startsWith('.')) return false;
        const htmlPath = path.join(ROOT_DIR, name, 'index.html');
        return fs.existsSync(htmlPath);
    });
}

/**
 * Calculate A4 page height in pixels based on image width
 */
function calculatePageHeight(imageWidth) {
    return Math.round(imageWidth * A4_ASPECT);
}

/**
 * Prepare the page for screenshot: render all sections, resolve images, switch language
 */
async function preparePage(page, htmlPath, lang) {
    const fileUrl = `file://${htmlPath}`;

    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });

    // BEFORE navigating: inject script that blocks VirtualRenderer's scroll listener
    // from being registered. evaluateOnNewDocument runs before any page scripts,
    // so the VirtualRenderer's window.addEventListener('scroll', ...) becomes a no-op.
    await page.evaluateOnNewDocument(() => {
        const origAddEventListener = window.addEventListener.bind(window);
        window.addEventListener = function(type, handler, options) {
            if (type === 'scroll') return; // Block scroll listeners on window
            return origAddEventListener(type, handler, options);
        };
    });

    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 60000 });

    // IMMEDIATELY disable all animations, transitions, and lazy-loading effects.
    // This must happen before anything else to prevent partial animations in screenshots.
    await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = `
            *, *::before, *::after {
                transition: none !important;
                animation: none !important;
                animation-delay: 0s !important;
                transition-delay: 0s !important;
            }
            /* Force all images to fully visible, no blur, no scale, no borders */
            img {
                opacity: 1 !important;
                filter: none !important;
                transform: none !important;
                border: none !important;
                outline: none !important;
            }
            /* Hide inactive languages */
            [data-lang]:not(.active):not(.lang-btn) {
                display: none !important;
            }
        `;
        document.head.appendChild(style);

        // Kill all IntersectionObservers to prevent lazy-loading from firing during scroll
        if (window.IntersectionObserver) {
            const origIO = window.IntersectionObserver;
            window.IntersectionObserver = function() {
                return { observe() {}, unobserve() {}, disconnect() {} };
            };
        }

        // Hide language switcher
        const switcher = document.querySelector('.language-switcher');
        if (switcher) switcher.style.display = 'none';
    });

    // Force-render all virtualized sections.
    // The VirtualRenderer's initial updateVisibleSections() ran during page load
    // and only rendered sections near the 800px viewport. We re-render ALL sections.
    // Since the scroll listener was blocked above, nothing can unrender them.
    await page.evaluate(() => {
        document.querySelectorAll('.content-section').forEach(section => {
            if (section.dataset.originalHtml && section.dataset.rendered === 'false') {
                section.innerHTML = section.dataset.originalHtml;
                section.dataset.rendered = 'true';
            }
        });
    });

    // Resolve lazy-loaded images: data-src → src, remove all lazy-loading classes
    await page.evaluate(() => {
        document.querySelectorAll('img[data-src]').forEach(img => {
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
            img.removeAttribute('loading');
        });
        document.querySelectorAll('img[loading="lazy"]').forEach(img => {
            img.removeAttribute('loading');
        });
        // Force all images to their final loaded state
        document.querySelectorAll('img').forEach(img => {
            img.classList.remove('lazy-placeholder');
            img.classList.add('lazy-loaded');
            img.style.opacity = '1';
            img.style.filter = 'none';
            img.style.transform = 'none';
            img.style.animation = 'none';
        });
    });

    // Activate target language
    await page.evaluate((lang) => {
        document.querySelectorAll('[data-lang]').forEach(el => {
            if (!el.classList.contains('lang-btn')) {
                el.classList.remove('active');
            }
        });
        document.querySelectorAll(`[data-lang="${lang}"]`).forEach(el => {
            if (!el.classList.contains('lang-btn')) {
                el.classList.add('active');
            }
        });
        document.querySelectorAll('img').forEach(img => {
            const alt = img.getAttribute(`data-alt-${lang}`);
            if (alt) img.alt = alt;
        });
    }, lang);

    // Wait for all images to fully load
    await page.evaluate(() => {
        return Promise.all(
            Array.from(document.querySelectorAll('img')).map(img => {
                if (img.complete && img.naturalHeight > 0) return Promise.resolve();
                return new Promise(resolve => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', resolve);
                    setTimeout(resolve, 10000);
                });
            })
        );
    });

    // Wait for fonts to be ready
    await page.evaluate(() => document.fonts.ready);

    // Allow all images and layout to fully settle
    await new Promise(r => setTimeout(r, 1500));
}

/**
 * Take a full-page screenshot by scrolling through the page in viewport-sized
 * segments and stitching raw pixel data. This avoids Chromium's ~16384px GPU
 * texture limit which causes content to wrap in single fullPage screenshots.
 *
 * Key design choices:
 * - Viewport stays at original 1200x800 to preserve CSS layout exactly
 * - Raw pixel concatenation (no Sharp composite) avoids alpha/color artifacts
 * - VirtualRenderer scroll listener is already blocked via evaluateOnNewDocument
 */
async function captureFullPage(page) {
    const dimensions = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight
    }));

    const scale = 2;
    const vpWidth = 1200;
    const vpHeight = 800; // Keep original viewport to preserve layout
    const pixelWidth = vpWidth * scale;
    const pixelVPHeight = vpHeight * scale;
    const totalPixelHeight = Math.round(dimensions.height * scale);

    // Ensure viewport matches what was used during page load
    await page.setViewport({ width: vpWidth, height: vpHeight, deviceScaleFactor: scale });
    await new Promise(r => setTimeout(r, 100));

    const rawChunks = [];
    let pixelsCaptured = 0;
    let cssY = 0;

    while (pixelsCaptured < totalPixelHeight) {
        await page.evaluate(y => window.scrollTo(0, y), cssY);
        await new Promise(r => setTimeout(r, 150));

        // Browser may not scroll as far as requested near the bottom
        const actualCSSY = await page.evaluate(() => window.scrollY);

        const buf = await page.screenshot({ type: 'png' });

        // Screenshot covers actualCSSY → actualCSSY + vpHeight in CSS coords.
        // We want content starting from cssY, so skip any overlap at the top.
        const topSkipPx = Math.round((cssY - actualCSSY) * scale);
        const remainingPx = totalPixelHeight - pixelsCaptured;
        const availablePx = pixelVPHeight - topSkipPx;
        const usePx = Math.min(availablePx, remainingPx);

        if (usePx <= 0) break;

        // Extract raw pixel data for the usable portion (no compositing, no alpha blending)
        const { data } = await sharp(buf)
            .extract({ left: 0, top: topSkipPx, width: pixelWidth, height: usePx })
            .raw()
            .toBuffer({ resolveWithObject: true });

        rawChunks.push(data);
        pixelsCaptured += usePx;
        cssY += usePx / scale;
    }

    // Build final image from concatenated raw pixel data (pixel-perfect, no compositing)
    const fullRaw = Buffer.concat(rawChunks);
    const channels = Math.round(fullRaw.length / (pixelWidth * pixelsCaptured));

    const buffer = await sharp(fullRaw, {
        raw: { width: pixelWidth, height: pixelsCaptured, channels }
    }).png().toBuffer();

    return { buffer, width: pixelWidth, height: pixelsCaptured };
}

/**
 * Find the row with lowest luminance variance in a horizontal band.
 * Low variance = uniform background color = safe place to cut.
 * Returns { row, variance } so callers can decide if the cut is clean enough.
 */
async function findMostUniformRow(screenshotBuffer, imageWidth, searchStart, searchEnd) {
    const bandHeight = searchEnd - searchStart;
    if (bandHeight <= 0) return { row: searchStart, variance: Infinity };

    const { data, info } = await sharp(screenshotBuffer)
        .extract({ left: 0, top: searchStart, width: imageWidth, height: bandHeight })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const bytesPerRow = imageWidth * channels;

    let bestRow = 0;
    let bestScore = Infinity;

    for (let row = 0; row < bandHeight; row++) {
        const rowOffset = row * bytesPerRow;

        // Sample every 10th pixel for speed
        const samples = [];
        for (let x = 0; x < imageWidth; x += 10) {
            const pixelOffset = rowOffset + (x * channels);
            const r = data[pixelOffset];
            const g = data[pixelOffset + 1];
            const b = data[pixelOffset + 2];
            samples.push(0.299 * r + 0.587 * g + 0.114 * b);
        }

        const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
        const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;

        if (variance < bestScore) {
            bestScore = variance;
            bestRow = row;
        }
    }

    return { row: searchStart + bestRow, variance: bestScore };
}

/**
 * Find optimal page cut points throughout the screenshot.
 * Uses progressive search: if the standard range lands inside an image
 * (high variance), widens the search up to 3x to find a clean gap.
 */
async function findSafeCutPoints(screenshotBuffer, imageWidth, imageHeight) {
    const pageHeight = calculatePageHeight(imageWidth);
    // Minimum page height to prevent tiny pages (40% of full A4 height)
    const minPageHeight = Math.round(pageHeight * 0.4);
    const cutPoints = [0];
    let currentY = 0;

    while (currentY + pageHeight < imageHeight) {
        const targetY = currentY + pageHeight;

        // Progressively widen search until we find a clean cut (low variance)
        let bestCut = targetY;
        let bestVariance = Infinity;
        const maxFlexibility = CUT_FLEXIBILITY * 3;

        for (let flex = CUT_FLEXIBILITY; flex <= maxFlexibility; flex += CUT_FLEXIBILITY) {
            const searchStart = Math.max(targetY - flex, currentY + minPageHeight);
            const searchEnd = Math.min(targetY + flex, imageHeight - 100);

            if (searchStart >= searchEnd) break;

            const { row, variance } = await findMostUniformRow(screenshotBuffer, imageWidth, searchStart, searchEnd);

            if (variance < bestVariance) {
                bestVariance = variance;
                bestCut = row;
            }

            // Variance < 50 means a very uniform row (solid background) — good enough
            if (bestVariance < 50) break;
        }

        cutPoints.push(bestCut);
        currentY = bestCut;
    }

    cutPoints.push(imageHeight);
    return cutPoints;
}

/**
 * Sample the background color from a specific row in the screenshot.
 * Used at cut points (which have near-zero variance = uniform color).
 */
async function sampleRowColor(screenshotBuffer, imageWidth, y) {
    const { data } = await sharp(screenshotBuffer)
        .extract({ left: 0, top: y, width: imageWidth, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Average the center pixels to get the background color
    const channels = data.length / imageWidth;
    const mid = Math.floor(imageWidth / 2);
    const offset = mid * channels;
    return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
}

/**
 * Extract page-sized image chunks from the full screenshot
 */
async function extractPageImages(screenshotBuffer, cutPoints, imageWidth, imageHeight) {
    const pageHeight = calculatePageHeight(imageWidth);
    const pages = [];

    for (let i = 0; i < cutPoints.length - 1; i++) {
        const top = cutPoints[i];
        const bottom = cutPoints[i + 1];
        const chunkHeight = bottom - top;

        let pageBuffer = await sharp(screenshotBuffer)
            .extract({ left: 0, top, width: imageWidth, height: chunkHeight })
            .toBuffer();

        // Pad short pages to full A4 height, using the actual background color
        // from the bottom edge of this page chunk (the cut point row)
        if (chunkHeight < pageHeight) {
            const bgColor = await sampleRowColor(screenshotBuffer, imageWidth, Math.min(bottom - 1, imageHeight - 1));
            pageBuffer = await sharp(pageBuffer)
                .extend({
                    top: 0,
                    bottom: pageHeight - chunkHeight,
                    left: 0,
                    right: 0,
                    background: bgColor
                })
                .toBuffer();
        }

        // Compress to JPEG for smaller file size
        pageBuffer = await sharp(pageBuffer)
            .jpeg({ quality: 90, mozjpeg: true })
            .toBuffer();

        pages.push(pageBuffer);
    }

    return pages;
}

/**
 * Assemble page images into a final PDF using Puppeteer
 */
async function assemblePDF(browser, pageImages, outputPath) {
    const page = await browser.newPage();

    const imgTags = pageImages.map((buf, i) => {
        const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`;
        return `
            <div class="pdf-page" ${i > 0 ? 'style="page-break-before: always;"' : ''}>
                <img src="${dataUri}" />
                <div class="page-number">${i + 1} / ${pageImages.length}</div>
            </div>
        `;
    }).join('\n');

    const html = `<!DOCTYPE html>
    <html>
    <head>
        <style>
            @page { size: A4 portrait; margin: 0; }
            * { margin: 0; padding: 0; }
            body { margin: 0; }
            .pdf-page {
                width: 210mm;
                height: 297mm;
                position: relative;
                overflow: hidden;
            }
            .pdf-page img {
                width: 100%;
                height: 100%;
                display: block;
                object-fit: fill;
            }
            .page-number {
                position: absolute;
                bottom: 5mm;
                left: 0;
                right: 0;
                text-align: center;
                font-family: 'Source Sans Pro', Arial, sans-serif;
                font-size: 9pt;
                color: rgba(150, 150, 150, 0.7);
            }
        </style>
    </head>
    <body>
        ${imgTags}
    </body>
    </html>`;

    await page.setContent(html, { waitUntil: 'networkidle0' });

    await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    await page.close();
}

/**
 * Main PDF generation pipeline for a single chapter+language
 */
async function generatePDF(browser, chapterName, lang, options) {
    const htmlPath = path.join(ROOT_DIR, chapterName, 'index.html');
    if (!fs.existsSync(htmlPath)) {
        console.error(`  Not found: ${htmlPath}`);
        return null;
    }

    const page = await browser.newPage();

    // Step 1: Prepare the page (render, load images, switch language)
    await preparePage(page, htmlPath, lang);

    // Step 2: Full-page screenshot
    const screenshot = await captureFullPage(page);
    // Debug: save screenshot to inspect
    const debugPath = path.join(options.outputDir, `${chapterName}-${lang}-debug.png`);
    fs.writeFileSync(debugPath, screenshot.buffer);
    console.log(`\n   Debug screenshot: ${screenshot.width}x${screenshot.height}px → ${debugPath}`);
    await page.close();

    // Step 3: Find safe cut points
    const cutPoints = await findSafeCutPoints(screenshot.buffer, screenshot.width, screenshot.height);

    // Step 4: Extract page images
    const pageImages = await extractPageImages(screenshot.buffer, cutPoints, screenshot.width, screenshot.height);

    // Step 5: Assemble PDF
    const outputPath = path.join(options.outputDir, `${chapterName}-${lang}.pdf`);
    await assemblePDF(browser, pageImages, outputPath);

    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

    return { path: outputPath, size: sizeMB, pages: pageImages.length };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const chapters = args.chapter ? [args.chapter] : discoverChapters();
    const languages = args.allLangs ? LANGUAGES : [args.lang];

    for (const ch of chapters) {
        const htmlPath = path.join(ROOT_DIR, ch, 'index.html');
        if (!fs.existsSync(htmlPath)) {
            console.error(`Chapter "${ch}" not found (no ${ch}/index.html)`);
            console.error('   Available chapters:', discoverChapters().join(', '));
            process.exit(1);
        }
    }

    if (!fs.existsSync(args.outputDir)) {
        fs.mkdirSync(args.outputDir, { recursive: true });
    }

    const _logTaskId = logger.taskStart(`PDF generation: ${chapters.join(', ')} [${languages.join(', ')}]`);

    console.log('\n📄 PDF Generation Tool (Screenshot Mode)');
    console.log('='.repeat(50));
    console.log(`   Chapters:  ${chapters.join(', ')}`);
    console.log(`   Languages: ${languages.join(', ')}`);
    console.log(`   Mode:      Pixel-perfect screenshot → A4 pages`);
    console.log(`   Output:    ${args.outputDir}`);
    console.log();

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files']
    });

    const results = [];

    for (const chapter of chapters) {
        for (const lang of languages) {
            const langName = { en: 'English', es: 'Spanish', ru: 'Russian' }[lang] || lang;
            process.stdout.write(`   📖 ${chapter} [${langName}]... `);
            try {
                const result = await generatePDF(browser, chapter, lang, args);
                if (result) {
                    console.log(`✅ ${result.pages} pages, ${result.size} MB`);
                    results.push(result);
                }
            } catch (err) {
                console.log(`❌ ${err.message}`);
            }
        }
    }

    await browser.close();

    const totalPages = results.reduce((sum, r) => sum + r.pages, 0);
    logger.taskEnd(_logTaskId, { files: results.length, pages: totalPages });

    console.log(`\n✨ Done! Generated ${results.length} PDF(s)`);
    results.forEach(r => console.log(`   📄 ${r.path}`));
    console.log();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
