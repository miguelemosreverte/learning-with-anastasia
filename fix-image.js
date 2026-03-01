#!/usr/bin/env node
/**
 * fix-image.js — Quick anatomical/composition fix using Gemini
 *
 * Sends the broken image back to Gemini as reference and asks it
 * to regenerate with the specified fix applied. Verifies the fix
 * actually took before accepting (up to 3 attempts).
 *
 * All attempts are preserved in attempts/ for forensic review.
 * Every run is logged to the chapter changelog (JSON + MD + HTML).
 *
 * Usage:
 *   node fix-image.js <chapter> <image> "<fix description>"
 *
 * Examples:
 *   node fix-image.js birds "#4" "bird has 4 legs, must have exactly 2"
 *   node fix-image.js birds "#6" "left bird has 3 legs, both must have exactly 2"
 *   node fix-image.js birds zuri-first-knot.jpg "nest is floating, attach to branch"
 *
 * Tags: H = hero, #1-#N = sections, V1-VN = viewer details, F1-FN = fun facts
 * Originals are backed up to <chapter>/assets/images/attempts/
 */

const fs = require('fs');
const path = require('path');
const {
    resolveImagePaths,
    backupImage,
    createGeminiClient,
    geminiImageGenerate,
    geminiVerify
} = require('./automation/image-utils');
const ChangeLog = require('./automation/changelog');
const logger = require('./automation/logger');

async function fixImage(chapterName, identifier, fixDescription, options = {}) {
    const { maxRetries = 3, automated = false, type = 'anatomical-fix' } = options;
    const { filename, imagePath, attemptsDir } = resolveImagePaths(chapterName, identifier);

    if (!fs.existsSync(imagePath)) {
        console.error(`❌ Image not found: ${imagePath}`);
        if (require.main === module) process.exit(1);
        return false;
    }

    const _logTaskId = logger.taskStart(`Fix image: ${chapterName}/${filename}`);

    console.log(`\n🔧 Fixing: ${filename}`);
    console.log(`   Issue: ${fixDescription}`);

    // Back up original — this is the "before" image
    const initialVersion = backupImage(imagePath, attemptsDir);
    const baseName = path.basename(filename, '.jpg');
    const beforeImage = `assets/images/attempts/${baseName}-v${initialVersion}.jpg`;
    const afterImage = `assets/images/${filename}`;
    const attemptImages = [beforeImage]; // Start with the original

    const ai = createGeminiClient();

    const prompt = `You are given a reference image that has a specific problem that needs fixing.

PROBLEM TO FIX: ${fixDescription}

Regenerate this SAME image — same scene, same composition, same characters, same colors, same art style, same lighting, same background — but with the problem fixed.

CRITICAL RULES:
- Keep EVERYTHING else identical to the reference
- Birds have exactly 2 legs and 2 feet, no more, no less
- All objects must obey gravity and be physically attached/supported
- Maintain the exact same art style and color palette
- Do NOT add any text, labels, or watermarks`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`   🔄 Attempt ${attempt}/${maxRetries}...`);

        try {
            const buffer = await geminiImageGenerate(ai, imagePath, prompt);

            if (!buffer) {
                console.log(`   ⚠️  No image in response, retrying...`);
                continue;
            }

            fs.writeFileSync(imagePath, buffer);
            console.log(`   ✅ Generated ${(buffer.length / 1024).toFixed(0)} KB`);

            // Verify
            console.log(`   🔍 Verifying fix...`);
            const verdict = await geminiVerify(ai, imagePath, fixDescription);

            if (verdict.pass) {
                console.log(`   ✅ Verified: ${verdict.reason}`);
                const changelog = new ChangeLog(chapterName);
                changelog.log({
                    image: filename,
                    tag: identifier,
                    type,
                    tool: 'fix-image',
                    description: fixDescription,
                    attempts: attempt,
                    verified: true,
                    automated,
                    beforeImage,
                    afterImage,
                    attemptImages
                });
                changelog.save();
                logger.taskEnd(_logTaskId, { attempts: attempt, verified: true, tool: 'fix-image' });
                return true;
            } else {
                console.log(`   ❌ Still broken: ${verdict.reason}`);
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

    console.error(`   ❌ Failed verification after ${maxRetries} attempts`);
    logger.taskEnd(_logTaskId, { attempts: maxRetries, verified: false, tool: 'fix-image' });
    const changelog = new ChangeLog(chapterName);
    changelog.log({
        image: filename,
        tag: identifier,
        type,
        tool: 'fix-image',
        description: fixDescription,
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

    fixImage(chapterName, identifier, fixDescription, { automated: false }).then(success => {
        if (success) {
            console.log('\n✨ Done! Refresh the browser to see the fix.');
        } else {
            console.log('\n❌ Fix failed. Check the attempts/ folder for history.');
            process.exit(1);
        }
    });
}

module.exports = { fixImage };
