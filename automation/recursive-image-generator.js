const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const PromptArchiver = require('./prompt-archiver');
const ImageQA = require('./image-qa');
const StyleReviewer = require('./style-reviewer');
const promptSanitizer = require('./prompt-sanitizer');
const promptHistory = require('./prompt-history');

class RecursiveImageGenerator {
    constructor() {
        this.openaiKey = process.env.OPENAI_API_KEY;
        this.geminiKey = process.env.GEMINI_API_KEY;

        // Registry of generated images for reference
        this.generatedImages = {};

        // Track character definitions
        this.characters = {};

        // QA/style review availability (checked once at start)
        this._claudeAvailable = null;

        // Report generator (set by processChapter)
        this.reportGenerator = null;

        // Chapter output directory (set by processChapter)
        this.chapterDir = null;

        // Global style description (set by processChapter)
        this.styleDescription = '';

        // Pre-production references (loaded by processChapter if available)
        this.preproduction = null;
        this.preproCharacterSheets = {};
        this.preproStyleRef = null;

        // Composable mood system
        this.preproMoods = {};       // { id: description } lookup
        this.defaultMoods = [];      // chapter-wide default mood IDs
        this.pixarBase = '';
    }

    /**
     * Load pre-production character sheets and style reference if available.
     * Returns true if pre-production assets were found.
     */
    loadPreproduction(chapterDir) {
        const manifestPath = path.join(chapterDir, 'preproduction', 'approved', 'preproduction-manifest.json');
        if (!fs.existsSync(manifestPath)) return false;

        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            this.preproduction = manifest;
            const approvedDir = path.join(chapterDir, 'preproduction', 'approved');

            // Load character sheets
            for (const [sectionId, filename] of Object.entries(manifest.characterSheets || {})) {
                const sheetPath = path.join(approvedDir, filename);
                if (fs.existsSync(sheetPath)) {
                    this.preproCharacterSheets[sectionId] = sheetPath;
                }
            }

            // Load style reference
            if (manifest.styleReference) {
                const stylePath = path.join(approvedDir, manifest.styleReference);
                if (fs.existsSync(stylePath)) {
                    this.preproStyleRef = stylePath;
                }
            }

            // Override style description with chosen style
            if (manifest.chosenStyle && manifest.chosenStyle.description) {
                this.styleDescription = manifest.chosenStyle.description;
            }

            // Load composable mood system
            if (manifest.chosenStyle && manifest.chosenStyle.moods) {
                this.defaultMoods = manifest.chosenStyle.moods;
                this.pixarBase = manifest.chosenStyle.base || '';
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if Claude CLI is available for QA/style review.
     */
    async _checkClaudeAvailable() {
        if (this._claudeAvailable === null) {
            this._claudeAvailable = await ImageQA.isAvailable();
            if (this._claudeAvailable) {
                console.log('   🤖 Claude CLI available - QA and style review enabled');
            } else {
                console.log('   ⚠️ Claude CLI not found - QA and style review disabled');
            }
        }
        return this._claudeAvailable;
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
                resolved.characterId = refId;
                // Pre-production sheet takes priority
                if (this.preproCharacterSheets[refId]) {
                    resolved.characterReference = this.preproCharacterSheets[refId];
                } else if (this.generatedImages[refId]) {
                    resolved.characterReference = this.generatedImages[refId];
                } else {
                    resolved.missingCharacterRef = refId;
                }
            }
        }

        // Check if this section uses a character from a previous section
        if (section.use_character) {
            const refId = this.parseReference(section.use_character);
            if (refId) {
                resolved.characterId = refId;
                // Pre-production sheet takes priority
                if (this.preproCharacterSheets[refId]) {
                    resolved.characterReference = this.preproCharacterSheets[refId];
                } else if (this.generatedImages[refId]) {
                    resolved.characterReference = this.generatedImages[refId];
                } else {
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
                    // Pre-production sheet takes priority
                    if (this.preproCharacterSheets[refId]) {
                        resolved.characterReferences.push({
                            id: refId,
                            path: this.preproCharacterSheets[refId]
                        });
                    } else if (this.generatedImages[refId]) {
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
     * Save a failed attempt image to the attempts directory.
     */
    _saveAttempt(imagePath, attemptNumber) {
        if (!this.chapterDir) return null;
        return StyleReviewer.saveAttempt(imagePath, attemptNumber, this.chapterDir);
    }

    /**
     * Build the prompt text for a section (used for archival).
     */
    _buildPromptText(section, service) {
        if (service === 'openai') {
            return (section.prompt || section.imageAlt?.en || section.content?.en || 'Generate image') +
                '\n\nStyle: Studio Ghibli warmth, Pixar quality, child-friendly illustration. Vibrant colors, magical lighting, cozy atmosphere. Absolutely NO text, words, letters, numbers, labels, or captions in the image.';
        }
        // Gemini prompts
        const action = section.action || section.prompt || section.content?.en || 'Generate image';
        const context = section.title && section.title.en ? 'Context: ' + section.title.en : '';
        return `Create a cheerful, child-friendly illustration: ${action}\n${context}\nStyle: Studio Ghibli warmth, Pixar quality, vibrant colors, magical lighting, child-friendly. Absolutely NO text or words in the image.`;
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
            // Record in report as skipped
            if (this.reportGenerator) {
                this.reportGenerator.recordImage({
                    filename: section.image,
                    sectionId: section.id,
                    service: '-',
                    timeMs: 0,
                    skipped: true,
                    success: true
                });
            }
            return { success: true, path: outputPath, skipped: true };
        }

        // If this is a character portrait and we have a pre-production sheet, use it as reference
        if (section.generate_character && !section.characterReference) {
            if (this.preproCharacterSheets[section.id]) {
                section.characterReference = this.preproCharacterSheets[section.id];
                console.log(`   🎬 Using preproduction sheet as reference for character portrait`);
            }
        }

        // Determine service based on whether this section WANTS references
        const wantsReference = section.use_character || section.use_characters ||
                               section.characterId || section.missingCharacterRef ||
                               section.referenceImage || section.characterReference ||
                               (section.characterReferences && section.characterReferences.length > 0) ||
                               (section.missingCharacterRefs && section.missingCharacterRefs.length > 0);
        // Check YAML routing config — only use openai if explicitly listed under openai routing
        const routingConfig = this.chapterData && this.chapterData.routing;
        const openaiRouted = routingConfig && routingConfig.openai &&
                             routingConfig.openai.includes(section.image);
        const service = (!openaiRouted || wantsReference) ? 'gemini' : 'openai';

        console.log(`   Service: ${service.toUpperCase()}`);
        if (section.action) {
            console.log(`   Action: ${section.action}`);
        }
        if (section.characterId) {
            console.log(`   Using character: ${section.characterId}`);
        } else if (section.use_character) {
            const match = section.use_character.match(/\$\{(.+?)\.image\}/);
            if (match) {
                console.log(`   Using character: ${match[1]}`);
            }
        }

        // Collect reference paths for archival
        const references = [];
        if (section.characterReference) references.push(section.characterReference);
        if (section.characterReferences) {
            section.characterReferences.forEach(r => references.push(r.path));
        }

        const maxStyleAttempts = section.generate_character ? 5 : 1;
        const maxQAAttempts = 3;
        let totalAttempts = 0;
        let lastError = null;
        let qaResult = null;
        let styleResult = null;

        const startTime = Date.now();

        for (let styleAttempt = 1; styleAttempt <= maxStyleAttempts; styleAttempt++) {
            for (let qaAttempt = 1; qaAttempt <= maxQAAttempts; qaAttempt++) {
                totalAttempts++;

                try {
                    let result;
                    const hasActualReference = section.characterReference ||
                                              section.use_character ||
                                              (section.characterReferences && section.characterReferences.length > 0);

                    if (service === 'gemini' && hasActualReference) {
                        result = await this.generateWithGeminiReference(section, outputPath);
                    } else if (service === 'gemini') {
                        result = await this.generateWithGemini(section, outputPath);
                    } else {
                        result = await this.generateWithOpenAI(section, outputPath);
                    }

                    if (!result.success) {
                        lastError = result.error || 'Generation failed';
                        // Record failed attempt in prompt history
                        const sr = section._sanitizeResult || {};
                        promptHistory.record({
                            image: outputPath, chapter: this._chapterName, sectionId: section.id,
                            attempt: totalAttempts, service,
                            original: sr.original || '', sanitized: sr.sanitized || '',
                            wasSanitized: sr.wasModified || false, sanitizeMethod: sr.method || 'none',
                            triggeredPatterns: sr.triggeredPatterns || [],
                            outcome: 'api_error', error: lastError, qaResult: null,
                            durationMs: Date.now() - startTime
                        });
                        continue;
                    }

                    // Run QA check if Claude is available
                    const claudeReady = await this._checkClaudeAvailable();
                    if (claudeReady) {
                        qaResult = await ImageQA.checkWithRetry(outputPath, this.styleDescription);
                        console.log(`   🔍 QA: ${qaResult.pass ? 'PASS' : 'FAIL'} (quality: ${qaResult.quality}/10)`);

                        if (!qaResult.pass) {
                            console.log(`   ⚠️ QA issues: ${qaResult.issues.join(', ')}`);
                            this._saveAttempt(outputPath, totalAttempts);
                            // Record QA failure in prompt history
                            const sr = section._sanitizeResult || {};
                            promptHistory.record({
                                image: outputPath, chapter: this._chapterName, sectionId: section.id,
                                attempt: totalAttempts, service,
                                original: sr.original || '', sanitized: sr.sanitized || '',
                                wasSanitized: sr.wasModified || false, sanitizeMethod: sr.method || 'none',
                                triggeredPatterns: sr.triggeredPatterns || [],
                                outcome: 'qa_failed', error: qaResult.issues.join('; '), qaResult,
                                durationMs: Date.now() - startTime
                            });
                            if (qaAttempt < maxQAAttempts) {
                                console.log(`   🔄 Regenerating for QA (attempt ${qaAttempt + 1}/${maxQAAttempts})...`);
                                await new Promise(r => setTimeout(r, 3000));
                                continue;
                            }
                            // Exhausted QA retries, keep the image but note failure
                            console.log(`   ⚠️ QA retries exhausted, keeping image`);
                        }
                    }

                    // Run style review for character images
                    if (section.generate_character && claudeReady) {
                        styleResult = await StyleReviewer.review(
                            outputPath,
                            this.styleDescription
                        );
                        console.log(`   🎨 Style: ${styleResult.pass ? 'PASS' : 'FAIL'} (score: ${styleResult.score}/10)`);

                        if (!styleResult.pass && styleAttempt < maxStyleAttempts) {
                            console.log(`   ⚠️ Style feedback: ${styleResult.feedback}`);
                            this._saveAttempt(outputPath, totalAttempts);
                            console.log(`   🔄 Regenerating for style (attempt ${styleAttempt + 1}/${maxStyleAttempts})...`);
                            await new Promise(r => setTimeout(r, 3000));
                            break; // Break QA loop, continue style loop
                        }
                    }

                    // Success path — archive prompt and register
                    const timeMs = Date.now() - startTime;
                    const promptText = this._buildPromptText(section, service);

                    PromptArchiver.save(outputPath, {
                        prompt: promptText,
                        service,
                        references,
                        generationTimeMs: timeMs,
                        qaResult,
                        styleResult,
                        attempt: totalAttempts,
                        totalAttempts
                    });

                    // Record success in prompt history
                    const sr = section._sanitizeResult || {};
                    promptHistory.record({
                        image: outputPath, chapter: this._chapterName, sectionId: section.id,
                        attempt: totalAttempts, service,
                        original: sr.original || '', sanitized: sr.sanitized || '',
                        wasSanitized: sr.wasModified || false, sanitizeMethod: sr.method || 'none',
                        triggeredPatterns: sr.triggeredPatterns || [],
                        outcome: 'success', error: null, qaResult,
                        durationMs: timeMs
                    });

                    this.generatedImages[section.id] = outputPath;
                    if (section.generate_character) {
                        this.characters[section.id] = outputPath;
                        console.log(`   ✓ Character registered: ${section.id}`);
                    }

                    if (this.reportGenerator) {
                        this.reportGenerator.recordImage({
                            filename: section.image,
                            sectionId: section.id,
                            service,
                            timeMs,
                            skipped: false,
                            success: true,
                            attempts: totalAttempts,
                            qaResult,
                            styleResult
                        });
                    }

                    return { success: true, path: outputPath };

                } catch (error) {
                    lastError = error.message;
                    console.error(`   ❌ Error: ${error.message}`);
                    // Record error in prompt history
                    const sr = section._sanitizeResult || {};
                    const isContentFilter = /blocked|safety|content.*policy|moderation/i.test(error.message);
                    promptHistory.record({
                        image: outputPath, chapter: this._chapterName, sectionId: section.id,
                        attempt: totalAttempts, service,
                        original: sr.original || '', sanitized: sr.sanitized || '',
                        wasSanitized: sr.wasModified || false, sanitizeMethod: sr.method || 'none',
                        triggeredPatterns: sr.triggeredPatterns || [],
                        outcome: isContentFilter ? 'content_filter' : 'api_error',
                        error: error.message, qaResult: null,
                        durationMs: Date.now() - startTime
                    });
                }
            }
        }

        // All attempts exhausted
        const timeMs = Date.now() - startTime;
        if (this.reportGenerator) {
            this.reportGenerator.recordImage({
                filename: section.image,
                sectionId: section.id,
                service,
                timeMs,
                skipped: false,
                success: false,
                attempts: totalAttempts,
                qaResult,
                styleResult,
                error: lastError
            });
        }
        return { success: false, error: lastError };
    }

    /**
     * Generate with Gemini using character reference
     */
    async generateWithGeminiReference(section, outputPath) {
        const { GoogleGenAI } = require("@google/genai");

        // Use the already-resolved reference path from resolveReferences()
        let referenceImage;
        if (section.characterReference) {
            referenceImage = section.characterReference;
        } else if (section.characterReferences && section.characterReferences.length > 0) {
            referenceImage = section.characterReferences[0].path;
        } else {
            throw new Error(`No resolved character reference found for section ${section.id}`);
        }

        console.log(`   📎 Reference image: ${path.basename(referenceImage)}`);

        const ai = new GoogleGenAI({
            apiKey: this.geminiKey
        });

        const referenceData = fs.readFileSync(referenceImage);
        const base64Reference = referenceData.toString("base64");

        // Build prompt contents - include multiple reference images if available
        const contents = [];

        // Build style instruction — use per-scene moods if available, else chapter defaults
        let styleInstruction;
        if (this.preproStyleRef) {
            const sceneMoods = section.mood || this.defaultMoods;
            if (sceneMoods && sceneMoods.length > 0 && this.pixarBase) {
                const MOOD_LABELS = {
                    'translucency': 'Emphasis on light passing through materials — translucent ears, glowing skin edges, light shining through leaves/water/ice. Subsurface scattering cranked up. Back-lit subjects with ethereal glow.',
                    'epic-skies': 'Dramatic, expansive skies dominating the composition — towering clouds, vivid sunset/sunrise gradients, god rays breaking through cloud layers.',
                    'lush-botanical': 'Rich botanical detail filling the frame — individually rendered leaves, visible bark texture, dewdrops on petals, moss on stones, flowers in full bloom.',
                    'soft-intimate': 'Close, warm framing. Shallow depth of field with creamy bokeh. Soft diffused lighting. Warm skin tones, gentle shadows. The feeling of being held close.',
                    'golden-hour': 'Warm golden-hour lighting throughout — long amber shadows, honeyed highlights, everything bathed in the last hour of sunlight.'
                };
                const moodDescriptions = sceneMoods.filter(m => MOOD_LABELS[m]).map(m => MOOD_LABELS[m]);
                styleInstruction = `Match the art style shown in the style reference image. ${this.pixarBase}\n${moodDescriptions.join('\n')}`;
            } else {
                styleInstruction = `Match the art style shown in the style reference image (the last reference image provided). ${this.styleDescription}`;
            }
        } else {
            styleInstruction = `Style: ${this.styleDescription || 'Studio Ghibli warmth, Pixar quality, vibrant colors, magical lighting, child-friendly.'}`;
        }

        const rawActionText = section.action || section.prompt || section.content?.en || 'Generate image';
        const sanitizeResult = await promptSanitizer.sanitize(rawActionText);
        const safeAction = sanitizeResult.sanitized;

        contents.push({
            text: `Create a cheerful, child-friendly illustration. Using the character(s) from the reference image(s), create a heartwarming scene: ${safeAction}

            Keep the characters looking exactly the same as in the reference - same proportions, same features, same distinguishing marks.
            ${section.title && section.title.en ? 'Context: ' + section.title.en : ''}

            ${styleInstruction}
            Absolutely NO text or words in the image.`
        });

        // Store sanitization info for prompt history recording
        section._sanitizeResult = sanitizeResult;

        // Add primary reference image
        contents.push({
            inlineData: {
                mimeType: "image/jpeg",
                data: base64Reference
            }
        });

        // Add additional reference images if multiple characters
        if (section.characterReferences && section.characterReferences.length > 1) {
            for (let i = 1; i < section.characterReferences.length; i++) {
                try {
                    const additionalData = fs.readFileSync(section.characterReferences[i].path);
                    contents.push({
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: additionalData.toString("base64")
                        }
                    });
                    console.log(`   📎 Additional ref: ${path.basename(section.characterReferences[i].path)}`);
                } catch (e) {
                    console.log(`   ⚠️ Could not load additional ref: ${section.characterReferences[i].path}`);
                }
            }
        }

        // Add pre-production style reference if available
        if (this.preproStyleRef) {
            try {
                const styleData = fs.readFileSync(this.preproStyleRef);
                contents.push({
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: styleData.toString("base64")
                    }
                });
                console.log(`   🎨 Style ref: ${path.basename(this.preproStyleRef)}`);
            } catch (e) {
                console.log(`   ⚠️ Could not load style reference`);
            }
        }

        let retries = 3;
        while (retries > 0) {
            try {
                console.log("   🔄 Calling Gemini API with reference image...");
                const response = await ai.models.generateContent({
                    model: "gemini-2.5-flash-image",
                    contents: contents
                });
                
                // Debug response structure
                console.log("   📊 Response received, checking structure...");
                if (!response) {
                    throw new Error("No response from Gemini API");
                }
                
                if (!response.candidates || !response.candidates[0]) {
                    console.error("   ❌ Response missing candidates:", JSON.stringify(response, null, 2));
                    throw new Error("Response missing candidates");
                }
                
                if (!response.candidates[0].content) {
                    console.error("   ❌ Candidate missing content:", JSON.stringify(response.candidates[0], null, 2));
                    throw new Error("Candidate missing content");
                }
                
                if (!response.candidates[0].content.parts) {
                    console.error("   ❌ Content missing parts:", JSON.stringify(response.candidates[0].content, null, 2));
                    throw new Error("Content missing parts");
                }
                
                const parts = response.candidates[0].content.parts;
                for (const part of parts) {
                    if (part.inlineData) {
                        const buffer = Buffer.from(part.inlineData.data, "base64");
                        fs.writeFileSync(outputPath, buffer);
                        console.log(`   ✅ Generated with character reference`);
                        return { success: true, path: outputPath, service: 'gemini' };
                    }
                }

                throw new Error("No image data in response");

            } catch (error) {
                retries--;
                console.error(`   ⚠️ Error: ${error.message}`);

                if (retries > 0) {
                    console.log(`   🔄 Retrying... (${retries} attempts remaining)`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                    throw error;
                }
            }
        }

        throw new Error("Failed after 3 retries");
    }

    /**
     * Generate with Gemini (no reference)
     */
    async generateWithGemini(section, outputPath) {
        const { GoogleGenAI } = require("@google/genai");
        const ai = new GoogleGenAI({ apiKey: this.geminiKey });

        const rawPromptText = section.prompt || section.imageAlt?.en || section.content?.en || 'Generate image';
        const sanitizeResult = await promptSanitizer.sanitize(rawPromptText);
        const promptText = sanitizeResult.sanitized;
        section._sanitizeResult = sanitizeResult;

        const styleInstruction = this.styleDescription
            ? `Style: ${this.styleDescription}`
            : 'Style: Studio Ghibli warmth, Pixar quality, child-friendly, vibrant colors.';

        const prompt = `Create a cheerful, child-friendly illustration: ${promptText}

        ${section.title && section.title.en ? 'Scene: ' + section.title.en : ''}

        ${styleInstruction}
        Absolutely NO text or words in the image.`;

        let retries = 3;
        while (retries > 0) {
            try {
                console.log("   🔄 Calling Gemini API...");
                const response = await ai.models.generateContent({
                    model: "gemini-2.5-flash-image",
                    contents: [{ text: prompt }]
                });

                if (!response || !response.candidates || !response.candidates[0]) {
                    throw new Error("Invalid response structure from Gemini");
                }

                const parts = response.candidates[0].content.parts;
                for (const part of parts) {
                    if (part.inlineData) {
                        const buffer = Buffer.from(part.inlineData.data, "base64");
                        fs.writeFileSync(outputPath, buffer);
                        console.log(`   ✅ Generated with Gemini`);
                        return { success: true, path: outputPath, service: 'gemini' };
                    }
                }

                throw new Error("No image data in response");

            } catch (error) {
                retries--;
                console.error(`   ⚠️ Error: ${error.message}`);

                if (retries > 0) {
                    console.log(`   🔄 Retrying... (${retries} attempts remaining)`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                    throw error;
                }
            }
        }

        throw new Error("Failed after 3 retries");
    }

    /**
     * Generate with OpenAI
     */
    async generateWithOpenAI(section, outputPath) {
        const rawPrompt = section.prompt || section.imageAlt?.en || section.content?.en || 'Generate image';
        const sanitizeResult = await promptSanitizer.sanitize(rawPrompt);
        const prompt = sanitizeResult.sanitized;
        section._sanitizeResult = sanitizeResult;

        const scriptContent = `
const https = require('https');
const fs = require('fs');

const requestData = JSON.stringify({
    model: 'dall-e-3',
    prompt: \`${prompt}
    
    Style: Studio Ghibli warmth, Pixar quality, child-friendly illustration.
    Vibrant colors, magical lighting, cozy atmosphere.
    Absolutely NO text, words, letters, numbers, labels, or captions in the image.\`,
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
                return { success: true, path: outputPath, service: 'openai' };
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
     * @param {object} chapterData - Parsed YAML chapter data
     * @param {string} outputDir - Chapter output directory
     * @param {object} [reportGenerator] - Optional ReportGenerator instance
     */
    async processChapter(chapterData, outputDir, reportGenerator) {
        console.log('\n🎨 Starting Recursive Image Generation');
        console.log('=' .repeat(50));
        console.log(`📖 Chapter: ${chapterData.meta.title.en}`);

        // Store context for hooks
        this.chapterDir = outputDir;
        this._chapterName = chapterData.meta?.folderName || chapterData.meta?.id || path.basename(outputDir);
        this.reportGenerator = reportGenerator || null;
        this.chapterData = chapterData;

        // Extract global style from chapter data
        if (chapterData.imageGeneration && chapterData.imageGeneration.style) {
            this.styleDescription = chapterData.imageGeneration.style.global || '';
        } else {
            this.styleDescription = 'Studio Ghibli warmth, Pixar quality, child-friendly, vibrant colors';
        }

        // Load pre-production references if available
        const hasPreproduction = this.loadPreproduction(outputDir);
        if (hasPreproduction) {
            console.log(`   🎬 Pre-production loaded: ${Object.keys(this.preproCharacterSheets).length} character sheets`);
            if (this.preproStyleRef) {
                console.log(`   🎨 Style: ${this.preproduction.chosenStyle?.name || 'custom'}`);
            }
        }

        // Check Claude availability once at the start
        await this._checkClaudeAvailable();

        // Ensure output directory exists
        const imageDir = path.join(outputDir, 'assets', 'images');
        if (!fs.existsSync(imageDir)) {
            fs.mkdirSync(imageDir, { recursive: true });
        }

        // Build dependency order - include all sections, funFacts, and viewerDetails
        let allSections = chapterData.sections || [];

        if (chapterData.funFacts && chapterData.funFacts.facts) {
            chapterData.funFacts.facts.forEach((fact, index) => {
                if (fact.image) {
                    allSections.push({
                        id: `fun-fact-${index}`,
                        title: fact.title,
                        content: fact.content,
                        image: fact.image,
                        isFunFact: true
                    });
                }
            });
        }

        if (chapterData.viewerDetails) {
            chapterData.viewerDetails.forEach((detail, index) => {
                if (detail.image) {
                    allSections.push({
                        id: `viewer-detail-${index}`,
                        title: detail.title,
                        description: detail.description,
                        image: detail.image,
                        use_character: detail.use_character,
                        action: detail.action,
                        isViewerDetail: true
                    });
                }
            });
        }

        if (chapterData.hero && chapterData.hero.image) {
            allSections.push({
                id: 'hero-section',
                title: chapterData.hero.title,
                subtitle: chapterData.hero.subtitle,
                image: chapterData.hero.image,
                imageAlt: chapterData.hero.imageAlt,
                prompt: chapterData.hero.imageAlt?.en,
                isHero: true
            });
        }

        const sections = allSections;
        const orderedSections = this.buildDependencyOrder(sections);

        console.log(`\n📋 Generation order (${orderedSections.length} sections):`);
        orderedSections.forEach((s, i) => {
            console.log(`   ${i + 1}. ${s.id} ${s.use_character ? `(uses ${this.parseReference(s.use_character)})` : ''}`);
        });

        const needsRegeneration = new Set();

        const results = {
            total: orderedSections.length,
            success: 0,
            failed: 0,
            skipped: 0,
            regenerated: 0
        };

        // First pass
        for (const section of orderedSections) {
            const resolvedSection = this.resolveReferences(section, sections);
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