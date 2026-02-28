#!/usr/bin/env node
/**
 * restyle-image.js — Artistic direction / restyle using Gemini
 *
 * Unlike fix-image.js (which corrects defects), this script applies
 * creative feedback: change lighting, mood, composition, time of day,
 * storyboard continuity, etc.
 *
 * Can optionally use a "style reference" image so the result matches
 * the look of another image in the chapter.
 *
 * All attempts are preserved in attempts/ for forensic review.
 * Every run is logged to the chapter changelog (JSON + MD + HTML).
 *
 * Usage:
 *   node restyle-image.js <chapter> <image> "<direction>"
 *   node restyle-image.js <chapter> <image> --like <ref-image> "<direction>"
 *
 * Examples:
 *   node restyle-image.js birds "#5" "warm golden-hour daylight, sunny acacia savanna"
 *   node restyle-image.js birds "#6" --like "#3" "match the warm daylight and open meadow feel"
 *   node restyle-image.js birds "#5" --like "#3" "same warm golden-hour lighting and outdoor savanna setting"
 *
 * Tags: H = hero, #1-#N = sections, V1-VN = viewer details, F1-FN = fun facts
 * Originals are backed up to <chapter>/assets/images/attempts/
 */

const fs = require('fs');
const path = require('path');
const {
    resolveImagePaths,
    resolveImageFilename,
    backupImage,
    createGeminiClient,
    geminiVerify,
    ROOT
} = require('./automation/image-utils');
const { GoogleGenAI } = require('@google/genai');
const ChangeLog = require('./automation/changelog');

/**
 * Generate with both a source image and a style-reference image
 */
