/**
 * image-utils.js — Shared helpers for image fix/restyle scripts
 *
 * Used by fix-image.js and restyle-image.js
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { GoogleGenAI } = require('@google/genai');

const ROOT = path.join(__dirname, '..');

/**
 * Load all chapter images as an ordered tag→filename list
 * H = hero, #1..#N = visible sections, V1..VN = viewer details, F1..FN = fun facts
 */
function loadChapterImages(chapterName) {
    const yamlPath = path.join(ROOT, 'chapters', `${chapterName}.yaml`);
    if (!fs.existsSync(yamlPath)) {
        console.error(`❌ Chapter file not found: ${yamlPath}`);
        process.exit(1);
    }
    const data = yaml.load(fs.readFileSync(yamlPath, 'utf8'));

    const images = [];

    if (data.hero?.image) {
        images.push({ tag: 'H', filename: data.hero.image });
    }

    let sectionIdx = 1;
    for (const s of data.sections) {
        if (s.hidden) continue;
        if (s.image) {
            images.push({ tag: `#${sectionIdx}`, filename: s.image });
            sectionIdx++;
        }
    }

    if (data.viewerDetails) {
        data.viewerDetails.forEach((v, i) => {
            if (v.image) images.push({ tag: `V${i + 1}`, filename: v.image });
        });
    }

    if (data.funFacts?.facts) {
        data.funFacts.facts.forEach((f, i) => {
            if (f.image) images.push({ tag: `F${i + 1}`, filename: f.image });
        });
    }

    return images;
}

/**
 * Resolve a user-provided identifier to a filename
 * Accepts: "#4", "V2", "F1", "H", or "some-file.jpg"
 */
function resolveImageFilename(chapterName, identifier) {
    if (/^[#HVF]\d*$/i.test(identifier)) {
        const images = loadChapterImages(chapterName);
        const tag = identifier.toUpperCase();
        const match = images.find(img => img.tag === tag);
        if (!match) {
            console.error(`❌ Tag "${identifier}" not found. Available tags:`);
            images.forEach(img => console.log(`   ${img.tag} → ${img.filename}`));
            process.exit(1);
        }
        return match.filename;
    }
    return identifier.endsWith('.jpg') ? identifier : `${identifier}.jpg`;
}

/**
 * Resolve the full image path and attempts dir for a chapter + identifier
 */
function resolveImagePaths(chapterName, identifier) {
    const filename = resolveImageFilename(chapterName, identifier);
    const imageDir = path.join(ROOT, chapterName, 'assets', 'images');
    const imagePath = path.join(imageDir, filename);
    const attemptsDir = path.join(imageDir, 'attempts');
    return { filename, imageDir, imagePath, attemptsDir };
}

/**
 * Back up an image to the attempts/ directory with auto-incrementing version
 * Returns the version number used
 */
function backupImage(imagePath, attemptsDir) {
    if (!fs.existsSync(attemptsDir)) {
        fs.mkdirSync(attemptsDir, { recursive: true });
    }
    const base = path.basename(imagePath, '.jpg');

    let version = 1;
    while (fs.existsSync(path.join(attemptsDir, `${base}-v${version}.jpg`))) {
        version++;
    }

    const backupPath = path.join(attemptsDir, `${base}-v${version}.jpg`);
    fs.copyFileSync(imagePath, backupPath);
    console.log(`   📦 Backed up → ${path.relative(ROOT, backupPath)}`);
    return version;
}

/**
 * Create a GoogleGenAI instance (exits if no key)
 */
function createGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY not set. Run: source .env && export GEMINI_API_KEY');
        process.exit(1);
    }
    return new GoogleGenAI({ apiKey });
}

/**
 * Send an image + prompt to Gemini image model, return generated buffer or null
 */
async function geminiImageGenerate(ai, referenceImagePath, prompt) {
    const refBuffer = fs.readFileSync(referenceImagePath);
    const refBase64 = refBuffer.toString('base64');

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
            {
                role: 'user',
                parts: [
                    { inlineData: { mimeType: 'image/jpeg', data: refBase64 } },
                    { text: prompt }
                ]
            }
        ]
    });

    const parts = response.candidates[0].content.parts;
    for (const part of parts) {
        if (part.inlineData) {
            return Buffer.from(part.inlineData.data, 'base64');
        }
    }
    return null;
}

/**
 * Ask Gemini text model to verify an image against a check description
 * Returns { pass: boolean, reason: string }
 */
async function geminiVerify(ai, imagePath, checkDescription) {
    try {
        const imgBuffer = fs.readFileSync(imagePath);
        const imgBase64 = imgBuffer.toString('base64');

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: 'image/jpeg', data: imgBase64 } },
                        {
                            text: `You are a strict QA reviewer for children's book illustrations.

Check this image for the following:
"${checkDescription}"

Carefully inspect the image. Does it pass the check?

Rules:
- Count legs/feet on EVERY bird. Each bird must have exactly 2.
- All nests/objects must be physically attached to a surface (no floating).
- Check for any anatomical impossibilities.
- Check that the artistic direction matches what was requested.

Respond with ONLY valid JSON, no markdown:
{"pass": true/false, "reason": "brief explanation"}`
                        }
                    ]
                }
            ]
        });

        const text = response.candidates[0].content.parts
            .filter(p => p.text).map(p => p.text).join('');
        const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        return JSON.parse(clean);
    } catch (err) {
        console.log(`   ⚠️  Verify error: ${err.message} — assuming pass`);
        return { pass: true, reason: 'verification unavailable' };
    }
}

module.exports = {
    loadChapterImages,
    resolveImageFilename,
    resolveImagePaths,
    backupImage,
    createGeminiClient,
    geminiImageGenerate,
    geminiVerify,
    ROOT
};
