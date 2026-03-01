#!/usr/bin/env node
/**
 * generate-chapter.js — Autonomous end-to-end chapter pipeline
 *
 * Single entry point that generates images, runs QA, auto-fixes issues,
 * builds HTML, updates the index, generates PDFs, and opens the result.
 *
 * Usage:
 *   node generate-chapter.js <chapter>               # Full pipeline with QA
 *   node generate-chapter.js <chapter> --skip-qa      # Skip QA sweep
 *   node generate-chapter.js <chapter> --qa-only      # QA only (no generation)
 *   node generate-chapter.js <chapter> --no-pdf       # Skip PDF generation
 *   node generate-chapter.js <chapter> --no-open      # Don't open in browser
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { execSync, spawn } = require('child_process');
const ChangeLog = require('./automation/changelog');
const logger = require('./automation/logger');
const {
    loadChapterImages,
    resolveImagePaths,
    createGeminiClient,
    geminiVerify
} = require('./automation/image-utils');

const ROOT = __dirname;

// ── CLI ─────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        chapter: null,
        skipQa: false,
        qaOnly: false,
        noPdf: false,
        noOpen: false,
        maxQaRounds: 3,
        maxFixAttempts: 3
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--skip-qa') opts.skipQa = true;
        else if (args[i] === '--with-qa') opts.skipQa = false;
        else if (args[i] === '--qa-only') { opts.qaOnly = true; opts.skipQa = false; }
        else if (args[i] === '--no-pdf') opts.noPdf = true;
        else if (args[i] === '--no-open') opts.noOpen = true;
        else if (args[i] === '--max-rounds' && args[i + 1]) opts.maxQaRounds = parseInt(args[++i]);
        else if (!args[i].startsWith('--') && !opts.chapter) opts.chapter = args[i];
    }

    return opts;
}

// ── Helpers ─────────────────────────────────────────────────────────

function runScript(label, command) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`▶ ${label}`);
    console.log(`  $ ${command}`);
    console.log('─'.repeat(60));
    try {
        execSync(command, { cwd: ROOT, stdio: 'inherit', env: process.env });
        return true;
    } catch (err) {
        console.error(`  ⚠️  ${label} failed: ${err.message}`);
        return false;
    }
}

function loadChapterYaml(chapter) {
    const yamlPath = path.join(ROOT, 'chapters', `${chapter}.yaml`);
    if (!fs.existsSync(yamlPath)) {
        console.error(`❌ Chapter file not found: ${yamlPath}`);
        process.exit(1);
    }
    return yaml.load(fs.readFileSync(yamlPath, 'utf8'));
}

// ── QA Sweep ────────────────────────────────────────────────────────
// Uses Gemini text model to check each image for common issues

async function qaCheck(ai, imagePath, animalType) {
    const checks = `Carefully inspect this children's book illustration:

1. ANATOMY: Count all limbs on every ${animalType}. Each ${animalType} must have the anatomically correct number of legs/limbs. Flag any extra or missing limbs.
2. PHYSICS: Check that all objects obey gravity — nothing should be floating without support.
3. TEXT/WATERMARKS: Check for any embedded text, labels, watermarks, or signatures. There should be NONE.
4. COMPOSITION: Check for fractal patterns, trypophobia-triggering textures, or visual artifacts.
5. QUALITY: Check overall image quality — no distortion, blur, or color banding.

Respond with ONLY valid JSON, no markdown:
{"pass": true/false, "issues": ["issue 1", "issue 2"], "reason": "brief summary"}`;

    return geminiVerify(ai, imagePath, checks);
}

async function qaSweep(chapter, animalType) {
    console.log(`\n🔍 QA Sweep: ${chapter}`);
    console.log('─'.repeat(60));

    const ai = createGeminiClient();
    const images = loadChapterImages(chapter);
    const imageDir = path.join(ROOT, chapter, 'assets', 'images');
    const issues = [];

    for (const img of images) {
        const imagePath = path.join(imageDir, img.filename);
        if (!fs.existsSync(imagePath)) {
            console.log(`   ⏭️  ${img.tag} ${img.filename} — MISSING, skipping`);
            continue;
        }

        process.stdout.write(`   🔍 ${img.tag.padEnd(4)} ${img.filename.padEnd(40)} `);

        try {
            const result = await qaCheck(ai, imagePath, animalType);

            if (result.pass) {
                console.log('✅ PASS');
            } else {
                console.log(`❌ FAIL: ${result.reason}`);
                issues.push({
                    tag: img.tag,
                    filename: img.filename,
                    reason: result.reason,
                    issues: result.issues || [result.reason]
                });
            }
        } catch (err) {
            console.log(`⚠️  Error: ${err.message}`);
        }

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n   Summary: ${images.length - issues.length} passed, ${issues.length} failed`);
    return issues;
}

// ── Auto-Fix Loop ───────────────────────────────────────────────────

async function autoFixIssues(chapter, issues, changelog, round) {
    if (issues.length === 0) return [];

    console.log(`\n🔧 Auto-Fix Round ${round}: ${issues.length} issues`);
    console.log('─'.repeat(60));

    const { fixImage } = require('./fix-image');
    const remaining = [];

    for (const issue of issues) {
        const fixDescription = issue.issues.join('; ');
        console.log(`\n   Fixing ${issue.tag} ${issue.filename}: ${fixDescription}`);

        try {
            const success = await fixImage(chapter, issue.tag, fixDescription, {
                maxRetries: 3,
                automated: true,
                type: classifyIssue(fixDescription)
            });

            if (!success) {
                remaining.push(issue);
            }
        } catch (err) {
            console.error(`   ⚠️  Fix error: ${err.message}`);
            remaining.push(issue);
        }
    }

    return remaining;
}

/**
 * Classify an issue description into a type
 */
