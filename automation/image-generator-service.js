const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class ImageGeneratorService {
    constructor(manifest = null) {
        this.openaiKey = process.env.OPENAI_API_KEY;
        this.geminiKey = process.env.GEMINI_API_KEY;
        
        if (!this.openaiKey || !this.geminiKey) {
            console.warn('⚠️ Warning: API keys not fully configured');
            console.log('   OPENAI_API_KEY:', this.openaiKey ? '✓' : '✗');
            console.log('   GEMINI_API_KEY:', this.geminiKey ? '✓' : '✗');
        }
        
        // Store characters and actions from manifest
        this.characters = manifest?.characters || {};
        this.actions = manifest?.actions || [];
    }

    /**
     * Determine which service to use based on image metadata
     */
    determineService(imageConfig) {
        // If there's a reference image, use Gemini
        if (imageConfig.reference) {
            return 'gemini';
        }
        
        // If this image involves a character or action, use Gemini
        const action = this.actions.find(a => a.image === imageConfig.filename);
        if (action) {
            return 'gemini';
        }
        
        // Types that need specific accuracy or text (use Gemini)
        const geminiTypes = [
            'specific-animal',
            'specific-behavior', 
            'behavior',
            'diagram',
            'chart',
            'map',
            'comparison',
            'labeled'
        ];
        
        // Types that are creative/generic (use OpenAI)
        const openaiTypes = [
            'landscape',
            'hero',
            'scene',
            'atmosphere',
            'creative'
        ];
        
        const imageType = imageConfig.type || 'content';
        
        if (geminiTypes.includes(imageType)) {
            return 'gemini';
        }
        
        if (openaiTypes.includes(imageType)) {
            return 'openai';
        }
        
        // Default: if it needs translations (has text), use Gemini, otherwise OpenAI
        if (imageConfig.needsTranslations) {
            return 'gemini';
        }
        
        return 'openai';
    }

    /**
     * Generate image using the appropriate service
     */
    async generateImage(imageConfig, outputDir) {
        // Check if this is a character action
        const action = this.actions.find(a => a.image === imageConfig.filename);
        if (action) {
            imageConfig = this.enrichWithCharacterInfo(imageConfig, action);
        }
        
        const service = this.determineService(imageConfig);
        const outputPath = path.join(outputDir, imageConfig.filename);
        
        console.log(`\n📸 Generating: ${imageConfig.filename}`);
        console.log(`   Service: ${service.toUpperCase()}`);
        console.log(`   Type: ${imageConfig.type}`);
        if (action) {
            console.log(`   Characters: ${action.characters ? action.characters.join(', ') : action.character}`);
            console.log(`   Action: ${action.action}`);
        }
        
        // Skip if already exists
        if (fs.existsSync(outputPath)) {
            console.log(`   ✓ Already exists, skipping`);
            return { success: true, path: outputPath, skipped: true };
        }
        
        try {
            if (service === 'gemini') {
                return await this.generateWithGemini(imageConfig, outputPath);
            } else {
                return await this.generateWithOpenAI(imageConfig, outputPath);
            }
        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Enrich image config with character references
     */
    enrichWithCharacterInfo(imageConfig, action) {
        const enriched = { ...imageConfig };
        
        // Get character references
        const characterRefs = [];
        if (action.character) {
            const char = this.characters[action.character];
            if (char) {
                characterRefs.push(char);
                enriched.characterReferences = [char.reference];
                enriched.characterNames = [char.name];
            }
        } else if (action.characters) {
            action.characters.forEach(charId => {
                const char = this.characters[charId];
                if (char) {
                    characterRefs.push(char);
                }
            });
            enriched.characterReferences = characterRefs.map(c => c.reference);
            enriched.characterNames = characterRefs.map(c => c.name);
        }
        
        // Add action description to prompt
        if (action.action) {
            const charNames = enriched.characterNames?.join(' and ') || 'the character';
            enriched.actionPrompt = `Show ${charNames} ${action.action}`;
        }
        
        // Use first character reference as main reference
        if (characterRefs.length > 0 && !enriched.reference) {
            enriched.reference = characterRefs[0].reference;
        }
        
        return enriched;
    }

    /**
     * Generate image using OpenAI DALL-E 3
     */
    async generateWithOpenAI(imageConfig, outputPath) {
        console.log(`   Using OpenAI DALL-E 3...`);
        
        // Create a temporary script to generate the image
        const tempScript = `
const https = require('https');
const fs = require('fs');

const prompt = \`${imageConfig.alt.en}

Style: Studio Ghibli warmth, Pixar quality, Van Gogh atmospheric effects. 
Child-friendly, vibrant colors, magical lighting.
NO TEXT in the image.\`;

const requestData = JSON.stringify({
    model: 'dall-e-3',
    prompt: prompt,
    n: 1,
    size: '1792x1024',
    quality: 'hd'
});

const options = {
    hostname: 'api.openai.com',
    port: 443,
    path: '/v1/images/generations',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${this.openaiKey}',
        'Content-Length': requestData.length
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const response = JSON.parse(data);
            if (response.data && response.data[0]) {
                const imageUrl = response.data[0].url;
                // Download the image
                https.get(imageUrl, (imgRes) => {
                    const fileStream = fs.createWriteStream('${outputPath}');
                    imgRes.pipe(fileStream);
                    fileStream.on('finish', () => {
                        console.log('SUCCESS');
                        process.exit(0);
                    });
                });
            } else {
                console.error('No image in response');
                process.exit(1);
            }
        } catch (e) {
            console.error(e.message);
            process.exit(1);
        }
    });
});

req.on('error', (e) => {
    console.error(e.message);
    process.exit(1);
});

req.write(requestData);
req.end();
`;

        // Write and execute the script
        const scriptPath = path.join(outputDir, '.temp-openai-gen.js');
        fs.writeFileSync(scriptPath, tempScript);
        
        try {
            const { stdout, stderr } = await execPromise(`node "${scriptPath}"`);
            if (stdout.includes('SUCCESS')) {
                console.log(`   ✅ Generated with OpenAI`);
                fs.unlinkSync(scriptPath);
                return { success: true, path: outputPath, service: 'openai' };
            } else {
                throw new Error(stderr || 'Generation failed');
            }
        } catch (error) {
            fs.unlinkSync(scriptPath);
            throw error;
        }
    }

    /**
     * Generate image using Gemini
     */
    async generateWithGemini(imageConfig, outputPath) {
        const referenceType = imageConfig.characterReferences ? 'character references' : 
                           imageConfig.reference ? 'reference image' : 'detailed prompt';
        console.log(`   Using Gemini with ${referenceType}...`);
        
        // Build the Gemini generation script
        let scriptContent;
        
        if (imageConfig.reference && fs.existsSync(imageConfig.reference)) {
            // Use reference image approach
            scriptContent = `
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");

async function generate() {
    const ai = new GoogleGenAI({
        apiKey: "${this.geminiKey}"
    });
    
    const referenceData = fs.readFileSync("${imageConfig.reference}");
    const base64Reference = referenceData.toString("base64");
    
    const prompt = [
        {
            text: \`${imageConfig.actionPrompt || 'Create an image based on this reference:'}
            
            ${imageConfig.alt.en}
            
            ${imageConfig.characterNames ? 'Characters shown: ' + imageConfig.characterNames.join(', ') : ''}
            
            Style: Studio Ghibli warmth, Pixar quality, child-friendly.
            Keep the characters consistent with the reference.
            ${imageConfig.needsTranslations ? '' : 'NO TEXT in the image.'}\`
        },
        {
            inlineData: {
                mimeType: "image/jpeg",
                data: base64Reference
            }
        }
    ];
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image-preview",
            contents: prompt
        });
        
        if (response && response.candidates && response.candidates[0]) {
            const parts = response.candidates[0].content.parts;
            for (const part of parts) {
                if (part.inlineData) {
                    const buffer = Buffer.from(part.inlineData.data, "base64");
                    fs.writeFileSync("${outputPath}", buffer);
                    console.log("SUCCESS");
                    return;
                }
            }
        }
        console.error("No image generated");
        process.exit(1);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

generate();
`;
        } else {
            // Use text-only prompt
            scriptContent = `
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");

async function generate() {
    const ai = new GoogleGenAI({
        apiKey: "${this.geminiKey}"
    });
    
    const prompt = \`Create: ${imageConfig.alt.en}
    
    Style: Studio Ghibli warmth, Pixar quality, child-friendly.
    ${imageConfig.needsTranslations ? 'Include clear, readable text labels as specified.' : 'NO TEXT in the image.'}\`;
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image-preview",
            contents: prompt
        });
        
        if (response && response.candidates && response.candidates[0]) {
            const parts = response.candidates[0].content.parts;
            for (const part of parts) {
                if (part.inlineData) {
                    const buffer = Buffer.from(part.inlineData.data, "base64");
                    fs.writeFileSync("${outputPath}", buffer);
                    console.log("SUCCESS");
                    return;
                }
            }
        }
        console.error("No image generated");
        process.exit(1);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

generate();
`;
        }
        
        // Write and execute the script
        const scriptPath = path.join(outputDir, '.temp-gemini-gen.js');
        fs.writeFileSync(scriptPath, scriptContent);
        
        try {
            const { stdout, stderr } = await execPromise(`node "${scriptPath}"`, {
                timeout: 60000 // 60 second timeout
            });
            
            if (stdout.includes('SUCCESS')) {
                console.log(`   ✅ Generated with Gemini`);
                fs.unlinkSync(scriptPath);
                return { success: true, path: outputPath, service: 'gemini' };
            } else {
                throw new Error(stderr || 'Generation failed');
            }
        } catch (error) {
            if (fs.existsSync(scriptPath)) {
                fs.unlinkSync(scriptPath);
            }
            throw error;
        }
    }

    /**
     * Generate all images from a manifest
     */
    async generateFromManifest(manifestPath) {
        console.log('\n🎨 Starting Image Generation');
        console.log('=' .repeat(50));
        
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const outputDir = path.dirname(manifestPath);
        
        // Store characters and actions from manifest
        this.characters = manifest.characters || {};
        this.actions = manifest.actions || [];
        
        console.log(`📋 Processing ${manifest.images.length} images for chapter: ${manifest.chapter}`);
        
        const results = {
            total: manifest.images.length,
            success: 0,
            failed: 0,
            skipped: 0
        };
        
        for (const imageConfig of manifest.images) {
            const result = await this.generateImage(imageConfig, outputDir);
            
            if (result.success) {
                if (result.skipped) {
                    results.skipped++;
                } else {
                    results.success++;
                }
            } else {
                results.failed++;
            }
            
            // Rate limiting
            if (!result.skipped) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        
        // Summary
        console.log('\n' + '=' .repeat(50));
        console.log('✨ Image Generation Complete!');
        console.log(`   Generated: ${results.success}`);
        console.log(`   Skipped (existing): ${results.skipped}`);
        console.log(`   Failed: ${results.failed}`);
        
        return results;
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Usage: node image-generator-service.js <manifest-file>');
        console.log('Example: node image-generator-service.js sea-otters/assets/images/generation-manifest.json');
        process.exit(1);
    }
    
    const manifestPath = args[0];
    
    if (!fs.existsSync(manifestPath)) {
        console.error(`❌ Manifest file not found: ${manifestPath}`);
        process.exit(1);
    }
    
    const generator = new ImageGeneratorService();
    generator.generateFromManifest(manifestPath).then(results => {
        if (results.failed === 0) {
            console.log('\n🎉 All images generated successfully!');
        } else {
            console.log(`\n⚠️ ${results.failed} images failed to generate`);
            process.exit(1);
        }
    });
}

module.exports = ImageGeneratorService;