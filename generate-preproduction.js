#!/usr/bin/env node
/**
 * generate-preproduction.js — Character & style pre-production pipeline
 *
 * Modeled after real animation studio workflows:
 *   Step 0: Storyline generation (Claude CLI generates narrative markdown)
 *   Step 1: Unified character sheet (B&W line art, all characters)
 *   Step 2: Individual character sheets (multi-angle per character)
 *   Step 3: Pixar mood proposals (5 mood combos applied to a test scene)
 *
 * Non-interactive: generates everything, produces a review HTML.
 * Use --review to regenerate the HTML without re-running generation.
 * Use --approve flags to mark steps as approved for downstream pipeline use.
 *
 * Usage:
 *   node generate-preproduction.js <chapter>
 *   node generate-preproduction.js <chapter> --step 1
 *   node generate-preproduction.js <chapter> --review
 *   node generate-preproduction.js <chapter> --status
 *   node generate-preproduction.js <chapter> --approve 1
 *   node generate-preproduction.js <chapter> --approve-style 3
 *   node generate-preproduction.js <chapter> --redo 1 --feedback "bigger ears"
 *   node generate-preproduction.js <chapter> --reset
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { execSync } = require('child_process');
const {
    createGeminiClient,
    geminiTextToImage,
    geminiMultiRefGenerate,
    ROOT
} = require('./automation/image-utils');

// ── Pixar Base + Composable Mood Labels ────────────────────────────

const PIXAR_BASE = `Pixar-quality 3D rendering. Smooth, rounded forms with subsurface scattering on skin. Expressive character animation with large soulful eyes. Rich saturated colors. Photorealistic textures but stylized proportions. Professional children's book illustration quality. Cinematic lighting with warm key light and cool fill.`;

const MOOD_LABELS = {
    'translucency': 'Emphasis on light passing through materials — translucent ears, glowing skin edges, light shining through leaves/water/ice. Subsurface scattering cranked up. Back-lit subjects with ethereal glow.',
    'epic-skies': 'Dramatic, expansive skies dominating the composition — towering clouds, vivid sunset/sunrise gradients, god rays breaking through cloud layers, atmospheric perspective pulling the eye to the horizon.',
    'lush-botanical': 'Rich botanical detail filling the frame — individually rendered leaves, visible bark texture, dewdrops on petals, moss on stones, flowers in full bloom. Nature as living wallpaper.',
    'soft-intimate': 'Close, warm framing. Shallow depth of field with creamy bokeh. Soft diffused lighting like a cozy room. Warm skin tones, gentle shadows. The feeling of being held close.',
    'golden-hour': 'Warm golden-hour lighting throughout — long amber shadows, honeyed highlights, everything bathed in the last hour of sunlight. Warm color temperature across the entire palette.'
};

const MOOD_PROPOSALS = [
    { id: 'translucency-botanical', name: 'Translucency + Lush Botanical', moods: ['translucency', 'lush-botanical'] },
    { id: 'epic-intimate',         name: 'Epic Skies + Soft Intimate',    moods: ['epic-skies', 'soft-intimate'] },
    { id: 'golden-botanical',      name: 'Golden Hour + Lush Botanical',  moods: ['golden-hour', 'lush-botanical'] },
    { id: 'translucency-intimate', name: 'Translucency + Soft Intimate',  moods: ['translucency', 'soft-intimate'] },
    { id: 'epic-golden',           name: 'Epic Skies + Golden + Translucency', moods: ['epic-skies', 'golden-hour', 'translucency'] }
];

function buildMoodPrompt(moods) {
    const moodDescriptions = moods
        .filter(m => MOOD_LABELS[m])
        .map(m => MOOD_LABELS[m]);
    return PIXAR_BASE + '\n\n' + moodDescriptions.join('\n\n');
}

// ── Helpers ─────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function withRetry(fn, { maxRetries = 2, label = 'API call' } = {}) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === maxRetries) throw err;
            const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s
            console.log(`   Retry ${attempt + 1}/${maxRetries} for ${label} in ${delay / 1000}s (${err.message})`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        chapter: null, step: null, status: false, reset: false,
        review: false, approve: null, approveStyle: null,
        redo: null, feedback: null, autoApprove: false
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--step' && args[i + 1]) opts.step = parseInt(args[++i]);
        else if (args[i] === '--status') opts.status = true;
        else if (args[i] === '--reset') opts.reset = true;
        else if (args[i] === '--review') opts.review = true;
        else if (args[i] === '--approve' && args[i + 1]) opts.approve = parseInt(args[++i]);
        else if (args[i] === '--approve-style' && args[i + 1]) opts.approveStyle = parseInt(args[++i]);
        else if (args[i] === '--redo' && args[i + 1]) opts.redo = parseInt(args[++i]);
        else if (args[i] === '--feedback' && args[i + 1]) opts.feedback = args[++i];
        else if (args[i] === '--auto-approve') opts.autoApprove = true;
        else if (!args[i].startsWith('--') && !opts.chapter) opts.chapter = args[i];
    }
    return opts;
}

// ── PreproductionPipeline ───────────────────────────────────────────

class PreproductionPipeline {
    constructor(chapterName) {
        this.chapter = chapterName;
        this.chapterDir = path.join(ROOT, chapterName);
        this.preproDir = path.join(this.chapterDir, 'preproduction');
        this.configPath = path.join(this.preproDir, 'config.json');
        this.config = null;
        this.ai = null;
    }

    // ── Setup ────────────────────────────────────────────────────

    initialize({ needsAI = true } = {}) {
        const yamlPath = path.join(ROOT, 'chapters', `${this.chapter}.yaml`);
        if (!fs.existsSync(yamlPath)) {
            console.error(`Error: Chapter file not found: ${yamlPath}`);
            process.exit(1);
        }
        this.chapterData = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
        this.characters = this._extractCharacters();

        // Create directories
        const dirs = [
            this.preproDir,
            path.join(this.preproDir, 'step0-storyline'),
            path.join(this.preproDir, 'step1-unified'),
            path.join(this.preproDir, 'step3-style'),
            path.join(this.preproDir, 'approved')
        ];
        for (const char of this.characters) {
            dirs.push(path.join(this.preproDir, 'step2-characters', char.id));
        }
        for (const dir of dirs) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this._loadOrCreateConfig();

        if (needsAI) {
            this.ai = createGeminiClient();
        }
    }

    _extractCharacters() {
        const characters = [];
        const imgGen = this.chapterData.imageGeneration || {};
        const charDefs = imgGen.characters || {};

        for (const [id, def] of Object.entries(charDefs)) {
            characters.push({
                id,
                name: def.name || id,
                description: def.description || '',
                uniqueFeatures: def.uniqueFeatures || [],
                personality: def.personality || '',
                notLike: def.notLike || ''
            });
        }

        if (characters.length === 0) {
            for (const s of (this.chapterData.sections || [])) {
                if (s.generate_character) {
                    characters.push({
                        id: s.id.replace('meet-', ''),
                        name: s.title?.en || s.id,
                        description: s.imageAlt?.en || '',
                        uniqueFeatures: [],
                        personality: '',
                        notLike: ''
                    });
                }
            }
        }

        return characters;
    }

    _loadOrCreateConfig() {
        if (fs.existsSync(this.configPath)) {
            try {
                this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            } catch (err) {
                console.error(`   Warning: config.json corrupted (${err.message}), creating fresh config`);
                this.config = null;
            }
        }

        if (this.config) {
            this.config.characters = this.characters;
            // Ensure step2.characters has entries for all characters
            if (!this.config.step2) this.config.step2 = { status: 'pending', characters: {} };
            if (!this.config.step2.characters) this.config.step2.characters = {};
            for (const char of this.characters) {
                if (!this.config.step2.characters[char.id]) {
                    this.config.step2.characters[char.id] = { status: 'pending', attempts: 0 };
                }
            }
        } else {
            this.config = {
                chapter: this.chapter,
                createdAt: new Date().toISOString(),
                characters: this.characters,
                step0: { status: 'pending', attempts: 0, feedback: [] },
                step1: { status: 'pending', attempts: 0, feedback: [] },
                step2: { status: 'pending', characters: {} },
                step3: { status: 'pending', chosenStyle: null, styleName: null, chosenMoods: null }
            };
            for (const char of this.characters) {
                this.config.step2.characters[char.id] = {
                    status: 'pending', attempts: 0
                };
            }
        }
        this._saveConfig();
    }

    _saveConfig() {
        this.config.updatedAt = new Date().toISOString();
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    }

    /**
     * Get the latest version image for step 1 (to use as reference in step 2)
     */
    _getLatestUnified() {
        const dir = path.join(this.preproDir, 'step1-unified');
        if (!fs.existsSync(dir)) return null;

        const approved = path.join(dir, 'approved.jpg');
        if (fs.existsSync(approved)) return approved;

        // Find latest version
        const files = fs.readdirSync(dir)
            .filter(f => f.match(/^unified-cast-v\d+\.jpg$/))
            .sort((a, b) => {
                const va = parseInt(a.match(/v(\d+)/)?.[1] || '0');
                const vb = parseInt(b.match(/v(\d+)/)?.[1] || '0');
                return vb - va;
            });
        return files.length > 0 ? path.join(dir, files[0]) : null;
    }

    /**
     * Get the latest character sheet for a character (to use as reference in step 3)
     */
    _getLatestCharSheet(charId) {
        const dir = path.join(this.preproDir, 'step2-characters', charId);
        if (!fs.existsSync(dir)) return null;

        const approved = path.join(dir, 'approved.jpg');
        if (fs.existsSync(approved)) return approved;

        const files = fs.readdirSync(dir)
            .filter(f => f.match(/^sheet-v\d+\.jpg$/))
            .sort((a, b) => {
                const va = parseInt(a.match(/v(\d+)/)?.[1] || '0');
                const vb = parseInt(b.match(/v(\d+)/)?.[1] || '0');
                return vb - va;
            });
        return files.length > 0 ? path.join(dir, files[0]) : null;
    }

    // ── Step 0: Storyline Generation ──────────────────────────────

    async runStep0(feedback) {
        console.log('\n--- Step 0: Storyline Generation (Claude CLI) ---\n');

        if (!this.config.step0) {
            this.config.step0 = { status: 'pending', attempts: 0, feedback: [] };
        }

        if (this.config.step0.status === 'approved' && !feedback) {
            console.log('   Already approved. Use --redo 0 to regenerate.');
            return;
        }

        // Check if Claude CLI is available
        let claudeAvailable = false;
        try {
            execSync('which claude', { stdio: 'ignore' });
            claudeAvailable = true;
        } catch {
            console.log('   Claude CLI not found. Skipping storyline generation.');
            console.log('   Install with: npm install -g @anthropic-ai/claude-code');
            console.log('   Or write the storyline manually in step0-storyline/storyline-v1.md');
            return;
        }

        const storylineDir = path.join(this.preproDir, 'step0-storyline');
        fs.mkdirSync(storylineDir, { recursive: true });

        // Load reference storylines from existing chapters
        const referenceChapters = ['bears', 'beavers', 'elephants'];
        let referenceSummaries = '';
        for (const refChapter of referenceChapters) {
            const refPath = path.join(ROOT, 'chapters', `${refChapter}.yaml`);
            if (!fs.existsSync(refPath)) continue;
            try {
                const refData = yaml.load(fs.readFileSync(refPath, 'utf8'));
                const title = refData.meta?.title?.en || refChapter;
                const sections = (refData.sections || []).filter(s => !s.hidden);
                const sectionSummary = sections.map(s =>
                    `  - ${s.id}: "${s.title?.en || s.id}" — ${(s.content?.en || '').substring(0, 100)}...`
                ).join('\n');
                const chars = refData.imageGeneration?.characters || {};
                const charSummary = Object.entries(chars).map(([id, c]) =>
                    `  - ${c.name || id}: ${c.description || ''}`
                ).join('\n');
                referenceSummaries += `\n### ${title}\nCharacters:\n${charSummary}\nSections (${sections.length}):\n${sectionSummary}\n`;
            } catch { /* skip unreadable chapters */ }
        }

        const cleanFeedback = feedback ? feedback.replace(/[{}[\]`]/g, '').substring(0, 500) : '';
        const feedbackLine = cleanFeedback
            ? `\n\nIMPORTANT REVISION FEEDBACK from the user: ${cleanFeedback}`
            : '';

        const storylinePrompt = `Generate a children's book storyline for: ${this.chapter.toUpperCase()}

TARGET AUDIENCE: Children aged 1-3 years old.
TONE: Happy, warm, loving, educational. Absolutely NO scary, sad, or dark themes.
REQUIREMENT: Both parents (father AND mother) must be present and loving throughout.

NARRATIVE STRUCTURE (follow this pattern from our reference books):
- Introduction (2-3 sections): Meet the family members one by one
- Learning/Teaching (4-8 sections): The young protagonist learns from parents/elders
- Climax (1 section): A joyful milestone or magical moment that fulfills a promise from early in the story
- Resolution (2-3 sections): The family celebrates together, looking to the future

CHARACTER DESIGN:
- 3-generation or 2-generation family (at minimum: father, mother, young protagonist)
- Each character needs UNIQUE VISUAL FEATURES that make them instantly distinguishable
- Give each character a personality that shows in their body language
- Consider adding a sibling or friend character for variety

REFERENCE STORYLINES (use these as examples of good structure and tone):
${referenceSummaries}

OUTPUT FORMAT (use exactly this markdown structure):
# ${this.chapter.charAt(0).toUpperCase() + this.chapter.slice(1)}: [Your Title]
## Subtitle
[A poetic subtitle]
## Characters
- **Name** (role: father/mother/protagonist/sibling) — Visual description with UNIQUE features. Personality: [brief]. NOT like: [contrast with other characters].
## Storyline
1. **Section Title** (id: section-id) — Content summary describing what happens. [mood: label1, label2]
2. ...
## Fun Facts (4)
1. **Title** — Educational content about the animal
## Viewer Details (4)
1. **Title** — Close-up detail about anatomy/behavior
## Values & Themes
- Theme: explanation of the value being taught
${feedbackLine}

Generate a complete, detailed storyline. Each section summary should be 2-3 sentences describing the narrative, not just a title. Include mood labels from: translucency, epic-skies, lush-botanical, soft-intimate, golden-hour.`;

        this.config.step0.attempts++;
        const version = this.config.step0.attempts;

        console.log(`   Generating storyline (v${version}) via Claude CLI...`);

        try {
            const result = execSync(
                `claude -p ${JSON.stringify(storylinePrompt)}`,
                { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120000 }
            );

            const outputPath = path.join(storylineDir, `storyline-v${version}.md`);
            fs.writeFileSync(outputPath, result);
            console.log(`   Generated: storyline-v${version}.md (${(result.length / 1024).toFixed(1)} KB)`);

            if (feedback) {
                this.config.step0.feedback.push(`v${version}: ${feedback}`);
            }
            this.config.step0.status = 'generated';
            this._saveConfig();
        } catch (err) {
            console.error(`   Error generating storyline: ${err.message}`);
            this.config.step0.attempts--;
            this._saveConfig();
        }
    }

    approveStep0() {
        const storylineDir = path.join(this.preproDir, 'step0-storyline');
        if (!fs.existsSync(storylineDir)) {
            console.log('   No storyline found. Run step 0 first.');
            return;
        }
        const files = fs.readdirSync(storylineDir)
            .filter(f => f.match(/^storyline-v\d+\.md$/))
            .sort((a, b) => {
                const va = parseInt(a.match(/v(\d+)/)?.[1] || '0');
                const vb = parseInt(b.match(/v(\d+)/)?.[1] || '0');
                return vb - va;
            });
        if (files.length === 0) {
            console.log('   No storyline versions found. Run step 0 first.');
            return;
        }
        const latest = files[0];
        const approvedPath = path.join(storylineDir, 'approved.md');
        fs.copyFileSync(path.join(storylineDir, latest), approvedPath);
        const version = latest.match(/v(\d+)/)?.[1] || '?';
        if (!this.config.step0) this.config.step0 = { status: 'pending', attempts: 0, feedback: [] };
        this.config.step0.status = 'approved';
        this.config.step0.approvedVersion = parseInt(version);
        this._saveConfig();
        console.log(`   Step 0 approved (v${version})`);
    }

    // ── Step 1: Unified Character Sheet ──────────────────────────

    async runStep1(feedback) {
        console.log('\n--- Step 1: Unified Character Sheet (B&W) ---\n');

        if (this.config.step1.status === 'approved' && !feedback) {
            console.log('   Already approved. Use --redo 1 to regenerate.');
            return;
        }

        console.log('Characters:');
        this.characters.forEach((c, i) => {
            console.log(`   ${i + 1}. ${c.name} — ${c.description}`);
        });

        this.config.step1.attempts++;
        const version = this.config.step1.attempts;

        console.log(`\n   Generating unified cast sheet (v${version})...`);
        const prompt = this._buildUnifiedSheetPrompt(feedback);

        let buffer;
        try {
            buffer = await withRetry(
                () => geminiTextToImage(this.ai, prompt),
                { label: 'unified cast sheet' }
            );
        } catch (err) {
            console.log(`   API error: ${err.message}`);
            return;
        }
        if (!buffer) {
            console.log('   No image returned from API.');
            return;
        }

        const outputPath = path.join(
            this.preproDir, 'step1-unified', `unified-cast-v${version}.jpg`
        );
        fs.writeFileSync(outputPath, buffer);
        console.log(`   Generated: ${path.basename(outputPath)} (${(buffer.length / 1024).toFixed(0)} KB)`);

        if (feedback) {
            this.config.step1.feedback.push(`v${version}: ${feedback}`);
        }
        this.config.step1.status = 'generated';
        this._saveConfig();
    }

    _buildUnifiedSheetPrompt(feedback) {
        const charList = this.characters.map((c, i) => {
            let entry = `${i + 1}. ${c.name.toUpperCase()} — ${c.description}`;
            if (c.uniqueFeatures && c.uniqueFeatures.length > 0) {
                entry += '\n   KEY VISUAL DIFFERENCES: ' + c.uniqueFeatures.join('; ');
            }
            if (c.personality) {
                entry += '\n   POSE/BODY LANGUAGE: ' + c.personality;
            }
            return entry;
        }).join('\n\n');

        // Build contrast table
        const contrastLines = [];
        for (let i = 0; i < this.characters.length; i++) {
            for (let j = i + 1; j < this.characters.length; j++) {
                const a = this.characters[i];
                const b = this.characters[j];
                contrastLines.push(`${a.name} vs ${b.name}: ${a.notLike || a.description} / ${b.notLike || b.description}`);
            }
        }
        const contrastTable = contrastLines.length > 0
            ? `\nCONTRAST TABLE (each pair MUST look visually different):\n${contrastLines.join('\n')}`
            : '';

        const cleanFeedback = feedback ? feedback.replace(/[{}[\]`]/g, '').substring(0, 500) : '';
        const feedbackLine = cleanFeedback
            ? `\nIMPORTANT REVISION FEEDBACK: ${cleanFeedback}`
            : '';

        return `Create a CHARACTER DESIGN SHEET showing ${this.characters.length} VISUALLY DISTINCT characters side by side.

${charList}
${contrastTable}

CRITICAL DIFFERENTIATION RULES:
- Each character MUST be immediately distinguishable at THUMBNAIL SIZE — different height, build, markings, and pose
- Characters must NOT look like copies of each other — exaggerate the differences
- SIZE MATTERS: show dramatic size differences between adults and young ones
- MARKINGS MATTER: each character's unique colors/patterns/features must be clearly visible and distinct
- POSE MATTERS: each character should have a different body posture that reflects their personality

STYLE RULES:
- BLACK AND WHITE LINE ART with warm, organic, hand-drawn quality — like pencil on animation paper
- Flowing, confident lines with personality — NOT mechanical, NOT vector-clean, NOT sterile
- Show full body of each character with feet visible
- Large, soulful, expressive eyes
- Simple clean white/cream background like animation paper
- Put the character name as a small label below each one
- This is a REFERENCE SHEET — warmth and charm above all
${feedbackLine}`;
    }

    // ── Step 2: Individual Character Sheets ───────────────────────

    async runStep2(feedback) {
        console.log('\n--- Step 2: Individual Character Sheets ---\n');

        const unifiedPath = this._getLatestUnified();
        if (!unifiedPath) {
            console.error('   No unified sheet found. Run Step 1 first.');
            return;
        }
        console.log(`   Using unified ref: ${path.basename(unifiedPath)}`);

        if (this.config.step2.status === 'approved' && !feedback) {
            console.log('   Already approved. Use --redo 2 to regenerate.');
            return;
        }

        for (const char of this.characters) {
            if (!this.config.step2.characters[char.id]) {
                this.config.step2.characters[char.id] = { status: 'pending', attempts: 0 };
            }

            const charConfig = this.config.step2.characters[char.id];

            // Skip if already generated (unless redo with feedback)
            if (charConfig.status !== 'pending' && !feedback) {
                console.log(`   ${char.name} — already generated, skipping`);
                continue;
            }

            const version = charConfig.attempts + 1;

            console.log(`   Generating ${char.name} sheet (v${version})...`);
            const prompt = this._buildCharacterSheetPrompt(char, feedback);

            try {
                const buffer = await withRetry(
                    () => geminiMultiRefGenerate(this.ai, [unifiedPath], prompt),
                    { label: `${char.name} sheet` }
                );
                if (!buffer) {
                    console.log(`   No image returned for ${char.name}.`);
                    continue;
                }

                const charDir = path.join(this.preproDir, 'step2-characters', char.id);
                const outputPath = path.join(charDir, `sheet-v${version}.jpg`);
                fs.writeFileSync(outputPath, buffer);
                console.log(`   Generated: ${char.id}/sheet-v${version}.jpg (${(buffer.length / 1024).toFixed(0)} KB)`);

                // Only update config after successful generation
                charConfig.attempts = version;
                charConfig.status = 'generated';
                this._saveConfig();
            } catch (err) {
                console.error(`   Error generating ${char.name}: ${err.message}`);
            }

            // Rate limit delay between characters
            await new Promise(r => setTimeout(r, 2000));
        }

        this.config.step2.status = 'generated';
        this._saveConfig();
    }

    _buildCharacterSheetPrompt(character, feedback) {
        const cleanFeedback = feedback ? feedback.replace(/[{}[\]`]/g, '').substring(0, 500) : '';
        const feedbackLine = cleanFeedback
            ? `\nIMPORTANT REVISION FEEDBACK: ${cleanFeedback}`
            : '';

        const uniqueFeaturesBlock = character.uniqueFeatures && character.uniqueFeatures.length > 0
            ? `\nUNIQUE IDENTIFYING FEATURES (these MUST be clearly visible in ALL four views):\n${character.uniqueFeatures.map(f => `- ${f}`).join('\n')}`
            : '';

        const personalityBlock = character.personality
            ? `\nPERSONALITY THROUGH POSE: ${character.personality}`
            : '';

        const notLikeBlock = character.notLike
            ? `\nIMPORTANT — THIS CHARACTER IS: ${character.notLike}`
            : '';

        return `Using the UNIFIED CAST SHEET as reference for species anatomy, create a detailed CHARACTER MODEL SHEET for: ${character.name.toUpperCase()}

Character description: ${character.description}
${uniqueFeaturesBlock}
${personalityBlock}
${notLikeBlock}

Show this character from FOUR angles arranged in a 2x2 grid:
- TOP LEFT: Front view (facing the camera directly)
- TOP RIGHT: 3/4 view (turned slightly to the right)
- BOTTOM LEFT: Side profile (full side view, facing left)
- BOTTOM RIGHT: Close-up of head and face showing expression and key features

RULES:
- Use the reference for SPECIES ANATOMY only — apply the UNIQUE FEATURES listed above
- The unique features must be EXAGGERATED and clearly visible — they are what makes this character recognizable
- BLACK AND WHITE LINE ART with warm, hand-drawn quality
- Flowing, organic lines with natural variation in line weight
- Large, soulful, expressive eyes in the close-up view
- All four views must be clearly the SAME character, consistent across every angle
- Simple white/cream background like animation paper
- Label each view (Front, 3/4, Side, Close-up)
${feedbackLine}`;
    }

    // ── Step 3: Style Proposals ──────────────────────────────────

    async runStep3() {
        console.log('\n--- Step 3: Pixar Mood Proposals ---\n');

        if (this.config.step3.status === 'approved') {
            console.log('   Already approved. Use --redo 3 to regenerate.');
            return;
        }

        // Collect character sheets as reference images
        const refPaths = [];
        for (const char of this.characters) {
            const sheetPath = this._getLatestCharSheet(char.id);
            if (sheetPath) refPaths.push(sheetPath);
        }

        if (refPaths.length === 0) {
            console.error('   No character sheets found. Run Step 2 first.');
            return;
        }
        console.log(`   Using ${refPaths.length} character sheet(s) as reference`);

        const testScene = this._pickTestScene();
        console.log(`   Test scene: "${testScene.title}"`);
        console.log(`   ${testScene.action}\n`);

        fs.writeFileSync(
            path.join(this.preproDir, 'step3-style', 'test-scene.txt'),
            `Scene: ${testScene.title}\nAction: ${testScene.action}`
        );

        console.log('   Generating 5 Pixar mood proposals...\n');

        for (let i = 0; i < MOOD_PROPOSALS.length; i++) {
            const proposal = MOOD_PROPOSALS[i];
            const outputPath = path.join(
                this.preproDir, 'step3-style', `proposal-${i + 1}-${proposal.id}.jpg`
            );

            if (fs.existsSync(outputPath)) {
                console.log(`   [${i + 1}/5] ${proposal.name} — already generated`);
                continue;
            }

            process.stdout.write(`   [${i + 1}/5] ${proposal.name}...`);

            try {
                const prompt = this._buildStylePrompt(proposal, testScene);
                const buffer = await withRetry(
                    () => geminiMultiRefGenerate(this.ai, refPaths, prompt),
                    { label: proposal.name }
                );

                if (buffer) {
                    fs.writeFileSync(outputPath, buffer);
                    console.log(` done (${(buffer.length / 1024).toFixed(0)} KB)`);
                } else {
                    console.log(` no image returned`);
                }
            } catch (err) {
                console.log(` error: ${err.message}`);
            }

            // Rate limit delay between proposals
            if (i < MOOD_PROPOSALS.length - 1) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }

        this.config.step3.status = 'generated';
        this._saveConfig();
    }

    _pickTestScene() {
        for (const s of (this.chapterData.sections || [])) {
            if (s.use_characters && s.use_characters.length >= 2 && s.action) {
                return { title: s.title?.en || s.id, action: s.action };
            }
        }
        for (const s of (this.chapterData.sections || [])) {
            if (s.action) {
                return { title: s.title?.en || s.id, action: s.action };
            }
        }
        return {
            title: this.chapterData.meta?.title?.en || this.chapter,
            action: `A warm, child-friendly scene featuring the main characters from a children's book about ${this.chapter}`
        };
    }

    _buildStylePrompt(proposal, testScene, feedback) {
        const cleanFeedback = feedback ? feedback.replace(/[{}[\]`]/g, '').substring(0, 500) : '';
        const feedbackLine = cleanFeedback ? `\nIMPORTANT REVISION: ${cleanFeedback}` : '';

        const moodPrompt = buildMoodPrompt(proposal.moods);

        return `Create a beautiful children's book illustration for this scene:

SCENE: ${testScene.action}

Use the characters from the provided reference sheets. Keep their proportions, features, and distinguishing marks exactly as shown in the references.

ART STYLE AND MOOD:
${moodPrompt}

MOOD EMPHASIS FOR THIS PROPOSAL: ${proposal.name}

RULES:
- Match the characters to the reference sheets — same proportions, same unique features
- Apply the Pixar rendering style with the specific mood emphasis described above
- Warm, inviting, child-friendly atmosphere
- Rich, detailed background appropriate to the scene's setting
- NO text, labels, watermarks, or signatures
- Professional illustration quality suitable for a printed children's book
- The scene should feel alive, warm, and full of gentle emotion
${feedbackLine}`;
    }

    // ── Approve ──────────────────────────────────────────────────

    approveStep(stepNum) {
        if (stepNum === 0) {
            this.approveStep0();
            return;
        }
        if (stepNum === 1) {
            const latest = this._getLatestUnified();
            if (!latest) {
                console.log('   No unified sheet to approve. Run step 1 first.');
                return;
            }
            const approvedPath = path.join(this.preproDir, 'step1-unified', 'approved.jpg');
            fs.copyFileSync(latest, approvedPath);
            const version = path.basename(latest).match(/v(\d+)/)?.[1] || '?';
            this.config.step1.status = 'approved';
            this.config.step1.approvedVersion = parseInt(version);
            this._saveConfig();
            console.log(`   Step 1 approved (v${version})`);
        } else if (stepNum === 2) {
            let allApproved = true;
            for (const char of this.characters) {
                const latest = this._getLatestCharSheet(char.id);
                if (!latest) {
                    console.log(`   No sheet for ${char.name}. Run step 2 first.`);
                    allApproved = false;
                    continue;
                }
                const charDir = path.join(this.preproDir, 'step2-characters', char.id);
                fs.copyFileSync(latest, path.join(charDir, 'approved.jpg'));
                const version = path.basename(latest).match(/v(\d+)/)?.[1] || '?';
                this.config.step2.characters[char.id].status = 'approved';
                this.config.step2.characters[char.id].approvedVersion = parseInt(version);
                console.log(`   ${char.name} approved (v${version})`);
            }
            if (allApproved) {
                this.config.step2.status = 'approved';
            }
            this._saveConfig();
        }
    }

    approveStyle(choice) {
        if (choice < 1 || choice > 5) {
            console.log('   Invalid choice. Pick 1-5.');
            return;
        }
        const proposal = MOOD_PROPOSALS[choice - 1];
        const chosenPath = path.join(
            this.preproDir, 'step3-style', `proposal-${choice}-${proposal.id}.jpg`
        );
        if (!fs.existsSync(chosenPath)) {
            console.log(`   Proposal ${choice} not found. Run step 3 first.`);
            return;
        }
        const approvedPath = path.join(this.preproDir, 'step3-style', 'approved.jpg');
        fs.copyFileSync(chosenPath, approvedPath);
        this.config.step3.status = 'approved';
        this.config.step3.chosenStyle = choice;
        this.config.step3.styleName = proposal.id;
        this.config.step3.chosenMoods = proposal.moods;
        this.config.step3.styleDescription = buildMoodPrompt(proposal.moods);
        this._saveConfig();
        console.log(`   Mood chosen: ${proposal.name} (${proposal.moods.join(', ')})`);
    }

    // ── Package Approved ─────────────────────────────────────────

    packageApproved() {
        console.log('\n--- Packaging Approved References ---\n');

        const approvedDir = path.join(this.preproDir, 'approved');
        fs.mkdirSync(approvedDir, { recursive: true });

        const unifiedSrc = path.join(this.preproDir, 'step1-unified', 'approved.jpg');
        if (fs.existsSync(unifiedSrc)) {
            fs.copyFileSync(unifiedSrc, path.join(approvedDir, 'unified-cast.jpg'));
            console.log('   unified-cast.jpg');
        }

        const characterSheets = {};
        for (const char of this.characters) {
            const sheetSrc = path.join(this.preproDir, 'step2-characters', char.id, 'approved.jpg');
            if (fs.existsSync(sheetSrc)) {
                const destName = `${char.id}-sheet.jpg`;
                fs.copyFileSync(sheetSrc, path.join(approvedDir, destName));
                const sectionId = this._findSectionIdForCharacter(char.id);
                characterSheets[sectionId || char.id] = destName;
                console.log(`   ${destName}`);
            }
        }

        const styleSrc = path.join(this.preproDir, 'step3-style', 'approved.jpg');
        if (fs.existsSync(styleSrc)) {
            fs.copyFileSync(styleSrc, path.join(approvedDir, 'style-reference.jpg'));
            console.log('   style-reference.jpg');
        }

        const chosenProposal = MOOD_PROPOSALS.find(p => p.id === this.config.step3.styleName);
        const chosenMoods = this.config.step3.chosenMoods || chosenProposal?.moods || [];
        const manifest = {
            chapter: this.chapter,
            completedAt: new Date().toISOString(),
            unifiedCast: 'unified-cast.jpg',
            characterSheets,
            styleReference: 'style-reference.jpg',
            chosenStyle: {
                id: this.config.step3.styleName,
                name: chosenProposal?.name || this.config.step3.styleName || '',
                base: PIXAR_BASE,
                moods: chosenMoods,
                description: this.config.step3.styleDescription || buildMoodPrompt(chosenMoods)
            }
        };
        fs.writeFileSync(
            path.join(approvedDir, 'preproduction-manifest.json'),
            JSON.stringify(manifest, null, 2)
        );
        console.log('   preproduction-manifest.json');

        console.log('\n   Pre-production complete!');
        console.log(`   Next: node generate-chapter.js ${this.chapter}`);
    }

    _findSectionIdForCharacter(charId) {
        for (const s of (this.chapterData.sections || [])) {
            if (s.generate_character) {
                if (s.id.includes(charId) || s.id === charId) return s.id;
            }
        }
        return null;
    }

    // ── Review HTML ──────────────────────────────────────────────

    generateReviewHTML() {
        const data = this.chapterData;
        const meta = data.meta || {};
        const title = meta.title?.en || this.chapter;
        const subtitle = meta.subtitle?.en || '';
        const date = meta.date || '';
        const description = meta.description || '';
        const preface = meta.preface?.en || [];
        const style = data.imageGeneration?.style?.global || 'Not defined';

        const imgDir = path.join(this.chapterDir, 'assets', 'images');
        const imgExists = (filename) => fs.existsSync(path.join(imgDir, filename));
        const imgSrc = (filename) => `../assets/images/${filename}`;

        const visibleSections = (data.sections || []).filter(s => !s.hidden);
        const hiddenSections = (data.sections || []).filter(s => s.hidden);

        const routing = data.routing || {};
        const routingMap = {};
        for (const [provider, files] of Object.entries(routing)) {
            for (const f of files) routingMap[f] = provider;
        }

        // ── Build sections HTML ──
        let sectionsHTML = '';
        for (const s of visibleSections) {
            const sTitle = s.title?.en || s.id;
            const sContent = s.content?.en || '';
            const sImage = s.image || '';
            const sAction = s.action || '';
            const sAlt = s.imageAlt?.en || sTitle;
            const sRoute = routingMap[sImage] || '—';
            const hasImg = sImage && imgExists(sImage);
            const isCharacter = s.generate_character;
            const useChar = s.use_character || '';
            const useChars = s.use_characters || [];
            const refs = [useChar, ...useChars].filter(Boolean).map(r =>
                r.replace(/\$\{(.+?)\.image\}/g, '$1')
            );

            sectionsHTML += `
            <div class="section-card ${isCharacter ? 'character-card' : ''}">
                <div class="section-header">
                    <span class="section-id">${escapeHtml(s.id)}</span>
                    ${isCharacter ? '<span class="badge badge-character">CHARACTER</span>' : ''}
                    <span class="badge badge-${escapeHtml(sRoute)}">${escapeHtml(sRoute).toUpperCase()}</span>
                </div>
                <h3>${escapeHtml(sTitle)}</h3>
                ${hasImg ? `<img src="${imgSrc(sImage)}" alt="${escapeHtml(sAlt)}" class="section-image" loading="lazy" />` :
                    sImage ? `<div class="missing-image">Missing: ${escapeHtml(sImage)}</div>` : ''}
                <p class="section-content">${escapeHtml(sContent)}</p>
                ${sAction ? `<div class="prompt-block"><strong>Action prompt:</strong> ${escapeHtml(sAction)}</div>` : ''}
                ${refs.length ? `<div class="refs">References: ${refs.map(escapeHtml).join(', ')}</div>` : ''}
                <div class="image-filename">${escapeHtml(sImage || 'No image')}</div>
            </div>`;
        }

        // ── Hidden sections ──
        let hiddenHTML = '';
        for (const s of hiddenSections) {
            if (s.isMagazineCover) continue;
            const sImage = s.image || '';
            const hasImg = sImage && imgExists(sImage);
            const sPrompt = s.prompt || s.action || '';
            const sRef = s.referenceImage || '';
            const refClean = sRef.replace(/\$\{(.+?)\.image\}/g, '$1');

            hiddenHTML += `
            <div class="hidden-section-card">
                <span class="section-id">${s.id}</span>
                <span class="badge badge-${routingMap[sImage] || 'unknown'}">${(routingMap[sImage] || '—').toUpperCase()}</span>
                ${hasImg ? `<img src="${imgSrc(sImage)}" alt="${s.id}" class="thumb" loading="lazy" />` :
                    `<div class="missing-thumb">Missing</div>`}
                ${sPrompt ? `<p class="small-prompt">${sPrompt.substring(0, 120)}...</p>` : ''}
                ${refClean ? `<span class="refs">Ref: ${refClean}</span>` : ''}
            </div>`;
        }

        // ── Characters ──
        let charsHTML = '';
        for (const c of this.characters) {
            const charSection = visibleSections.find(s =>
                s.generate_character && (s.id.includes(c.id) || s.id === c.id)
            );
            const portrait = charSection?.image;
            const hasPortrait = portrait && imgExists(portrait);

            charsHTML += `
            <div class="character-profile">
                ${hasPortrait ? `<img src="${imgSrc(portrait)}" alt="${c.name}" class="character-thumb" loading="lazy" />` :
                    `<div class="character-thumb-placeholder">${c.name[0]}</div>`}
                <div class="character-info">
                    <h4>${escapeHtml(c.name)}</h4>
                    <p>${escapeHtml(c.description)}</p>
                    <span class="small-text">${escapeHtml(portrait || 'No portrait')}</span>
                </div>
            </div>`;
        }

        // ── Viewer Details ──
        let viewerHTML = '';
        for (const v of (data.viewerDetails || [])) {
            const vTitle = v.title?.en || '';
            const vDesc = v.description?.en || '';
            const vImage = v.image || '';
            const hasImg = vImage && imgExists(vImage);
            viewerHTML += `
            <div class="detail-card">
                ${hasImg ? `<img src="${imgSrc(vImage)}" alt="${vTitle}" class="detail-image" loading="lazy" />` :
                    `<div class="missing-thumb">Missing: ${vImage}</div>`}
                <h4>${vTitle}</h4>
                <p>${vDesc}</p>
            </div>`;
        }

        // ── Fun Facts ──
        let factsHTML = '';
        for (const f of (data.funFacts?.facts || [])) {
            const fTitle = f.title?.en || '';
            const fContent = f.content?.en || '';
            const fImage = f.image || '';
            const hasImg = fImage && imgExists(fImage);
            factsHTML += `
            <div class="detail-card">
                ${hasImg ? `<img src="${imgSrc(fImage)}" alt="${fTitle}" class="detail-image" loading="lazy" />` :
                    `<div class="missing-thumb">Missing: ${fImage}</div>`}
                <h4>${fTitle}</h4>
                <p>${fContent}</p>
            </div>`;
        }

        // ── Magazine Cover ──
        const coverSection = (data.sections || []).find(s => s.isMagazineCover);
        const coverImage = coverSection?.image || meta.magazineCover;
        const hasCover = coverImage && imgExists(coverImage);

        // ── Pre-production status ──
        const s0 = this.config.step0 || { status: 'pending', attempts: 0 };
        const s1 = this.config.step1;
        const s2 = this.config.step2;
        const s3 = this.config.step3;

        let preproStatusHTML = `
        <div class="prepro-grid" style="grid-template-columns: repeat(4, 1fr);">
            <div class="prepro-step ${s0.status === 'approved' ? 'step-approved' : 'step-pending'}">
                <h4>Step 0: Storyline</h4>
                <p>${s0.status} (${s0.attempts} attempts)</p>
                ${s0.status === 'approved' ? '<span class="check">Approved</span>' : `<span class="pending">${s0.status}</span>`}
            </div>
            <div class="prepro-step ${s1.status === 'approved' ? 'step-approved' : 'step-pending'}">
                <h4>Step 1: Unified Cast Sheet</h4>
                <p>${s1.status} (${s1.attempts} attempts)</p>
                ${s1.status === 'approved' ? '<span class="check">Approved</span>' : `<span class="pending">${s1.status}</span>`}
            </div>
            <div class="prepro-step ${s2.status === 'approved' ? 'step-approved' : 'step-pending'}">
                <h4>Step 2: Character Sheets</h4>
                <p>${s2.status}</p>
                ${this.characters.map(c => {
                    const cs = s2.characters[c.id];
                    return `<span class="${cs?.status === 'approved' ? 'check' : 'pending'}">${c.name}: ${cs?.status || 'pending'}</span>`;
                }).join('<br>')}
            </div>
            <div class="prepro-step ${s3.status === 'approved' ? 'step-approved' : 'step-pending'}">
                <h4>Step 3: Mood Proposals</h4>
                <p>${s3.status}</p>
                ${s3.chosenMoods ? `<span class="check">Moods: ${s3.chosenMoods.join(', ')}</span>` :
                  s3.styleName ? `<span class="check">Chosen: ${s3.styleName}</span>` :
                  `<span class="pending">${s3.status}</span>`}
            </div>
        </div>`;

        // ── Storyline ──
        let storylineHTML = '';
        const storylineDir = path.join(this.preproDir, 'step0-storyline');
        if (fs.existsSync(storylineDir)) {
            const approvedStoryline = path.join(storylineDir, 'approved.md');
            const storylineFiles = fs.readdirSync(storylineDir)
                .filter(f => f.endsWith('.md'))
                .sort();
            if (storylineFiles.length > 0) {
                const latestFile = fs.existsSync(approvedStoryline)
                    ? 'approved.md'
                    : storylineFiles[storylineFiles.length - 1];
                const content = fs.readFileSync(path.join(storylineDir, latestFile), 'utf8');
                storylineHTML = `<h3>Storyline (${latestFile})</h3>
                <div style="background:var(--surface);border-radius:8px;padding:20px;border:1px solid var(--border);max-height:400px;overflow-y:auto;white-space:pre-wrap;font-size:0.9em;color:var(--text-dim);">${escapeHtml(content)}</div>`;
            }
        }

        // ── Pre-production images ──
        let preproImagesHTML = '';
        const unifiedDir = path.join(this.preproDir, 'step1-unified');
        if (fs.existsSync(unifiedDir)) {
            const unifiedFiles = fs.readdirSync(unifiedDir).filter(f => f.endsWith('.jpg')).sort();
            if (unifiedFiles.length > 0) {
                preproImagesHTML += '<h3>Step 1: Unified Cast Sheets</h3><div class="image-grid prepro-image-grid">';
                for (const f of unifiedFiles) {
                    const isApproved = f === 'approved.jpg';
                    preproImagesHTML += `
                    <div class="grid-item ${isApproved ? 'approved-item' : ''}">
                        <img src="step1-unified/${f}" alt="${f}" loading="lazy" />
                        <span>${f}${isApproved ? ' (APPROVED)' : ''}</span>
                    </div>`;
                }
                preproImagesHTML += '</div>';
            }
        }

        for (const char of this.characters) {
            const charDir = path.join(this.preproDir, 'step2-characters', char.id);
            if (fs.existsSync(charDir)) {
                const charFiles = fs.readdirSync(charDir).filter(f => f.endsWith('.jpg')).sort();
                if (charFiles.length > 0) {
                    preproImagesHTML += `<h3>Step 2: ${char.name} Sheets</h3><div class="image-grid prepro-image-grid">`;
                    for (const f of charFiles) {
                        const isApproved = f === 'approved.jpg';
                        preproImagesHTML += `
                        <div class="grid-item ${isApproved ? 'approved-item' : ''}">
                            <img src="step2-characters/${char.id}/${f}" alt="${f}" loading="lazy" />
                            <span>${f}${isApproved ? ' (APPROVED)' : ''}</span>
                        </div>`;
                    }
                    preproImagesHTML += '</div>';
                }
            }
        }

        const styleDir = path.join(this.preproDir, 'step3-style');
        if (fs.existsSync(styleDir)) {
            const styleFiles = fs.readdirSync(styleDir).filter(f => f.endsWith('.jpg')).sort();
            if (styleFiles.length > 0) {
                preproImagesHTML += '<h3>Step 3: Pixar Mood Proposals</h3><div class="image-grid prepro-image-grid">';
                for (const f of styleFiles) {
                    const isApproved = f === 'approved.jpg';
                    const styleName = f.replace('proposal-', '').replace('.jpg', '');
                    preproImagesHTML += `
                    <div class="grid-item ${isApproved ? 'approved-item' : ''}">
                        <img src="step3-style/${f}" alt="${f}" loading="lazy" />
                        <span>${isApproved ? 'APPROVED' : styleName}</span>
                    </div>`;
                }
                preproImagesHTML += '</div>';
            }
        }

        // ── Full image grid ──
        let gridHTML = '';
        if (fs.existsSync(imgDir)) {
            const allImages = fs.readdirSync(imgDir).filter(f => f.endsWith('.jpg')).sort();
            for (const f of allImages) {
                const route = routingMap[f] || '—';
                gridHTML += `
                <div class="grid-item">
                    <img src="../assets/images/${f}" alt="${f}" loading="lazy" />
                    <span>${f}</span>
                    <span class="badge badge-${route}" style="font-size:10px">${route}</span>
                </div>`;
            }
        }

        const allImages = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).filter(f => f.endsWith('.jpg')) : [];

        // ── Assemble HTML ──
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Production Bible — ${title}</title>
<style>
    :root {
        --bg: #0d1117; --surface: #161b22; --surface2: #21262d; --border: #30363d;
        --text: #e6edf3; --text-dim: #8b949e; --accent: #58a6ff; --green: #3fb950;
        --orange: #d29922; --red: #f85149; --purple: #bc8cff;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        background: var(--bg); color: var(--text); line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
    .hero-header { text-align: center; padding: 48px 24px; border-bottom: 1px solid var(--border); margin-bottom: 32px; }
    .hero-header h1 { font-size: 2.5em; margin-bottom: 8px; }
    .hero-header .subtitle { color: var(--accent); font-size: 1.3em; margin-bottom: 16px; }
    .hero-header .meta-line { color: var(--text-dim); font-size: 0.9em; }
    .hero-header .description { max-width: 700px; margin: 16px auto; color: var(--text-dim); }
    .hero-image { width: 100%; max-height: 400px; object-fit: cover; border-radius: 12px; margin-top: 24px; border: 1px solid var(--border); }
    h2 { font-size: 1.5em; margin: 40px 0 20px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); display: inline-block; }
    h3 { font-size: 1.2em; margin: 24px 0 12px; color: var(--accent); }
    .preface { background: var(--surface); border-radius: 8px; padding: 24px; border-left: 4px solid var(--accent); margin-bottom: 32px; }
    .preface p { margin-bottom: 12px; color: var(--text-dim); }
    .preface p:last-child { margin-bottom: 0; }
    .style-banner { background: linear-gradient(135deg, #1a1e2e, #1e2636); border-radius: 8px; padding: 20px 24px; border: 1px solid var(--purple); margin-bottom: 32px; }
    .style-banner strong { color: var(--purple); }
    .characters-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .character-profile { display: flex; gap: 16px; background: var(--surface); border-radius: 8px; padding: 16px; border: 1px solid var(--border); }
    .character-thumb { width: 100px; height: 100px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
    .character-thumb-placeholder { width: 100px; height: 100px; border-radius: 8px; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: 2em; color: var(--text-dim); flex-shrink: 0; }
    .character-info h4 { margin-bottom: 4px; }
    .character-info p { color: var(--text-dim); font-size: 0.9em; }
    .small-text { color: var(--text-dim); font-size: 0.75em; font-family: monospace; }
    .sections-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 20px; margin-bottom: 32px; }
    .section-card { background: var(--surface); border-radius: 8px; padding: 16px; border: 1px solid var(--border); }
    .section-card.character-card { border-color: var(--green); }
    .section-header { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
    .section-id { font-family: monospace; color: var(--text-dim); font-size: 0.8em; }
    .section-image { width: 100%; border-radius: 6px; margin: 12px 0; max-height: 300px; object-fit: cover; }
    .section-content { color: var(--text-dim); font-size: 0.9em; margin: 8px 0; max-height: 80px; overflow: hidden; }
    .prompt-block { background: var(--surface2); padding: 8px 12px; border-radius: 4px; font-size: 0.8em; margin: 8px 0; color: var(--text-dim); border-left: 3px solid var(--orange); }
    .refs { font-size: 0.8em; color: var(--purple); margin-top: 4px; }
    .image-filename { font-family: monospace; font-size: 0.75em; color: var(--text-dim); margin-top: 8px; }
    .missing-image { background: var(--surface2); border: 2px dashed var(--red); border-radius: 6px; padding: 40px; text-align: center; color: var(--red); margin: 12px 0; }
    .missing-thumb { background: var(--surface2); border: 1px dashed var(--red); border-radius: 4px; padding: 12px; text-align: center; color: var(--red); font-size: 0.8em; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.7em; font-weight: 600; text-transform: uppercase; }
    .badge-gemini { background: #1a3a2a; color: var(--green); }
    .badge-openai { background: #2a2a1a; color: var(--orange); }
    .badge-unknown { background: var(--surface2); color: var(--text-dim); }
    .badge-character { background: #1a2a1a; color: var(--green); }
    .details-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .detail-card { background: var(--surface); border-radius: 8px; padding: 16px; border: 1px solid var(--border); }
    .detail-image { width: 100%; border-radius: 6px; margin-bottom: 12px; max-height: 200px; object-fit: cover; }
    .detail-card h4 { margin-bottom: 8px; }
    .detail-card p { color: var(--text-dim); font-size: 0.85em; }
    .hidden-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; margin-bottom: 32px; }
    .hidden-section-card { background: var(--surface); border-radius: 6px; padding: 12px; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
    .thumb { width: 100%; height: 120px; object-fit: cover; border-radius: 4px; }
    .small-prompt { font-size: 0.75em; color: var(--text-dim); }
    .prepro-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
    .prepro-step { background: var(--surface); border-radius: 8px; padding: 20px; border: 2px solid var(--border); text-align: center; }
    .prepro-step h4 { margin-bottom: 8px; }
    .prepro-step p { color: var(--text-dim); font-size: 0.9em; margin-bottom: 8px; }
    .step-approved { border-color: var(--green); }
    .step-pending { border-color: var(--orange); }
    .check { color: var(--green); font-weight: 600; }
    .pending { color: var(--orange); font-weight: 600; }
    .image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 32px; }
    .prepro-image-grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
    .prepro-image-grid .grid-item img { height: 280px; }
    .grid-item { background: var(--surface); border-radius: 6px; overflow: hidden; border: 1px solid var(--border); text-align: center; }
    .grid-item img { width: 100%; height: 160px; object-fit: cover; }
    .grid-item span { display: block; padding: 4px 8px; font-size: 0.7em; color: var(--text-dim); font-family: monospace; }
    .approved-item { border-color: var(--green); border-width: 2px; }
    .approved-item span { color: var(--green); }
    .cover-section { text-align: center; margin-bottom: 32px; }
    .cover-image { max-width: 400px; border-radius: 8px; border: 2px solid var(--accent); }
    .stats-bar { display: flex; gap: 24px; justify-content: center; flex-wrap: wrap; padding: 20px; background: var(--surface); border-radius: 8px; margin-bottom: 32px; }
    .stat { text-align: center; }
    .stat .num { font-size: 2em; font-weight: 700; color: var(--accent); }
    .stat .label { font-size: 0.8em; color: var(--text-dim); }
    footer { text-align: center; padding: 32px; color: var(--text-dim); font-size: 0.8em; border-top: 1px solid var(--border); margin-top: 40px; }
    @media (max-width: 768px) {
        .prepro-grid { grid-template-columns: 1fr; }
        .sections-grid { grid-template-columns: 1fr; }
        .hero-header h1 { font-size: 1.8em; }
    }
</style>
</head>
<body>
<div class="container">
    <div class="hero-header">
        <h1>${title}</h1>
        <div class="subtitle">${subtitle}</div>
        <div class="meta-line">${date} &bull; Issue #${meta.issueNumber || '?'} &bull; Chapter: ${this.chapter}</div>
        <p class="description">${description}</p>
        ${hasCover ? `<img src="../assets/images/${coverImage}" alt="Magazine Cover" class="hero-image" />` :
            imgExists('hero-savanna-sunrise.jpg') ? `<img src="../assets/images/hero-savanna-sunrise.jpg" alt="Hero" class="hero-image" />` : ''}
    </div>

    <div class="stats-bar">
        <div class="stat"><div class="num">${this.characters.length}</div><div class="label">Characters</div></div>
        <div class="stat"><div class="num">${visibleSections.length}</div><div class="label">Scenes</div></div>
        <div class="stat"><div class="num">${(data.viewerDetails || []).length}</div><div class="label">Viewer Details</div></div>
        <div class="stat"><div class="num">${(data.funFacts?.facts || []).length}</div><div class="label">Fun Facts</div></div>
        <div class="stat"><div class="num">${allImages.length}</div><div class="label">Total Images</div></div>
        <div class="stat"><div class="num">${allImages.filter(f => routingMap[f] === 'gemini').length} / ${allImages.filter(f => routingMap[f] === 'openai').length}</div><div class="label">Gemini / OpenAI</div></div>
    </div>

    <h2>Preface</h2>
    <div class="preface">
        ${preface.map(p => `<p>${p}</p>`).join('\n')}
    </div>

    <h2>Art Direction</h2>
    <div class="style-banner">
        <strong>Global Style:</strong> ${style}
    </div>

    <h2>Pre-Production Pipeline</h2>
    ${preproStatusHTML}
    ${storylineHTML}
    ${preproImagesHTML}

    <h2>Character Cast</h2>
    <div class="characters-grid">${charsHTML}</div>

    <h2>Scene Plan (${visibleSections.length} scenes)</h2>
    <div class="sections-grid">${sectionsHTML}</div>

    <h2>Viewer Details</h2>
    <div class="details-grid">${viewerHTML}</div>

    <h2>Fun Facts</h2>
    <div class="details-grid">${factsHTML}</div>

    <h2>Hidden Generation Sections</h2>
    <div class="hidden-grid">${hiddenHTML}</div>

    ${hasCover ? `
    <h2>Magazine Cover</h2>
    <div class="cover-section">
        <img src="../assets/images/${coverImage}" alt="Magazine Cover" class="cover-image" />
    </div>` : ''}

    <h2>All Images — Visual Consistency Check</h2>
    <div class="image-grid">${gridHTML}</div>

    <footer>
        Production Bible &bull; Generated ${new Date().toISOString().split('T')[0]} &bull; ${title}
    </footer>
</div>
</body>
</html>`;

        const outputPath = path.join(this.preproDir, 'review.html');
        fs.writeFileSync(outputPath, html);
        console.log(`\n   Review page: ${path.relative(ROOT, outputPath)}`);
        return outputPath;
    }

    // ── Status ───────────────────────────────────────────────────

    showStatus() {
        console.log(`\nPre-Production Status: ${this.chapter}`);
        console.log('='.repeat(40));

        console.log(`\nCharacters (${this.characters.length}):`);
        this.characters.forEach(c => console.log(`   ${c.name} — ${c.description}`));

        const s0 = this.config.step0 || { status: 'pending', attempts: 0 };
        console.log(`\nStep 0: Storyline          — ${s0.status} (${s0.attempts} attempts)`);

        const s1 = this.config.step1;
        console.log(`Step 1: Unified Cast Sheet — ${s1.status} (${s1.attempts} attempts)`);

        const s2 = this.config.step2;
        console.log(`Step 2: Character Sheets   — ${s2.status}`);
        for (const char of this.characters) {
            const cs = s2.characters[char.id];
            if (cs) console.log(`   ${char.name}: ${cs.status} (${cs.attempts || 0} attempts)`);
        }

        const s3 = this.config.step3;
        console.log(`Step 3: Mood Proposals     — ${s3.status}`);
        if (s3.styleName) {
            const proposal = MOOD_PROPOSALS.find(p => p.id === s3.styleName);
            console.log(`   Chosen: ${proposal?.name || s3.styleName}`);
            if (s3.chosenMoods) console.log(`   Moods: ${s3.chosenMoods.join(', ')}`);
        }

        console.log();
    }

    // ── Main Orchestration ───────────────────────────────────────

    async run(startStep, feedback, { autoApprove = false } = {}) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`  PRE-PRODUCTION: ${this.chapterData.meta?.title?.en || this.chapter}`);
        console.log('='.repeat(50));

        console.log(`\nCharacters (${this.characters.length}):`);
        this.characters.forEach((c, i) => {
            console.log(`   ${i + 1}. ${c.name} — ${c.description}`);
        });

        if (autoApprove) console.log('\n   Auto-approve mode: all steps will be approved automatically.\n');

        const step = startStep !== null && startStep !== undefined ? startStep : this._nextPendingStep();

        if (step <= 0) {
            await this.runStep0(step === 0 ? feedback : null);
            if (autoApprove && this.config.step0?.status === 'generated') this.approveStep(0);
        }
        if (step <= 1) {
            await this.runStep1(step === 1 ? feedback : null);
            if (autoApprove && this.config.step1.status === 'generated') this.approveStep(1);
        }
        if (step <= 2) {
            await this.runStep2(step === 2 ? feedback : null);
            if (autoApprove && this.config.step2.status === 'generated') this.approveStep(2);
        }
        if (step <= 3) {
            await this.runStep3();
            if (autoApprove && this.config.step3.status === 'generated') {
                // Auto-select mood proposal 1 (agents can override with --approve-style N)
                this.approveStyle(1);
            }
        }

        // Auto-package if steps 1-3 approved
        if (this.config.step1.status === 'approved' &&
            this.config.step2.status === 'approved' &&
            this.config.step3.status === 'approved') {
            this.packageApproved();
        }

        // Always generate review HTML at the end
        const htmlPath = this.generateReviewHTML();
        try { execSync(`open "${htmlPath}"`, { stdio: 'ignore' }); } catch {}
    }

    _nextPendingStep() {
        if (this.config.step0 && this.config.step0.status === 'pending') return 0;
        if (this.config.step1.status === 'pending') return 1;
        if (this.config.step2.status === 'pending') return 2;
        if (this.config.step3.status === 'pending') return 3;
        return 1; // Default: re-run from step 1
    }
}

