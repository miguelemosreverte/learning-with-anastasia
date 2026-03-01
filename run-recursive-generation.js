#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const RecursiveImageGenerator = require('./automation/recursive-image-generator');
const ChapterBuilder = require('./automation/chapter-builder');
const ReportGenerator = require('./automation/report-generator');
const PromptArchiver = require('./automation/prompt-archiver');
const logger = require('./automation/logger');

/**
 * Parse CLI arguments.
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {
        chapter: null,
        list: false,
        listImages: false,
        regenerate: null,
        prompt: null
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--list') {
            parsed.list = true;
        } else if (args[i] === '--list-images') {
            parsed.listImages = true;
        } else if (args[i] === '--regenerate' && i + 1 < args.length) {
            parsed.regenerate = args[++i];
        } else if (args[i] === '--prompt' && i + 1 < args.length) {
            parsed.prompt = args[++i];
        } else if (!args[i].startsWith('--') && !parsed.chapter) {
            parsed.chapter = args[i];
        }
    }

    return parsed;
}

/**
 * List all images defined in a chapter YAML.
 */
function listChapterImages(chapterName) {
    const yamlPath = path.join(__dirname, 'chapters', `${chapterName}.yaml`);
    if (!fs.existsSync(yamlPath)) {
        console.error(`Chapter file not found: ${yamlPath}`);
        process.exit(1);
    }

    const chapterData = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
    const outputDir = path.join(__dirname, chapterName);
    const imageDir = path.join(outputDir, 'assets', 'images');

    console.log(`\nImages in chapter: ${chapterName}\n`);

    const allImages = [];

    // Hero image
    if (chapterData.hero && chapterData.hero.image) {
        allImages.push({ id: 'hero-section', image: chapterData.hero.image, type: 'hero' });
    }

    // Section images
    if (chapterData.sections) {
        chapterData.sections.forEach(s => {
            if (s.image) {
                allImages.push({
                    id: s.id,
                    image: s.image,
                    type: s.generate_character ? 'character' : 'scene',
                    character: s.generate_character ? true : false
                });
            }
        });
    }

    // Fun fact images
    if (chapterData.funFacts && chapterData.funFacts.facts) {
        chapterData.funFacts.facts.forEach((f, i) => {
            if (f.image) {
                allImages.push({ id: `fun-fact-${i}`, image: f.image, type: 'fun-fact' });
            }
        });
    }

    // Viewer detail images
    if (chapterData.viewerDetails) {
        chapterData.viewerDetails.forEach((d, i) => {
            if (d.image) {
                allImages.push({ id: `viewer-detail-${i}`, image: d.image, type: 'viewer-detail' });
            }
        });
    }

    allImages.forEach(img => {
        const imagePath = path.join(imageDir, img.image);
        const exists = fs.existsSync(imagePath);
        const status = exists ? 'EXISTS' : 'MISSING';
        const hasPromptMd = exists && PromptArchiver.read(imagePath) !== null;
        const promptIndicator = hasPromptMd ? ' [prompt archived]' : '';
        console.log(`  ${exists ? '  ' : '  '} [${img.type.padEnd(13)}] ${img.id.padEnd(25)} ${img.image.padEnd(40)} ${status}${promptIndicator}`);
    });

    console.log(`\nTotal: ${allImages.length} images`);
    const existing = allImages.filter(i => fs.existsSync(path.join(imageDir, i.image))).length;
    console.log(`Existing: ${existing}, Missing: ${allImages.length - existing}`);
}

/**
 * Regenerate a single image by section ID or filename.
 */
async function regenerateSingleImage(chapterName, imageIdentifier, customPrompt) {
    if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY) {
        console.error('Missing API keys! Set OPENAI_API_KEY and GEMINI_API_KEY.');
        process.exit(1);
    }

    const yamlPath = path.join(__dirname, 'chapters', `${chapterName}.yaml`);
    if (!fs.existsSync(yamlPath)) {
        console.error(`Chapter file not found: ${yamlPath}`);
        process.exit(1);
    }

    const chapterData = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
    const outputDir = path.join(__dirname, chapterName);
    const imageDir = path.join(outputDir, 'assets', 'images');

    // Find the target section by ID or filename
    let targetSection = null;

    // Check main sections
    if (chapterData.sections) {
        targetSection = chapterData.sections.find(s =>
            s.id === imageIdentifier ||
            s.image === imageIdentifier ||
            s.image === imageIdentifier + '.jpg' ||
            s.image === imageIdentifier + '.png'
        );
    }

    // Check hero
    if (!targetSection && chapterData.hero && chapterData.hero.image) {
        if (imageIdentifier === 'hero-section' || chapterData.hero.image.includes(imageIdentifier)) {
            targetSection = {
                id: 'hero-section',
                title: chapterData.hero.title,
                image: chapterData.hero.image,
                imageAlt: chapterData.hero.imageAlt,
                prompt: chapterData.hero.imageAlt?.en,
                isHero: true
            };
        }
    }

    if (!targetSection) {
        console.error(`Image not found: ${imageIdentifier}`);
        console.error('Use --list-images to see available images.');
        process.exit(1);
    }

    // Apply custom prompt if provided
    if (customPrompt) {
        targetSection.prompt = customPrompt;
        targetSection.action = customPrompt;
    }

    console.log(`\nRegenerating: ${targetSection.image} (${targetSection.id})`);

    const generator = new RecursiveImageGenerator();
    const report = new ReportGenerator(chapterName);

    // Load any existing character references
    if (chapterData.sections) {
        chapterData.sections.forEach(s => {
            const imgPath = path.join(imageDir, s.image);
            if (s.id !== targetSection.id && fs.existsSync(imgPath)) {
                generator.generatedImages[s.id] = imgPath;
                if (s.generate_character) {
                    generator.characters[s.id] = imgPath;
                }
            }
        });
    }

    // Resolve references for the target
    const allSections = chapterData.sections || [];
    const resolvedSection = generator.resolveReferences(targetSection, allSections);

    // Force regenerate
    const result = await generator.generateImage(resolvedSection, imageDir, true);

    if (result.success) {
        console.log(`\nRegenerated successfully: ${targetSection.image}`);

        // Rebuild HTML
        console.log('Rebuilding HTML...');
        const builder = new ChapterBuilder();
        await builder.buildChapter(yamlPath, outputDir);
        console.log('Done!');
    } else {
        console.error(`\nRegeneration failed: ${result.error}`);
        process.exit(1);
    }
}

