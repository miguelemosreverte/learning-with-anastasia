#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Missing images that need to be generated
const missingImages = [
    'otter-games-and-play.jpg',
    'ollies-promise.jpg',  
    'fun-fact-fur.jpg',
    'fun-fact-eating.jpg',
    'fun-fact-holding-hands.jpg',
    'fun-fact-purple-teeth.jpg',
    'detail-tool-use.jpg',
    'detail-keystone.jpg',
    'detail-no-blubber.jpg'
];

const outputDir = path.join(__dirname, 'sea-otters/assets/images');

// Remove existing images so they'll be regenerated
missingImages.forEach(img => {
    const filepath = path.join(outputDir, img);
    if (fs.existsSync(filepath)) {
        console.log(`Removing existing ${img} to force regeneration...`);
        fs.unlinkSync(filepath);
    }
});

console.log('Running generator for missing images...');

// Run the generator
try {
    execSync('source .env && export OPENAI_API_KEY GEMINI_API_KEY && node run-recursive-generation.js', {
        stdio: 'inherit',
        shell: '/bin/bash'
    });
} catch (error) {
    console.error('Generation completed with some errors');
}

// Check which images were successfully generated
console.log('\nChecking generation results:');
missingImages.forEach(img => {
    const filepath = path.join(outputDir, img);
    if (fs.existsSync(filepath)) {
        console.log(`✅ ${img} generated successfully`);
    } else {
        console.log(`❌ ${img} still missing`);
    }
});