// ── CLI Entry Point ─────────────────────────────────────────────────

async function main() {
    const opts = parseArgs();

    if (!opts.chapter) {
        console.log(`
Usage: node generate-preproduction.js <chapter> [options]

Options:
  --step N              Run from specific step (0, 1, 2, or 3)
  --redo N              Regenerate step N (new version)
  --feedback "text"     Feedback for --redo (revision instructions)
  --approve N           Approve step N (latest version)
  --approve-style N     Choose mood proposal N (1-5)
  --review              Generate HTML review page only
  --status              Show current state
  --reset               Start over

Steps:
  0. Storyline Generation (Claude CLI generates narrative markdown)
  1. Unified Character Sheet (B&W line art, all characters)
  2. Individual Character Sheets (multi-angle per character)
  3. Pixar Mood Proposals (5 mood combos applied to a test scene)

Examples:
  node generate-preproduction.js elephants
  node generate-preproduction.js elephants --step 0
  node generate-preproduction.js elephants --step 1
  node generate-preproduction.js elephants --redo 1 --feedback "bigger ears on Tembo"
  node generate-preproduction.js elephants --approve 0
  node generate-preproduction.js elephants --approve 1
  node generate-preproduction.js elephants --approve-style 2
  node generate-preproduction.js elephants --review
`);
        process.exit(0);
    }

    const needsAI = !opts.review && !opts.status && !opts.reset && !opts.approve && !opts.approveStyle;
    const pipeline = new PreproductionPipeline(opts.chapter);
    pipeline.initialize({ needsAI });

    if (opts.reset) {
        fs.rmSync(pipeline.preproDir, { recursive: true, force: true });
        console.log('Pre-production reset. Run again to start fresh.');
        return;
    }

    if (opts.status) {
        pipeline.showStatus();
        return;
    }

    if (opts.review) {
        const htmlPath = pipeline.generateReviewHTML();
        try { execSync(`open "${htmlPath}"`, { stdio: 'ignore' }); } catch {}
        return;
    }

    if (opts.approve) {
        pipeline.approveStep(opts.approve);
        const htmlPath = pipeline.generateReviewHTML();
        try { execSync(`open "${htmlPath}"`, { stdio: 'ignore' }); } catch {}
        return;
    }

    if (opts.approveStyle) {
        pipeline.approveStyle(opts.approveStyle);
        // Also check if everything is approved for packaging
        if (pipeline.config.step1.status === 'approved' &&
            pipeline.config.step2.status === 'approved' &&
            pipeline.config.step3.status === 'approved') {
            pipeline.packageApproved();
        }
        const htmlPath = pipeline.generateReviewHTML();
        try { execSync(`open "${htmlPath}"`, { stdio: 'ignore' }); } catch {}
        return;
    }

    if (opts.redo) {
        await pipeline.run(opts.redo, opts.feedback, { autoApprove: opts.autoApprove });
        return;
    }

    await pipeline.run(opts.step, opts.feedback, { autoApprove: opts.autoApprove });
}

main().catch(err => {
    console.error(`\nFatal: ${err.message}`);
    process.exit(1);
});