/**
 * Full chapter generation with report.
 */
async function runRecursiveGeneration(chapterName) {
    if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY) {
        console.error('Missing API keys! Set OPENAI_API_KEY and GEMINI_API_KEY.');
        process.exit(1);
    }

    const chapter = chapterName || process.argv[2] || 'sea-otters';

    console.log(`\n🐻 Starting Recursive Chapter Generation: ${chapter}`);
    console.log('=' .repeat(60));

    const _logTaskId = logger.taskStart(`Image generation: ${chapter}`);

    const yamlPath = path.join(__dirname, 'chapters', `${chapter}.yaml`);
    const outputDir = path.join(__dirname, chapter);

    if (!fs.existsSync(yamlPath)) {
        console.error(`Chapter file not found: ${yamlPath}`);
        console.error('   Available chapters:');
        const chapters = fs.readdirSync(path.join(__dirname, 'chapters'))
            .filter(f => f.endsWith('.yaml'))
            .map(f => f.replace('.yaml', ''));
        chapters.forEach(c => console.error(`     - ${c}`));
        process.exit(1);
    }

    console.log(`📖 Loading chapter: ${yamlPath}`);
    console.log(`📁 Output directory: ${outputDir}`);

    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const chapterData = yaml.load(yamlContent);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const generator = new RecursiveImageGenerator();
    const report = new ReportGenerator(chapter);

    try {
        console.log('\n🎨 Starting image generation...');
        const results = await generator.processChapter(chapterData, outputDir, report);

        // Generate the report
        report.generate(outputDir);

        if (results.success > 0 || results.skipped > 0) {
            console.log('\n📄 Building HTML page...');
            const builder = new ChapterBuilder();
            await builder.buildChapter(yamlPath, outputDir);

            console.log('\n✅ Chapter generation complete!');
            console.log(`   View at: ${path.join(outputDir, 'index.html')}`);
            console.log(`   Report: ${path.join(outputDir, 'generation-report.md')}`);

            console.log('\n📖 To view the generated chapter:');
            console.log(`   open "${path.join(outputDir, 'index.html')}"`);

            logger.taskEnd(_logTaskId, {
                generated: results.success || 0,
                skipped: results.skipped || 0,
                failed: results.failed || 0
            });
        } else {
            logger.taskEnd(_logTaskId, { generated: 0, failed: true });
            console.error('\n❌ No images were generated successfully');
        }

    } catch (error) {
        // Still generate report on failure
        report.recordError(error.message);
        report.generate(outputDir);
        logger.taskEnd(_logTaskId, { error: error.message });
        console.error('\n❌ Generation failed:', error.message);
        process.exit(1);
    }
}

// Handle script execution
if (require.main === module) {
    const args = parseArgs();

    if (args.list) {
        const chapters = fs.readdirSync(path.join(__dirname, 'chapters'))
            .filter(f => f.endsWith('.yaml'))
            .map(f => f.replace('.yaml', ''));
        console.log('Available chapters:');
        chapters.forEach(c => console.log(`  - ${c}`));
        process.exit(0);
    }

    if (args.listImages) {
        if (!args.chapter) {
            console.error('Please specify a chapter: node run-recursive-generation.js <chapter> --list-images');
            process.exit(1);
        }
        listChapterImages(args.chapter);
        process.exit(0);
    }

    if (args.regenerate) {
        if (!args.chapter) {
            console.error('Please specify a chapter: node run-recursive-generation.js <chapter> --regenerate <image-id>');
            process.exit(1);
        }
        regenerateSingleImage(args.chapter, args.regenerate, args.prompt).catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
    } else {
        runRecursiveGeneration(args.chapter).catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
    }
}

module.exports = runRecursiveGeneration;
