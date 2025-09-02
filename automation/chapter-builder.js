const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Handlebars = require('handlebars');

class ChapterBuilder {
    constructor() {
        // Load the template - using the fixed version
        const templatePath = path.join(__dirname, '../templates/chapter-template-fixed.hbs');
        const templateSource = fs.readFileSync(templatePath, 'utf8');
        this.template = Handlebars.compile(templateSource);
    }

    /**
     * Load and parse a YAML chapter definition
     */
    loadChapterDefinition(yamlPath) {
        console.log(`📖 Loading chapter definition: ${yamlPath}`);
        const yamlContent = fs.readFileSync(yamlPath, 'utf8');
        const chapterData = yaml.load(yamlContent);
        
        // Filter out hidden sections and add generated keys for visible sections
        chapterData.sections = chapterData.sections
            .filter(section => !section.hidden)  // Exclude hidden sections from main content
            .map((section, index) => {
                if (!section.titleKey) {
                    section.titleKey = `section${index}Title`;
                }
                if (!section.contentKey) {
                    section.contentKey = `section${index}Content`;
                }
                if (!section.imageAltKey) {
                    section.imageAltKey = `section${index}ImageAlt`;
                }
                
                // Mark if this image will have translations
                section.hasTranslations = this.needsTranslatedVersions(section);
                
                // Mark action sequences (sub-parts of a scene)
                section.isActionSequence = this.isActionSequence(section.id);
                
                return section;
            });

        // Process fun facts
        if (chapterData.funFacts && chapterData.funFacts.facts) {
            chapterData.funFacts.facts = chapterData.funFacts.facts.map((fact, index) => {
                if (!fact.key) {
                    fact.key = `funFact${index + 1}`;
                }
                return fact;
            });
        }

        return chapterData;
    }

    /**
     * Determine if a section is part of an action sequence
     */
    isActionSequence(sectionId) {
        // Action sequences are sub-parts of scenes with specific patterns
        const actionPatterns = [
            // Grooming sequence
            'grooming-preparation', 'grooming-deep-clean', 'grooming-complete',
            // Marina meeting sequence
            'marina-first-glimpse', 'marina-introduction', 'marina-playing-together',
            // Ruby teaching sequence
            'ruby-teaching-basics', 'ruby-practicing', 'ruby-success',
            // First floating sequence
            'first-floating-attempt', 'first-floating-struggle', 'first-floating-success',
            // Any section with these suffixes
            '-attempt', '-struggle', '-success',
            '-preparation', '-practicing', '-complete',
            '-first-glimpse', '-introduction', '-together'
        ];
        
        return actionPatterns.some(pattern => {
            if (pattern.startsWith('-')) {
                // Suffix pattern
                return sectionId && sectionId.endsWith(pattern);
            } else {
                // Exact match
                return sectionId === pattern;
            }
        });
    }

    /**
     * Determine if an image needs translated versions
     */
    needsTranslatedVersions(section) {
        // Images that typically need text and thus translations
        const textRequiredTypes = ['diagram', 'chart', 'map', 'comparison'];
        
        if (section.imageType && textRequiredTypes.includes(section.imageType)) {
            return true;
        }
        
        // Check if the image alt text mentions labels or text
        const altText = section.imageAlt?.en || '';
        const textIndicators = ['label', 'text', 'diagram', 'chart', 'map', 'comparison'];
        
        return textIndicators.some(indicator => 
            altText.toLowerCase().includes(indicator)
        );
    }

    /**
     * Generate HTML from chapter data
     */
    generateHTML(chapterData) {
        console.log(`🎨 Generating HTML for: ${chapterData.meta.title.en}`);
        
        // Debug: Check if viewerDetails exists
        if (chapterData.viewerDetails) {
            console.log(`   ✓ Found ${chapterData.viewerDetails.length} viewer details`);
        } else {
            console.log(`   ✗ No viewer details found`);
        }
        
        // Generate the HTML using the template
        const html = this.template(chapterData);
        
        return html;
    }

    /**
     * Save the generated HTML to a file
     */
    saveHTML(html, outputPath) {
        // Create directory if it doesn't exist
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(outputPath, html);
        console.log(`✅ HTML saved to: ${outputPath}`);
    }

    /**
     * Get list of images that need to be generated
     */
    getImageList(chapterData) {
        const images = [];
        
        // Hero image
        if (chapterData.hero && chapterData.hero.image) {
            images.push({
                filename: chapterData.hero.image,
                type: chapterData.hero.imageType || 'landscape',
                alt: chapterData.hero.imageAlt,
                reference: chapterData.hero.referenceImage
            });
        }
        
        // Section images
        chapterData.sections.forEach(section => {
            if (section.image) {
                images.push({
                    filename: section.image,
                    type: section.imageType || 'content',
                    alt: section.imageAlt,
                    reference: section.referenceImage,
                    needsTranslations: section.hasTranslations
                });
            }
        });
        
        return images;
    }

    /**
     * Build a complete chapter from YAML
     */
    async buildChapter(yamlPath, outputDir) {
        console.log('\n🚀 Starting Chapter Build Process');
        console.log('=' .repeat(50));
        
        try {
            // Load and parse YAML
            const chapterData = this.loadChapterDefinition(yamlPath);
            
            // Generate HTML
            const html = this.generateHTML(chapterData);
            
            // Determine output path - output directly to the outputDir
            const outputPath = path.join(outputDir, 'index.html');
            
            // Save HTML
            this.saveHTML(html, outputPath);
            
            // Get list of images to generate
            const imageList = this.getImageList(chapterData);
            
            // Create image directory - directly in outputDir
            const imageDir = path.join(outputDir, 'assets', 'images');
            if (!fs.existsSync(imageDir)) {
                fs.mkdirSync(imageDir, { recursive: true });
            }
            
            // Save image generation manifest
            const manifestPath = path.join(imageDir, 'generation-manifest.json');
            fs.writeFileSync(manifestPath, JSON.stringify({
                chapter: chapterData.meta.id,
                style: chapterData.imageGeneration?.style || {},
                routing: chapterData.imageGeneration?.routing || {},
                characters: chapterData.imageGeneration?.characters || {},
                actions: chapterData.imageGeneration?.actions || [],
                images: imageList
            }, null, 2));
            
            console.log(`\n📋 Image Generation Manifest created: ${manifestPath}`);
            console.log(`   Total images to generate: ${imageList.length}`);
            
            // Summary
            console.log('\n✨ Chapter Build Complete!');
            console.log(`   Chapter: ${chapterData.meta.title.en}`);
            console.log(`   Output: ${outputPath}`);
            console.log(`   Images needed: ${imageList.length}`);
            
            return {
                success: true,
                chapterId: chapterData.meta.id,
                outputPath,
                imageManifest: manifestPath,
                imageCount: imageList.length
            };
            
        } catch (error) {
            console.error('❌ Error building chapter:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Usage: node chapter-builder.js <yaml-file> [output-dir]');
        console.log('Example: node chapter-builder.js chapters/sea-otters.yaml ../');
        process.exit(1);
    }
    
    const yamlPath = args[0];
    const outputDir = args[1] || '../';
    
    const builder = new ChapterBuilder();
    builder.buildChapter(yamlPath, outputDir).then(result => {
        if (result.success) {
            console.log('\n🎉 Success! Next steps:');
            console.log('1. Run the image generator with the manifest');
            console.log('2. Review generated images');
            console.log('3. Open the HTML file in a browser');
        } else {
            console.error('\n❌ Build failed:', result.error);
            process.exit(1);
        }
    });
}

module.exports = ChapterBuilder;