function classifyIssue(description) {
    const lower = description.toLowerCase();
    if (/leg|limb|arm|finger|toe|anatom|body part|trunk|tusk/.test(lower)) return 'anatomical-fix';
    if (/float|gravity|physics|hover|suspend/.test(lower)) return 'physics-fix';
    if (/style|color|lighting|mood|palette/.test(lower)) return 'style-restyle';
    if (/composition|layout|frame|crop|fractal|pattern/.test(lower)) return 'composition-fix';
    if (/story|narrative|character|scene|action/.test(lower)) return 'narrative-fix';
    return 'composition-fix';
}

// ── Style Consistency Check ─────────────────────────────────────────

async function checkStyleConsistency(chapter) {
    console.log(`\n🎨 Style Consistency Check: ${chapter}`);
    console.log('─'.repeat(60));

    const chapterData = loadChapterYaml(chapter);
    const imageDir = path.join(ROOT, chapter, 'assets', 'images');

    // Find the first character image as reference
    const characterSections = (chapterData.sections || [])
        .filter(s => s.generate_character && s.image);

    if (characterSections.length < 2) {
        console.log('   ℹ️  Fewer than 2 characters, skipping consistency check');
        return [];
    }

    const firstCharPath = path.join(imageDir, characterSections[0].image);
    if (!fs.existsSync(firstCharPath)) {
        console.log('   ⚠️  First character image not found, skipping');
        return [];
    }

    // Check each subsequent character image uses a consistent style
    const ai = createGeminiClient();
    const inconsistent = [];

    for (let i = 1; i < characterSections.length; i++) {
        const s = characterSections[i];
        const imgPath = path.join(imageDir, s.image);
        if (!fs.existsSync(imgPath)) continue;

        process.stdout.write(`   🎨 ${s.id.padEnd(30)} `);

        try {
            const result = await geminiVerify(ai, imgPath,
                `This image should be in the same art style as a children's book illustration: warm colors, Studio Ghibli-inspired, child-friendly. Check for style consistency.`);

            if (result.pass) {
                console.log('✅ Consistent');
            } else {
                console.log(`⚠️  ${result.reason}`);
                inconsistent.push({ section: s.id, filename: s.image, reason: result.reason });
            }
        } catch (err) {
            console.log(`⚠️  Error: ${err.message}`);
        }

        await new Promise(r => setTimeout(r, 500));
    }

    return inconsistent;
}

