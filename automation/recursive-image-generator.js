const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class RecursiveImageGenerator {
    constructor() {
        this.openaiKey = process.env.OPENAI_API_KEY;
        this.geminiKey = process.env.GEMINI_API_KEY;
        
        // Registry of generated images for reference
        this.generatedImages = {};
        
        // Track character definitions
        this.characters = {};
    }

    /**
     * Parse reference syntax like ${section-id.image}
     */
    parseReference(ref) {
        const match = ref.match(/\$\{([^.]+)\.image\}/);
        if (match) {
            return match[1];
        }
        return null;
    }

    /**
     * Resolve all references in a section
     */
    resolveReferences(section, allSections) {
        const resolved = { ...section };
        
        // Check if this section has a referenceImage field
        if (section.referenceImage) {
            const refId = this.parseReference(section.referenceImage);
            if (refId) {
                // Always set that we WANT a reference, even if not generated yet
                resolved.characterId = refId;
                if (this.generatedImages[refId]) {
                    resolved.characterReference = this.generatedImages[refId];
                } else {
                    // Mark that we need this reference but don't have it yet
                    resolved.missingCharacterRef = refId;
                }
            }
        }
        
        // Check if this section uses a character from a previous section
        if (section.use_character) {
            const refId = this.parseReference(section.use_character);
            if (refId) {
                // Always set that we WANT a reference, even if not generated yet
                resolved.characterId = refId;
                if (this.generatedImages[refId]) {
                    resolved.characterReference = this.generatedImages[refId];
                } else {
                    // Mark that we need this reference but don't have it yet
                    resolved.missingCharacterRef = refId;
                }
            }
        }
        
        // Check if this section uses multiple characters
        if (section.use_characters) {
            resolved.characterReferences = [];
            resolved.missingCharacterRefs = [];
            section.use_characters.forEach(ref => {
                const refId = this.parseReference(ref);
                if (refId) {
                    if (this.generatedImages[refId]) {
                        resolved.characterReferences.push({
                            id: refId,
                            path: this.generatedImages[refId]
                        });
                    } else {
                        resolved.missingCharacterRefs.push(refId);
                    }
                }
            });
        }
        
        return resolved;
    }

    /**
     * Build dependency graph to determine generation order
     */
    buildDependencyOrder(sections) {
        const order = [];
        const visited = new Set();
        const visiting = new Set();
        
        const visit = (section) => {
            if (visited.has(section.id)) return;
            if (visiting.has(section.id)) {
                throw new Error(`Circular dependency detected at ${section.id}`);
            }
            
            visiting.add(section.id);
            
            // Visit dependencies first
            if (section.use_character) {
                const refId = this.parseReference(section.use_character);
                if (refId) {
                    const dep = sections.find(s => s.id === refId);
                    if (dep) visit(dep);
                }
            }
            
            if (section.use_characters) {
                section.use_characters.forEach(ref => {
                    const refId = this.parseReference(ref);
                    if (refId) {
                        const dep = sections.find(s => s.id === refId);
                        if (dep) visit(dep);
                    }
                });
            }
            
            visiting.delete(section.id);
            visited.add(section.id);
            order.push(section);
        };
        
        sections.forEach(section => visit(section));
        
        return order;
    }

    /**
     * Check if all referenced images exist
     */
    checkDependencies(section) {
        const missingDeps = [];
        
        if (section.characterReference && !fs.existsSync(section.characterReference)) {
            missingDeps.push(section.characterId);
        }
        
        if (section.characterReferences) {
            section.characterReferences.forEach(ref => {
                if (!fs.existsSync(ref.path)) {
                    missingDeps.push(ref.id);
                }
            });
        }
        
        return missingDeps;
    }

    /**
     * Generate a single image with potential character reference
     */
    async generateImage(section, outputDir, forceRegenerate = false) {
        const outputPath = path.join(outputDir, section.image);
        
        console.log(`\n📸 Generating: ${section.image}`);
        console.log(`   ID: ${section.id}`);
        
        // Check if dependencies exist (for reference-based generation)
        if (section.missingCharacterRef || (section.missingCharacterRefs && section.missingCharacterRefs.length > 0)) {
            const missingDeps = section.missingCharacterRef ? [section.missingCharacterRef] : section.missingCharacterRefs;
            console.log(`   ⚠️ Missing character references: ${missingDeps.join(', ')}`);
            console.log(`   🔄 Will retry after dependencies are generated`);
            return { success: false, missingDeps, needsRegeneration: true };
        }
        
        // Skip if exists and not forcing regeneration
        if (fs.existsSync(outputPath) && !forceRegenerate) {
            console.log(`   ✓ Already exists`);
            this.generatedImages[section.id] = outputPath;
            if (section.generate_character) {
                this.characters[section.id] = outputPath;
            }
            return { success: true, path: outputPath, skipped: true };
        }
        
        // Determine service based on whether this section WANTS references
        const wantsReference = section.use_character || section.use_characters || 
                               section.characterId || section.missingCharacterRef || 
                               section.referenceImage ||  // Add check for referenceImage field
                               (section.characterReferences && section.characterReferences.length > 0) ||
                               (section.missingCharacterRefs && section.missingCharacterRefs.length > 0);
        // Use Gemini when we want reference images, OpenAI otherwise
        const service = wantsReference ? 'gemini' : 'openai';
        
        console.log(`   Service: ${service.toUpperCase()}`);
        if (section.action) {
            console.log(`   Action: ${section.action}`);
        }
        if (section.characterId) {
            console.log(`   Using character: ${section.characterId}`);
        }
        
        try {
            let result;
            // Check if we have actual reference images available
            const hasActualReference = section.characterReference || (section.characterReferences && section.characterReferences.length > 0);
            
            if (service === 'gemini' && hasActualReference) {
                result = await this.generateWithGeminiReference(section, outputPath);
            } else if (service === 'gemini') {
                result = await this.generateWithGemini(section, outputPath);
            } else {
                result = await this.generateWithOpenAI(section, outputPath);
            }
            
            if (result.success) {
                // Store in registry
                this.generatedImages[section.id] = outputPath;
                
                // Mark as character if needed
                if (section.generate_character) {
                    this.characters[section.id] = outputPath;
                    console.log(`   ✓ Character registered: ${section.id}`);
                }
            }
            
            return result;
        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate with Gemini using character reference
     */
    async generateWithGeminiReference(section, outputPath) {
        const referenceImage = section.characterReference || section.characterReferences[0].path;
        
        const scriptContent = `
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");

async function generate() {
    const ai = new GoogleGenAI({
        apiKey: "${this.geminiKey}"
    });
    
    const referenceData = fs.readFileSync("${referenceImage}");
    const base64Reference = referenceData.toString("base64");
    
    const prompt = [
        {
            text: \`Using the character from the reference image, show: ${section.action || section.content.en}
            
            IMPORTANT: Keep the character's appearance EXACTLY the same as in the reference.
            ${section.title ? 'Scene: ' + section.title.en : ''}
            
            Style: Studio Ghibli warmth, Pixar quality, child-friendly, vibrant colors.
            NO TEXT in the image.\`
        },
        {
            inlineData: {
                mimeType: "image/jpeg",
                data: base64Reference
            }
        }
    ];
    
    let retries = 3;
    while (retries > 0) {
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
                    } else if (part.text) {
                        console.log("TEXT_RESPONSE:", part.text.substring(0, 100));
                    }
                }
            }
            console.error("No image generated - response had text only");
            process.exit(1);
        } catch (error) {
            retries--;
            if (error.message && error.message.includes("500") && retries > 0) {
                console.log(\`RETRY: \${retries} attempts remaining\`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
                console.error(error.message);
                process.exit(1);
            }
        }
    }
    console.error("Failed after 3 retries");
    process.exit(1);
}

generate();
`;

        const scriptPath = path.join(path.dirname(outputPath), '.temp-gemini-ref.js');
        fs.writeFileSync(scriptPath, scriptContent);
        
        try {
            const { stdout } = await execPromise(`node "${scriptPath}"`, { timeout: 60000 });
            
            if (stdout.includes('SUCCESS')) {
                console.log(`   ✅ Generated with character reference`);
                fs.unlinkSync(scriptPath);
                return { success: true, path: outputPath };
            } else {
                throw new Error('Generation failed');
            }
        } catch (error) {
            if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
            throw error;
        }
    }

    /**
     * Generate with Gemini (no reference)
     */
    async generateWithGemini(section, outputPath) {
        const prompt = section.imageAlt?.en || section.content?.en || 'Generate image';
        
        const scriptContent = `
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");

async function generate() {
    const genAI = new GoogleGenerativeAI("${this.geminiKey}");
    
    const prompt = \`Create: ${prompt}
    
    ${section.title ? 'Scene: ' + section.title.en : ''}
    
    Style: Studio Ghibli warmth, Pixar quality, child-friendly, vibrant colors.
    NO TEXT in the image.\`;
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const response = await model.generateContent(prompt);
        
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

        const scriptPath = path.join(path.dirname(outputPath), '.temp-gemini.js');
        fs.writeFileSync(scriptPath, scriptContent);
        
        try {
            const { stdout } = await execPromise(`node "${scriptPath}"`, { timeout: 60000 });
            
            if (stdout.includes('SUCCESS')) {
                console.log(`   ✅ Generated with Gemini`);
                fs.unlinkSync(scriptPath);
                return { success: true, path: outputPath };
            } else {
                throw new Error('Generation failed');
            }
        } catch (error) {
            if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
            throw error;
        }
    }

    /**
     * Generate with OpenAI
     */
    async generateWithOpenAI(section, outputPath) {
        const prompt = section.imageAlt?.en || section.content?.en || 'Generate image';
        
        const scriptContent = `
const https = require('https');
const fs = require('fs');

const requestData = JSON.stringify({
    model: 'dall-e-3',
    prompt: \`${prompt}
    
    Style: Studio Ghibli warmth, Pixar quality, Van Gogh atmospheric effects.
    Child-friendly, vibrant colors, magical lighting.
    NO TEXT in the image.\`,
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

        const scriptPath = path.join(path.dirname(outputPath), '.temp-openai.js');
        fs.writeFileSync(scriptPath, scriptContent);
        
        try {
            const { stdout } = await execPromise(`node "${scriptPath}"`);
            if (stdout.includes('SUCCESS')) {
                console.log(`   ✅ Generated with OpenAI`);
                fs.unlinkSync(scriptPath);
                return { success: true, path: outputPath };
            } else {
                throw new Error('Generation failed');
            }
        } catch (error) {
            if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
            throw error;
        }
    }

    /**
     * Process a complete chapter with recursive generation
     */
    async processChapter(chapterData, outputDir) {
        console.log('\n🎨 Starting Recursive Image Generation');
        console.log('=' .repeat(50));
        console.log(`📖 Chapter: ${chapterData.meta.title.en}`);
        
        // Ensure output directory exists
        const imageDir = path.join(outputDir, 'assets', 'images');
        if (!fs.existsSync(imageDir)) {
            fs.mkdirSync(imageDir, { recursive: true });
        }
        
        // Build dependency order
        const sections = chapterData.sections || [];
        const orderedSections = this.buildDependencyOrder(sections);
        
        console.log(`\n📋 Generation order (${orderedSections.length} sections):`);
        orderedSections.forEach((s, i) => {
            console.log(`   ${i + 1}. ${s.id} ${s.use_character ? `(uses ${this.parseReference(s.use_character)})` : ''}`);
        });
        
        // Track sections that need regeneration
        const needsRegeneration = new Set();
        
        // Generate in order
        const results = {
            total: orderedSections.length,
            success: 0,
            failed: 0,
            skipped: 0,
            regenerated: 0
        };
        
        // First pass: generate all images
        for (const section of orderedSections) {
            // Resolve references
            const resolvedSection = this.resolveReferences(section, sections);
            
            // Generate image
            const result = await this.generateImage(resolvedSection, imageDir);
            
            if (result.success) {
                if (result.skipped) {
                    results.skipped++;
                } else {
                    results.success++;
                }
            } else if (result.needsRegeneration) {
                needsRegeneration.add(section.id);
            } else {
                results.failed++;
            }
            
            // Rate limiting
            if (!result.skipped && result.success) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        
        // Second pass: regenerate dependent images if needed
        if (needsRegeneration.size > 0) {
            console.log(`\n🔄 Regenerating ${needsRegeneration.size} dependent images...`);
            
            for (const sectionId of needsRegeneration) {
                const section = sections.find(s => s.id === sectionId);
                if (!section) continue;
                
                const resolvedSection = this.resolveReferences(section, sections);
                const result = await this.generateImage(resolvedSection, imageDir, true);
                
                if (result.success) {
                    results.regenerated++;
                    needsRegeneration.delete(sectionId);
                }
                
                // Rate limiting
                if (result.success) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
        }
        
        // Summary
        console.log('\n' + '=' .repeat(50));
        console.log('✨ Recursive Generation Complete!');
        console.log(`   Generated: ${results.success}`);
        console.log(`   Skipped: ${results.skipped}`);
        console.log(`   Regenerated: ${results.regenerated}`);
        console.log(`   Failed: ${results.failed}`);
        console.log(`   Characters created: ${Object.keys(this.characters).length}`);
        
        return results;
    }
}

module.exports = RecursiveImageGenerator;