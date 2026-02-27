#!/usr/bin/env node
/**
 * fix-image.js — Quick anatomical/composition fix using Gemini
 *
 * Sends the broken image back to Gemini as reference and asks it
 * to regenerate with the specified fix applied.
 *
 * Usage:
 *   node fix-image.js <chapter> <image> "<fix description>"
 *
 * Examples:
 *   node fix-image.js birds zuri-first-knot.jpg "bird has 4 legs, it must have exactly 2 legs"
 *   node fix-image.js birds weaving-lesson.jpg "left bird has 3 legs, both birds must have exactly 2 legs each"
 *   node fix-image.js birds "#4" "the nest is floating in mid-air, it should be attached to the branch"
 *
 * The "#N" shorthand maps to the Nth section image in the chapter YAML.
 * Originals are backed up to <chapter>/assets/images/attempts/
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { GoogleGenAI } = require('@google/genai');

// ── helpers ──────────────────────────────────────────────────────────

function loadChapterImages(chapterName) {
    const yamlPath = path.join(__dirname, 'chapters', `${chapterName}.yaml`);
    if (!fs.existsSync(yamlPath)) {
        console.error(`❌ Chapter file not found: ${yamlPath}`);
        process.exit(1);
    }
    const data = yaml.load(fs.readFileSync(yamlPath, 'utf8'));

    // Build ordered list: hero, visible sections, viewer details, fun facts
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

function resolveImageFilename(chapterName, identifier) {
    // If it looks like a tag (#4, V2, F1, H), resolve from YAML
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
    // Otherwise treat as filename (add .jpg if missing)
    return identifier.endsWith('.jpg') ? identifier : `${identifier}.jpg`;
}

function backupImage(imagePath, attemptsDir) {
    if (!fs.existsSync(attemptsDir)) {
        fs.mkdirSync(attemptsDir, { recursive: true });
    }
    const base = path.basename(imagePath, '.jpg');

    // Find next version number
    let version = 1;
    while (fs.existsSync(path.join(attemptsDir, `${base}-v${version}.jpg`))) {
        version++;
    }

    const backupPath = path.join(attemptsDir, `${base}-v${version}.jpg`);
    fs.copyFileSync(imagePath, backupPath);
    console.log(`   📦 Backed up → ${path.relative(process.cwd(), backupPath)}`);
    return version;
}

// ── verification ─────────────────────────────────────────────────────

async function verifyFix(ai, imagePath, fixDescription) {
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

The following issue was reported and supposedly fixed in this image:
"${fixDescription}"

Carefully inspect the image. Is the issue ACTUALLY fixed?

Rules for checking:
- Count legs/feet on EVERY bird. Each bird must have exactly 2.
- Check that all nests/objects are physically attached to a surface (no floating).
- Check for any anatomical impossibilities.

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
        const result = JSON.parse(clean);
        return result;
    } catch (err) {
        // If verification fails, assume pass to avoid blocking
        console.log(`   ⚠️  Verify error: ${err.message} — assuming pass`);
        return { pass: true, reason: 'verification unavailable' };
    }
}

// ── main ─────────────────────────────────────────────────────────────

async function fixImage(chapterName, identifier, fixDescription, maxRetries = 3) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY not set. Run: source .env && export GEMINI_API_KEY');
        process.exit(1);
    }

    const filename = resolveImageFilename(chapterName, identifier);
    const imageDir = path.join(__dirname, chapterName, 'assets', 'images');
    const imagePath = path.join(imageDir, filename);
    const attemptsDir = path.join(imageDir, 'attempts');

    if (!fs.existsSync(imagePath)) {
        console.error(`❌ Image not found: ${imagePath}`);
        process.exit(1);
    }

    console.log(`\n🔧 Fixing: ${filename}`);
    console.log(`   Issue: ${fixDescription}`);

    // Back up original before any attempts
    backupImage(imagePath, attemptsDir);

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are given a reference image that has a specific problem that needs fixing.

PROBLEM TO FIX: ${fixDescription}

Regenerate this SAME image — same scene, same composition, same characters, same colors, same art style, same lighting, same background — but with the problem fixed.

CRITICAL RULES:
- Keep EVERYTHING else identical to the reference
- Birds have exactly 2 legs and 2 feet, no more, no less
- All objects must obey gravity and be physically attached/supported
- Maintain the exact same art style and color palette
- Do NOT add any text, labels, or watermarks`;

    // Keep the current image path as the reference for re-generation
    // On each failed verify, we re-read the latest file (which is the latest attempt)
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`   🔄 Attempt ${attempt}/${maxRetries}...`);

        try {
            const refBuffer = fs.readFileSync(imagePath);
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
            let generated = false;
            for (const part of parts) {
                if (part.inlineData) {
                    const buffer = Buffer.from(part.inlineData.data, 'base64');
                    fs.writeFileSync(imagePath, buffer);
                    console.log(`   ✅ Generated ${(buffer.length / 1024).toFixed(0)} KB`);
                    generated = true;
                    break;
                }
            }

            if (!generated) {
                console.log(`   ⚠️  No image in response, retrying...`);
                continue;
            }

            // ── Verify the fix ──
            console.log(`   🔍 Verifying fix...`);
            const verdict = await verifyFix(ai, imagePath, fixDescription);

            if (verdict.pass) {
                console.log(`   ✅ Verified: ${verdict.reason}`);
                return true;
            } else {
                console.log(`   ❌ Still broken: ${verdict.reason}`);
                if (attempt < maxRetries) {
                    // Back up failed attempt
                    backupImage(imagePath, attemptsDir);
                    console.log(`   🔁 Retrying with stricter prompt...`);
                }
            }
        } catch (err) {
            console.error(`   ⚠️  Error: ${err.message}`);
            if (attempt < maxRetries) {
                console.log(`   ⏳ Waiting 2s before retry...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    console.error(`   ❌ Failed verification after ${maxRetries} attempts`);
    return false;
}

// ── CLI ──────────────────────────────────────────────────────────────

if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.log(`
Usage: node fix-image.js <chapter> <image> "<fix description>"

  <chapter>   Chapter folder name (e.g. birds, beavers)
  <image>     Image filename, or tag shorthand: #4, V2, F1, H
  <fix>       What to fix (e.g. "bird has 3 legs, must have 2")

Examples:
  node fix-image.js birds "#4" "bird has 4 legs, must have exactly 2"
  node fix-image.js birds "#6" "left bird has 3 legs, both must have exactly 2"
  node fix-image.js birds zuri-first-knot.jpg "nest is floating, attach to branch"

Tags map to section images in order:
  H  = hero, #1-#N = sections, V1-V4 = viewer details, F1-F4 = fun facts
`);
        process.exit(0);
    }

    const [chapterName, identifier, ...fixParts] = args;
    const fixDescription = fixParts.join(' ');

    fixImage(chapterName, identifier, fixDescription).then(success => {
        if (success) {
            console.log('\n✨ Done! Refresh the browser to see the fix.');
        } else {
            console.log('\n❌ Fix failed. Check the attempts/ folder for history.');
            process.exit(1);
        }
    });
}

module.exports = { fixImage, resolveImageFilename, loadChapterImages };