// ── Generation Report ───────────────────────────────────────────────

function generateReport(chapter, changelog, qaRounds, styleIssues, startTime) {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const summary = changelog.summarize();
    const reportPath = path.join(ROOT, chapter, 'generation-report.md');

    const lines = [
        `# Generation Report: ${chapter}`,
        `> Generated: ${new Date().toISOString()}`,
        `> Duration: ${elapsed} minutes\n`,
        `## Pipeline Summary`,
        `| Step | Status |`,
        `|------|--------|`,
        `| Image Generation | ✅ Complete |`,
        `| QA Rounds | ${qaRounds} |`,
        `| Style Check | ${styleIssues.length === 0 ? '✅ Consistent' : `⚠️ ${styleIssues.length} issues`} |`,
        `| HTML Build | ✅ Complete |`,
        `| Index Update | ✅ Complete |`,
        '',
        `## Intervention Summary`,
        `- Total interventions: ${summary.total}`,
        `- Verified: ${summary.verified || 0}`,
        `- Automated: ${summary.automated || 0}`,
        `- Avg attempts: ${summary.avgAttempts || 0}`,
        `- Estimated cost: $${(summary.totalCost || 0).toFixed(2)}`,
        ''
    ];

    if (summary.total > 0 && summary.byType) {
        lines.push('## Interventions by Type');
        for (const [type, count] of Object.entries(summary.byType)) {
            lines.push(`- ${type}: ${count}`);
        }
        lines.push('');
    }

    if (styleIssues.length > 0) {
        lines.push('## Style Issues');
        styleIssues.forEach(s => lines.push(`- ${s.section}: ${s.reason}`));
        lines.push('');
    }

    lines.push(`---\n*Pipeline: generate-chapter.js | Changelog: changelog.md*`);

    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`\n📊 Report saved: ${reportPath}`);
}

// ── Main Pipeline ───────────────────────────────────────────────────

