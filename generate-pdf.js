#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT_DIR = __dirname;
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, 'pdfs');
const LANGUAGES = ['en', 'es', 'ru'];

function parseArgs(argv) {
    const args = { chapter: null, lang: 'en', allLangs: false, size: 'A4', landscape: false, outputDir: DEFAULT_OUTPUT_DIR, density: 2 };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--lang' && argv[i + 1]) { args.lang = argv[++i]; }
        else if (arg === '--all-langs') { args.allLangs = true; }
        else if (arg === '--size' && argv[i + 1]) { args.size = argv[++i]; }
        else if (arg === '--landscape') { args.landscape = true; }
        else if (arg === '--output' && argv[i + 1]) { args.outputDir = argv[++i]; }
        else if (arg === '--density' && argv[i + 1]) { args.density = parseInt(argv[++i], 10); }
        else if (arg === '--help') {
            console.log(`
Usage: node generate-pdf.js [chapter] [options]

Arguments:
  chapter              Chapter folder name (e.g., "beavers", "bears")
                       If omitted, generates for ALL chapters

Options:
  --density <n>        Sections per page: 1, 2, or 4 (default: 2)
  --lang <code>        Language: en, es, ru (default: en)
  --all-langs          Generate PDFs for all languages
  --size <format>      Page size: A4, Letter (default: A4)
  --landscape          Landscape orientation (default: portrait)
  --output <dir>       Output directory (default: ./pdfs/)
  --help               Show this help

Examples:
  node generate-pdf.js beavers
  node generate-pdf.js beavers --density 1    # Large images, 1 section/page
  node generate-pdf.js beavers --density 4    # Compact, 4 sections/page
  node generate-pdf.js beavers --lang es
  node generate-pdf.js beavers --all-langs
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

// Density presets: sizing values for 1, 2, or 4 sections per page
const DENSITY_PRESETS = {
    1: {
        sectionMargin: '20px',
        sectionPadding: '20px',
        sectionGap: '25px',
        imageMaxHeight: '400px',
        headingSize: '1.8rem',
        headingMargin: '10px',
        bodySize: '1.05rem',
        bodyLineHeight: '1.6',
        factGridCols: '250px 1fr',
        factGap: '20px',
        factImgHeight: '200px',
        factTitleSize: '1.2rem',
        factBodySize: '0.95rem',
        headerPadding: '30px',
        headerH1Size: '2.4rem',
    },
    2: {
        sectionMargin: '5px',
        sectionPadding: '5px',
        sectionGap: '10px',
        imageMaxHeight: '440px',
        headingSize: '1.3rem',
        headingMargin: '5px',
        bodySize: '0.85rem',
        bodyLineHeight: '1.4',
        factGridCols: '300px 1fr',
        factGap: '12px',
        factImgHeight: '250px',
        factTitleSize: '1rem',
        factBodySize: '0.8rem',
        headerPadding: '15px',
        headerH1Size: '2rem',
    },
    4: {
        sectionMargin: '6px',
        sectionPadding: '8px',
        sectionGap: '12px',
        imageMaxHeight: '180px',
        headingSize: '1.2rem',
        headingMargin: '4px',
        bodySize: '0.78rem',
        bodyLineHeight: '1.4',
        factGridCols: '160px 1fr',
        factGap: '10px',
        factImgHeight: '120px',
        factTitleSize: '0.95rem',
        factBodySize: '0.75rem',
        headerPadding: '15px',
        headerH1Size: '1.7rem',
    },
};

function getPrintCSS(density) {
    // Snap to nearest valid density
    const validDensity = density <= 1 ? 1 : density <= 2 ? 2 : 4;
    const d = DENSITY_PRESETS[validDensity];

    return `
        @page {
            size: A4 portrait;
            margin: 10mm 10mm 15mm 10mm;
        }

        /* Hide web-only elements */
        .language-switcher {
            display: none !important;
        }

        /* Reset body for print */
        body {
            background: white !important;
            overflow: visible !important;
            max-width: none !important;
            position: static !important;
        }

        .main-wrapper {
            overflow: visible !important;
            max-width: none !important;
        }

        /* Remove all transitions and animations */
        * {
            transition: none !important;
            animation: none !important;
        }

        /* === HEADER === */
        .header {
            padding: ${d.headerPadding} 0 !important;
        }

        .header h1 {
            font-size: ${d.headerH1Size} !important;
        }

        /* === HERO SECTION — always its own page === */
        .hero-section {
            height: 500px !important;
            max-height: 500px !important;
            break-after: page !important;
            page-break-after: always !important;
        }

        /* === CONTENT SECTIONS — side-by-side grid, never split === */
        .content-section {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: ${d.sectionGap} !important;
            align-items: center !important;
            direction: ltr !important;
            margin: ${d.sectionMargin} auto !important;
            padding: ${d.sectionPadding} !important;
            max-width: 100% !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }

        .content-section:nth-child(even) {
            direction: rtl !important;
        }

        /* Image containers */
        .image-container {
            max-width: 100% !important;
            overflow: hidden !important;
            margin-bottom: 0 !important;
            box-shadow: none !important;
            border-radius: 8px !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            display: flex !important;
            align-items: center !important;
        }

        .image-container img {
            max-height: ${d.imageMaxHeight} !important;
            width: 100% !important;
            height: auto !important;
            object-fit: cover !important;
            border-radius: 8px !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }

        /* Text content */
        .text-content {
            padding: 0 !important;
            direction: ltr !important;
        }

        .text-content h2 {
            font-size: ${d.headingSize} !important;
            margin-bottom: ${d.headingMargin} !important;
        }

        .text-content p {
            font-size: ${d.bodySize} !important;
            line-height: ${d.bodyLineHeight} !important;
        }

        p {
            orphans: 3 !important;
            widows: 3 !important;
        }

        /* === FUN FACTS SECTION === */
        .fun-facts-section {
            background: #f5f5f5 !important;
            padding: ${d.sectionPadding} !important;
        }

        .fun-facts-section h2,
        .fun-facts-section .section-title {
            color: #333 !important;
            font-size: ${d.headingSize} !important;
            margin-bottom: ${d.headingMargin} !important;
        }

        .fact-card {
            display: grid !important;
            grid-template-columns: ${d.factGridCols} !important;
            gap: ${d.factGap} !important;
            align-items: center !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin-bottom: ${d.sectionMargin} !important;
            box-shadow: none !important;
            border: 1px solid #ddd !important;
            padding: ${d.sectionPadding} !important;
            border-radius: 6px !important;
        }

        .fact-card-image {
            max-height: ${d.factImgHeight} !important;
            width: 100% !important;
            height: auto !important;
            object-fit: cover !important;
            border-radius: 6px !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }

        .fact-card-content {
            padding: 0 !important;
        }

        .fact-card-content h3 {
            font-size: ${d.factTitleSize} !important;
            margin-bottom: 4px !important;
        }

        .fact-card-content p {
            font-size: ${d.factBodySize} !important;
            line-height: ${d.bodyLineHeight} !important;
        }

        /* === VIEWER DETAILS === */
        .viewer-details {
            padding: ${d.sectionPadding} !important;
        }

        .viewer-details h2 {
            font-size: ${d.headingSize} !important;
            margin-bottom: ${d.headingMargin} !important;
        }

        .detail-card {
            display: grid !important;
            grid-template-columns: ${d.factGridCols} !important;
            gap: ${d.factGap} !important;
            align-items: center !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin-bottom: ${d.sectionMargin} !important;
            box-shadow: none !important;
            border: 1px solid #ddd !important;
            padding: ${d.sectionPadding} !important;
            border-radius: 6px !important;
        }

        .detail-card img {
            max-height: ${d.factImgHeight} !important;
            width: 100% !important;
            height: auto !important;
            object-fit: cover !important;
            border-radius: 6px !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }

        .detail-card h3 {
            font-size: ${d.factTitleSize} !important;
            margin-bottom: 4px !important;
        }

        .detail-card p {
            font-size: ${d.factBodySize} !important;
            line-height: ${d.bodyLineHeight} !important;
        }

        /* === ACTION SEQUENCES === */
        .content-section.action-sequence {
            border-left: 3px solid #FFCC00 !important;
            background: transparent !important;
            padding-left: ${d.sectionPadding} !important;
            max-width: 100% !important;
        }

        /* === FOOTER === */
        .footer {
            break-before: avoid !important;
            margin-top: 10px !important;
            padding: 15px 0 !important;
        }

        /* Remove hover effects */
        .content-section:hover .image-container img,
        .image-container:hover img,
        .fact-card:hover,
        .detail-card:hover {
            transform: none !important;
        }

        /* Hide inactive languages — no leftover space */
        [data-lang]:not(.active):not(.lang-btn) {
            display: none !important;
            height: 0 !important;
            overflow: hidden !important;
        }

        /* Preface section */
        .preface-section {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }
    `;
}

async function generatePDF(browser, chapterName, lang, options) {
    const htmlPath = path.join(ROOT_DIR, chapterName, 'index.html');

    if (!fs.existsSync(htmlPath)) {
        console.error(`  ❌ Not found: ${htmlPath}`);
        return null;
    }

    const fileUrl = `file://${htmlPath}`;
    const page = await browser.newPage();

    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 60000 });

    // Force-render all virtualized sections (VirtualRenderer hides off-screen ones)
    await page.evaluate(() => {
        document.querySelectorAll('.content-section').forEach(section => {
            if (section.dataset.originalHtml && section.dataset.rendered === 'false') {
                section.innerHTML = section.dataset.originalHtml;
                section.dataset.rendered = 'true';
            }
        });
    });

    // Resolve lazy-loaded images
    await page.evaluate(() => {
        document.querySelectorAll('img[data-src]').forEach(img => {
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
            img.removeAttribute('loading');
        });
        document.querySelectorAll('img[loading="lazy"]').forEach(img => {
            img.removeAttribute('loading');
        });
    });

    // Activate target language across ALL elements (header, hero, content, facts, details, footer)
    await page.evaluate((lang) => {
        // Remove active from ALL data-lang elements (except language buttons)
        document.querySelectorAll('[data-lang]').forEach(el => {
            if (!el.classList.contains('lang-btn')) {
                el.classList.remove('active');
            }
        });
        // Add active to the target language everywhere
        document.querySelectorAll(`[data-lang="${lang}"]`).forEach(el => {
            if (!el.classList.contains('lang-btn')) {
                el.classList.add('active');
            }
        });
        // Update image alt texts
        document.querySelectorAll('img').forEach(img => {
            const alt = img.getAttribute(`data-alt-${lang}`);
            if (alt) img.alt = alt;
        });
    }, lang);

    // Wait for all images to load
    await page.evaluate(() => {
        return Promise.all(
            Array.from(document.querySelectorAll('img')).map(img => {
                if (img.complete && img.naturalHeight > 0) return Promise.resolve();
                return new Promise(resolve => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', resolve);
                    setTimeout(resolve, 5000);
                });
            })
        );
    });

    // Inject print CSS with density setting
    await page.addStyleTag({ content: getPrintCSS(options.density) });

    // Brief pause for CSS reflow
    await new Promise(r => setTimeout(r, 800));

    // Generate PDF
    const outputPath = path.join(options.outputDir, `${chapterName}-${lang}.pdf`);
    await page.pdf({
        path: outputPath,
        format: options.size || 'A4',
        landscape: options.landscape || false,
        printBackground: true,
        preferCSSPageSize: false,
        margin: { top: '10mm', bottom: '15mm', left: '10mm', right: '10mm' },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: `
            <div style="font-size: 9px; color: #999; text-align: center; width: 100%; padding: 5px 0;">
                <span class="pageNumber"></span> / <span class="totalPages"></span>
            </div>
        `,
    });

    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

    await page.close();
    return { path: outputPath, size: sizeMB };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const chapters = args.chapter ? [args.chapter] : discoverChapters();
    const languages = args.allLangs ? LANGUAGES : [args.lang];

    for (const ch of chapters) {
        const htmlPath = path.join(ROOT_DIR, ch, 'index.html');
        if (!fs.existsSync(htmlPath)) {
            console.error(`❌ Chapter "${ch}" not found (no ${ch}/index.html)`);
            console.error('   Available chapters:', discoverChapters().join(', '));
            process.exit(1);
        }
    }

    if (!fs.existsSync(args.outputDir)) {
        fs.mkdirSync(args.outputDir, { recursive: true });
    }

    const densityLabel = { 1: 'spacious (1/page)', 2: 'balanced (2/page)', 4: 'compact (4/page)' };

    console.log('\n📄 PDF Generation Tool');
    console.log('='.repeat(50));
    console.log(`   Chapters:  ${chapters.join(', ')}`);
    console.log(`   Languages: ${languages.join(', ')}`);
    console.log(`   Density:   ${densityLabel[args.density] || args.density + '/page'}`);
    console.log(`   Page size: ${args.size} ${args.landscape ? 'landscape' : 'portrait'}`);
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
                    console.log(`✅ ${result.size} MB`);
                    results.push(result);
                }
            } catch (err) {
                console.log(`❌ ${err.message}`);
            }
        }
    }

    await browser.close();

    console.log(`\n✨ Done! Generated ${results.length} PDF(s)`);
    results.forEach(r => console.log(`   📄 ${r.path}`));
    console.log();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
