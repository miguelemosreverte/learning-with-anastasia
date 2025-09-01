#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const RecursiveImageGenerator = require('./automation/recursive-image-generator');
const ChapterBuilder = require('./automation/chapter-builder');

async function runRecursiveGeneration() {
    // Check for API keys
    if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY) {
        console.error('❌ Missing API keys!');
        console.error('   Please set both OPENAI_API_KEY and GEMINI_API_KEY environment variables');
        process.exit(1);
    }
    
    console.log('\n🦫 Starting Recursive Beaver Story Generation');
    console.log('=' .repeat(60));
    
    // Load chapter definition
    const yamlPath = path.join(__dirname, 'chapters', 'beavers.yaml');
    const outputDir = path.join(__dirname, 'beavers');
    
    console.log(`📖 Loading chapter: ${yamlPath}`);
    console.log(`📁 Output directory: ${outputDir}`);
    
    // Parse YAML
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const chapterData = yaml.load(yamlContent);
    
    // Create output directory
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Initialize the recursive generator
    const generator = new RecursiveImageGenerator();
    
    try {
        // Generate images recursively
        console.log('\n🎨 Starting image generation...');
        const results = await generator.processChapter(chapterData, outputDir);
        
        if (results.success > 0 || results.skipped > 0) {
            // Now build the HTML
            console.log('\n📄 Building HTML page...');
            const builder = new ChapterBuilder();
            await builder.buildChapter(yamlPath, outputDir);
            
            console.log('\n✅ Chapter generation complete!');
            console.log(`   View at: ${path.join(outputDir, 'index.html')}`);
            
            // Show sample commands to open
            console.log('\n📖 To view the generated chapter:');
            console.log(`   open "${path.join(outputDir, 'index.html')}"`);
        } else {
            console.error('\n❌ No images were generated successfully');
        }
        
    } catch (error) {
        console.error('\n❌ Generation failed:', error.message);
        process.exit(1);
    }
}

// Handle script execution
if (require.main === module) {
    runRecursiveGeneration().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = runRecursiveGeneration;