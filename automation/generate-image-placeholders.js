#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class PlaceholderGenerator {
    constructor() {
        this.projectRoot = path.join(__dirname, '..');
        this.processed = new Set();
    }

    async generatePlaceholders() {
        console.log('🖼️  Generating low-resolution placeholders for faster loading...\n');
        
        // Check if ImageMagick is installed
        try {
            await execPromise('which convert');
        } catch (error) {
            console.log('⚠️  ImageMagick not found. Installing with Homebrew...');
            try {
                await execPromise('brew install imagemagick');
                console.log('✅ ImageMagick installed successfully\n');
            } catch (installError) {
                console.error('❌ Could not install ImageMagick. Please install it manually:');
                console.error('   brew install imagemagick');
                console.error('\nAlternatively, we can use a Node.js solution with sharp library.');
                return;
            }
        }

        // Process all chapter folders
        const chapters = [
            'beavers',
            'sea-otters',
            'seals-of-the-world',
            'polar-bears-antarctica',
            'chrysomallon-squamiferum'
        ];

        for (const chapter of chapters) {
            await this.processChapterImages(chapter);
        }

        console.log('\n✅ All placeholders generated successfully!');
    }

    async processChapterImages(chapter) {
        const imagesDir = path.join(this.projectRoot, chapter, 'assets', 'images');
        
        if (!fs.existsSync(imagesDir)) {
            console.log(`⚠️  Skipping ${chapter}: images directory not found`);
            return;
        }

        console.log(`📁 Processing ${chapter}...`);

        const files = fs.readdirSync(imagesDir);
        const imageFiles = files.filter(file => 
            /\.(jpg|jpeg|png)$/i.test(file) && 
            !file.includes('-placeholder') &&
            !file.includes('-old')
        );

        for (const file of imageFiles) {
            const inputPath = path.join(imagesDir, file);
            const outputPath = path.join(imagesDir, file.replace(/\.(jpg|jpeg|png)$/i, '-placeholder.jpg'));
            
            if (!fs.existsSync(outputPath)) {
                await this.createPlaceholder(inputPath, outputPath);
                console.log(`   ✅ Created placeholder for ${file}`);
            } else {
                console.log(`   ⏭️  Placeholder already exists for ${file}`);
            }
        }
    }

    async createPlaceholder(inputPath, outputPath) {
        // Create a very low quality, small placeholder image
        // Using ImageMagick: resize to max 100px width, quality 20%, blur
        const command = `convert "${inputPath}" -resize 100x -quality 20 -blur 0x8 "${outputPath}"`;
        
        try {
            await execPromise(command);
        } catch (error) {
            console.error(`   ❌ Failed to create placeholder for ${inputPath}:`, error.message);
        }
    }
}

// Alternative implementation using sharp (Node.js native)
class PlaceholderGeneratorSharp {
    constructor() {
        this.projectRoot = path.join(__dirname, '..');
        this.sharp = null;
    }

    async init() {
        try {
            // Try to require sharp
            this.sharp = require('sharp');
            return true;
        } catch (error) {
            console.log('📦 Sharp library not found. Installing...');
            const { exec } = require('child_process');
            const util = require('util');
            const execPromise = util.promisify(exec);
            
            try {
                await execPromise('npm install sharp');
                this.sharp = require('sharp');
                console.log('✅ Sharp installed successfully\n');
                return true;
            } catch (installError) {
                console.error('❌ Could not install sharp:', installError.message);
                return false;
            }
        }
    }

    async generatePlaceholders() {
        if (!await this.init()) {
            console.log('Falling back to ImageMagick method...\n');
            const imageMagickGenerator = new PlaceholderGenerator();
            return imageMagickGenerator.generatePlaceholders();
        }

        console.log('🖼️  Generating low-resolution placeholders using Sharp...\n');

        const chapters = [
            'beavers',
            'sea-otters',
            'seals-of-the-world',
            'polar-bears-antarctica',
            'chrysomallon-squamiferum'
        ];

        for (const chapter of chapters) {
            await this.processChapterImages(chapter);
        }

        console.log('\n✅ All placeholders generated successfully!');
    }

    async processChapterImages(chapter) {
        const imagesDir = path.join(this.projectRoot, chapter, 'assets', 'images');
        
        if (!fs.existsSync(imagesDir)) {
            console.log(`⚠️  Skipping ${chapter}: images directory not found`);
            return;
        }

        console.log(`📁 Processing ${chapter}...`);

        const files = fs.readdirSync(imagesDir);
        const imageFiles = files.filter(file => 
            /\.(jpg|jpeg|png)$/i.test(file) && 
            !file.includes('-placeholder') &&
            !file.includes('-old')
        );

        for (const file of imageFiles) {
            const inputPath = path.join(imagesDir, file);
            const outputPath = path.join(imagesDir, file.replace(/\.(jpg|jpeg|png)$/i, '-placeholder.jpg'));
            
            if (!fs.existsSync(outputPath)) {
                await this.createPlaceholder(inputPath, outputPath);
                console.log(`   ✅ Created placeholder for ${file}`);
            } else {
                console.log(`   ⏭️  Placeholder already exists for ${file}`);
            }
        }
    }

    async createPlaceholder(inputPath, outputPath) {
        try {
            await this.sharp(inputPath)
                .resize(100) // Max width 100px
                .jpeg({ quality: 20 }) // Very low quality
                .blur(5) // Add blur for better compression
                .toFile(outputPath);
        } catch (error) {
            console.error(`   ❌ Failed to create placeholder for ${inputPath}:`, error.message);
        }
    }
}

// Run the generator
if (require.main === module) {
    const generator = new PlaceholderGeneratorSharp();
    generator.generatePlaceholders().catch(console.error);
}

module.exports = { PlaceholderGenerator, PlaceholderGeneratorSharp };