async function geminiRestyleWithReference(ai, sourceImagePath, refImagePath, prompt) {
    const srcBuffer = fs.readFileSync(sourceImagePath);
    const refBuffer = fs.readFileSync(refImagePath);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
            {
                role: 'user',
                parts: [
                    { inlineData: { mimeType: 'image/jpeg', data: srcBuffer.toString('base64') } },
                    { inlineData: { mimeType: 'image/jpeg', data: refBuffer.toString('base64') } },
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
 * Generate with only the source image (no style reference)
 */
async function geminiRestyleSolo(ai, sourceImagePath, prompt) {
    const srcBuffer = fs.readFileSync(sourceImagePath);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
            {
                role: 'user',
                parts: [
                    { inlineData: { mimeType: 'image/jpeg', data: srcBuffer.toString('base64') } },
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

async function restyleImage(chapterName, identifier, direction, options = {}) {
    const { likeRef = null, maxRetries = 3, automated = false, type = 'style-restyle' } = options;

    const { filename, imagePath, attemptsDir } = resolveImagePaths(chapterName, identifier);

    if (!fs.existsSync(imagePath)) {
        console.error(`❌ Image not found: ${imagePath}`);
        if (require.main === module) process.exit(1);
        return false;
    }

    // Resolve style reference if provided
    let refImagePath = null;
    if (likeRef) {
        const refFilename = resolveImageFilename(chapterName, likeRef);
        refImagePath = path.join(ROOT, chapterName, 'assets', 'images', refFilename);
        if (!fs.existsSync(refImagePath)) {
            console.error(`❌ Reference image not found: ${refImagePath}`);
            if (require.main === module) process.exit(1);
            return false;
        }
    }

    console.log(`\n🎨 Restyling: ${filename}`);
    console.log(`   Direction: ${direction}`);
    if (refImagePath) {
        console.log(`   Style ref: ${path.basename(refImagePath)}`);
    }

    // Back up original — this is the "before" image
    const initialVersion = backupImage(imagePath, attemptsDir);
    const baseName = path.basename(filename, '.jpg');
    const beforeImage = `assets/images/attempts/${baseName}-v${initialVersion}.jpg`;
    const afterImage = `assets/images/${filename}`;
    const attemptImages = [beforeImage];

    const ai = createGeminiClient();

    const prompt = refImagePath
        ? `You are given TWO images:
1. FIRST IMAGE — the scene to restyle (keep the same characters, action, and story moment)
2. SECOND IMAGE — the style reference (match this image's lighting, time of day, color palette, and mood)

ARTISTIC DIRECTION: ${direction}

Regenerate the FIRST image's scene with the SECOND image's visual style applied.

RULES:
- Keep the same characters, poses, and narrative action from the first image
- Match the lighting, color warmth, time of day, and atmosphere from the second image
- Birds have exactly 2 legs and 2 feet
- All objects must obey gravity
- Do NOT add any text, labels, or watermarks
- Maintain child-friendly, warm illustration quality`

        : `You are given a reference image that needs restyling.

ARTISTIC DIRECTION: ${direction}

Regenerate this SAME scene — same characters, same action, same story moment — but with the artistic direction applied.

RULES:
- Keep the same characters, poses, and narrative action
- Apply the requested visual changes (lighting, mood, composition, etc.)
- Birds have exactly 2 legs and 2 feet
- All objects must obey gravity
- Do NOT add any text, labels, or watermarks
- Maintain child-friendly, warm illustration quality`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`   🔄 Attempt ${attempt}/${maxRetries}...`);

        try {
            const buffer = refImagePath
                ? await geminiRestyleWithReference(ai, imagePath, refImagePath, prompt)
                : await geminiRestyleSolo(ai, imagePath, prompt);

            if (!buffer) {
                console.log(`   ⚠️  No image in response, retrying...`);
                continue;
            }

            fs.writeFileSync(imagePath, buffer);
            console.log(`   ✅ Generated ${(buffer.length / 1024).toFixed(0)} KB`);

            // Verify
            console.log(`   🔍 Verifying result...`);
            const verdict = await geminiVerify(ai, imagePath,
                `The image should show: ${direction}. Also check: all birds have exactly 2 legs, no floating objects.`);

            if (verdict.pass) {
                console.log(`   ✅ Verified: ${verdict.reason}`);
                const changelog = new ChangeLog(chapterName);
                changelog.log({
                    image: filename,
                    tag: identifier,
                    type,
                    tool: 'restyle-image',
                    description: direction,
                    attempts: attempt,
                    verified: true,
                    automated,
                    beforeImage,
                    afterImage,
                    attemptImages
                });
                changelog.save();
                return true;
            } else {
                console.log(`   ⚠️  Issue: ${verdict.reason}`);
                if (attempt < maxRetries) {
                    // Back up this failed attempt too — forensic evidence
                    const ver = backupImage(imagePath, attemptsDir);
                    attemptImages.push(`assets/images/attempts/${baseName}-v${ver}.jpg`);
                    console.log(`   🔁 Retrying...`);
                }
            }
        } catch (err) {
            console.error(`   ⚠️  Error: ${err.message}`);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    console.error(`   ❌ Failed after ${maxRetries} attempts`);
    const changelog = new ChangeLog(chapterName);
    changelog.log({
        image: filename,
        tag: identifier,
        type,
        tool: 'restyle-image',
        description: direction,
        attempts: maxRetries,
        verified: false,
        automated,
        beforeImage,
        afterImage,
        attemptImages
    });
    changelog.save();
    return false;
}

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs(args) {
    const result = { chapter: null, image: null, likeRef: null, direction: '' };

    if (args.length < 3) return null;

    result.chapter = args[0];
    result.image = args[1];

    const rest = args.slice(2);
    const likeIdx = rest.indexOf('--like');

    if (likeIdx !== -1) {
        result.likeRef = rest[likeIdx + 1];
        const dirParts = [...rest.slice(0, likeIdx), ...rest.slice(likeIdx + 2)];
        result.direction = dirParts.join(' ');
    } else {
        result.direction = rest.join(' ');
    }

    return result;
}

if (require.main === module) {
    const parsed = parseArgs(process.argv.slice(2));

    if (!parsed || !parsed.direction) {
        console.log(`
Usage: node restyle-image.js <chapter> <image> [--like <ref>] "<direction>"

  <chapter>     Chapter folder name (e.g. birds, beavers)
  <image>       Image filename, or tag shorthand: #4, V2, F1, H
  --like <ref>  Optional style reference image to match
  <direction>   Artistic direction / feedback

Examples:
  node restyle-image.js birds "#5" "warm golden-hour daylight, open savanna setting"
  node restyle-image.js birds "#6" --like "#3" "match the warm daylight and outdoor meadow feel"
  node restyle-image.js birds "#5" --like "#3" "same golden-hour lighting, sunny acacia savanna"

Tags: H = hero, #1-#N = sections, V1-VN = viewer details, F1-FN = fun facts
`);
        process.exit(0);
    }

    restyleImage(parsed.chapter, parsed.image, parsed.direction, {
        likeRef: parsed.likeRef
    }).then(success => {
        if (success) {
            console.log('\n✨ Done! Refresh the browser to see the restyle.');
        } else {
            console.log('\n⚠️  Restyle may need manual review. Check attempts/ for history.');
            process.exit(1);
        }
    });
}

module.exports = { restyleImage };