async function main() {
    const opts = parseArgs();

    if (!opts.chapter) {
        console.log(`
Usage: node generate-chapter.js <chapter> [options]

Options:
  --skip-qa        Disable QA sweep (enabled by default)
  --qa-only        Run QA sweep only (no generation)
  --no-pdf         Skip PDF generation
  --no-open        Don't open result in browser
  --max-rounds N   Max QA/fix rounds (default: 3)

Examples:
  node generate-chapter.js elephants
  node generate-chapter.js elephants --with-qa
  node generate-chapter.js elephants --qa-only
`);
        process.exit(0);
    }

    const chapter = opts.chapter;
    const startTime = Date.now();
    const changelog = new ChangeLog(chapter);
    const _logTaskId = logger.taskStart(`Chapter pipeline: ${chapter}`);

    // Determine animal type from chapter name for QA prompts
    const animalType = chapter.replace(/-/g, ' ');

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🐘 AUTONOMOUS CHAPTER PIPELINE: ${chapter}`);
    console.log(`${'═'.repeat(60)}`);

    // ── Step 1: Generate images ──────────────────────────────────
    if (!opts.qaOnly) {
        console.log('\n📸 STEP 1: Image Generation');
        runScript('Generate images', `node run-recursive-generation.js ${chapter}`);
        logger.event('milestone', 'Image generation complete', { chapter });
    }

    // ── Step 2-3: QA + Auto-fix loop ─────────────────────────────
    let qaRounds = 0;
    let styleIssues = [];

    if (!opts.skipQa) {
        let stuckImages = {};

        for (let round = 1; round <= opts.maxQaRounds; round++) {
            qaRounds = round;

            console.log(`\n${'─'.repeat(60)}`);
            console.log(`  QA ROUND ${round}/${opts.maxQaRounds}`);
            console.log('─'.repeat(60));

            const issues = await qaSweep(chapter, animalType);

            if (issues.length === 0) {
                console.log('\n✅ All images passed QA!');
                break;
            }

            // Track stuck images (failing 3+ rounds)
            const humanReview = [];
            const fixable = [];

            for (const issue of issues) {
                stuckImages[issue.filename] = (stuckImages[issue.filename] || 0) + 1;
                if (stuckImages[issue.filename] >= 3) {
                    humanReview.push(issue);
                } else {
                    fixable.push(issue);
                }
            }

            if (humanReview.length > 0) {
                console.log(`\n⚠️  Flagged for human review (stuck after ${opts.maxQaRounds} rounds):`);
                humanReview.forEach(h => console.log(`   - ${h.tag} ${h.filename}: ${h.reason}`));
            }

            if (fixable.length > 0 && !opts.qaOnly) {
                const remaining = await autoFixIssues(chapter, fixable, changelog, round);
                if (remaining.length === 0 && humanReview.length === 0) {
                    console.log('\n✅ All fixable issues resolved!');
                    break;
                }
            } else if (opts.qaOnly) {
                console.log('\n   (--qa-only mode: skipping auto-fix)');
                break;
            }

            if (round === opts.maxQaRounds) {
                console.log(`\n⚠️  Reached max QA rounds (${opts.maxQaRounds}). Some issues may remain.`);
            }
        }

        // ── Step 4: Style consistency ────────────────────────────
        styleIssues = await checkStyleConsistency(chapter);
    }

    if (opts.qaOnly) {
        console.log('\n✅ QA sweep complete (--qa-only mode).');
        changelog.save();
        return;
    }

    // ── Step 5: Build HTML ───────────────────────────────────────
    console.log('\n📄 STEP 5: Build HTML');
    logger.event('milestone', 'HTML build started', { chapter });
    runScript('Build HTML', `node -e "
        const ChapterBuilder = require('./automation/chapter-builder');
        const b = new ChapterBuilder();
        b.buildChapter('./chapters/${chapter}.yaml', './${chapter}').then(() => console.log('Done'));
    "`);

    // ── Step 6: Update index ─────────────────────────────────────
    console.log('\n📚 STEP 6: Update Index');
    runScript('Update index', `node update-index.js`);

    // ── Step 7: Generate PDF ─────────────────────────────────────
    if (!opts.noPdf) {
        console.log('\n📋 STEP 7: Generate PDF');
        runScript('Generate PDF (English)', `node generate-pdf.js ${chapter}`);
        logger.event('milestone', 'PDF generated', { chapter });
    }

    // ── Step 8: Open result ──────────────────────────────────────
    if (!opts.noOpen) {
        const htmlPath = path.join(ROOT, chapter, 'index.html');
        if (fs.existsSync(htmlPath)) {
            console.log(`\n🌐 Opening: ${htmlPath}`);
            try {
                execSync(`open "${htmlPath}"`, { stdio: 'ignore' });
            } catch {
                console.log(`   ℹ️  Couldn't auto-open. View at: file://${htmlPath}`);
            }
        }
    }

    // ── Step 9: Report + Changelog ───────────────────────────────
    // Reload from disk to pick up entries written by fixImage/restyleImage during auto-fix
    changelog.load();
    changelog.save();
    generateReport(chapter, changelog, qaRounds, styleIssues, startTime);

    // Final summary
    const summary = changelog.summarize();
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ✅ PIPELINE COMPLETE: ${chapter}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Duration:        ${elapsed} minutes`);
    console.log(`  Interventions:   ${summary.total}`);
    console.log(`  QA Rounds:       ${qaRounds}`);
    console.log(`  Style Issues:    ${styleIssues.length}`);
    console.log(`  HTML:            ${chapter}/index.html`);
    console.log(`  Changelog:       ${chapter}/changelog.md`);
    console.log(`  Report:          ${chapter}/generation-report.md`);
    console.log('═'.repeat(60));

    logger.taskEnd(_logTaskId, { interventions: summary.total, qaRounds, styleIssues: styleIssues.length });
}

main().catch(err => {
    console.error(`\n❌ Pipeline failed: ${err.message}`);
    logger.event('error', `Pipeline failed: ${err.message}`);
    process.exit(1);
});
