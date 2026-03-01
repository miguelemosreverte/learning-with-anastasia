/**
 * prompt-history.js — Prompt versioning and forensics log
 *
 * Tracks every prompt attempt: original text, sanitized version,
 * triggered patterns, outcome (success/content_filter/qa_failed/api_error),
 * and timing. Append-only JSONL at logs/prompt-history.jsonl with
 * auto-rendered logs/prompt-history.md.
 *
 * Usage:
 *   const promptHistory = require('./automation/prompt-history');
 *   promptHistory.record({
 *     image: 'lions/assets/images/kazi-roaring.jpg',
 *     chapter: 'lions', sectionId: 'meet-kazi', attempt: 1,
 *     service: 'gemini', original: '...', sanitized: '...',
 *     wasSanitized: true, sanitizeMethod: 'gemini',
 *     triggeredPatterns: ['fierce', 'snarl'],
 *     outcome: 'success', error: null,
 *     qaResult: { pass: true, quality: 8 }, durationMs: 12345
 *   });
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'logs');
const JSONL_PATH = path.join(LOGS_DIR, 'prompt-history.jsonl');
const MD_PATH = path.join(LOGS_DIR, 'prompt-history.md');

class PromptHistory {
    /**
     * Record a prompt attempt.
     */
    record(entry) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
        entry.ts = new Date().toISOString();
        fs.appendFileSync(JSONL_PATH, JSON.stringify(entry) + '\n');
        this._renderMarkdown();
    }

    /**
     * Read all entries, optionally filtered.
     */
    readAll(filter = {}) {
        if (!fs.existsSync(JSONL_PATH)) return [];
        const lines = fs.readFileSync(JSONL_PATH, 'utf8').trim().split('\n');
        let entries = [];
        for (const line of lines) {
            if (!line.trim()) continue;
            try { entries.push(JSON.parse(line)); } catch { /* skip corrupt */ }
        }
        if (filter.chapter) entries = entries.filter(e => e.chapter === filter.chapter);
        if (filter.sectionId) entries = entries.filter(e => e.sectionId === filter.sectionId);
        return entries;
    }

    _renderMarkdown() {
        const entries = this.readAll();
        if (entries.length === 0) return;

        // Group by chapter, then by sectionId
        const byChapter = new Map();
        for (const e of entries) {
            const ch = e.chapter || 'unknown';
            if (!byChapter.has(ch)) byChapter.set(ch, new Map());
            const sections = byChapter.get(ch);
            const sid = e.sectionId || 'unknown';
            if (!sections.has(sid)) sections.set(sid, []);
            sections.get(sid).push(e);
        }

        const md = ['# Prompt History', ''];

        // Summary stats
        const total = entries.length;
        const sanitized = entries.filter(e => e.wasSanitized).length;
        const successes = entries.filter(e => e.outcome === 'success').length;
        const failures = total - successes;
        md.push(`> ${total} total attempts | ${sanitized} sanitized | ${successes} succeeded | ${failures} failed`, '');

        for (const [chapter, sections] of byChapter) {
            md.push(`## ${chapter}`, '');

            for (const [sectionId, attempts] of sections) {
                const imageFile = attempts[0]?.image ? path.basename(attempts[0].image) : '';
                md.push(`### ${sectionId}${imageFile ? ` (${imageFile})` : ''}`, '');
                md.push('| # | Triggered | Sanitized? | Service | Outcome | Duration |');
                md.push('|---|-----------|------------|---------|---------|----------|');

                for (const a of attempts) {
                    const triggers = (a.triggeredPatterns || []).join(', ') || '-';
                    const sanMethod = a.wasSanitized ? `Yes (${a.sanitizeMethod || '?'})` : 'No';
                    const dur = a.durationMs ? `${(a.durationMs / 1000).toFixed(1)}s` : '-';
                    const outcome = a.outcome || '?';
                    md.push(`| ${a.attempt || '?'} | ${triggers} | ${sanMethod} | ${a.service || '?'} | ${outcome} | ${dur} |`);
                }

                // Show prompt evolution if sanitized
                const sanitizedAttempts = attempts.filter(a => a.wasSanitized);
                if (sanitizedAttempts.length > 0) {
                    md.push('');
                    md.push('<details><summary>Prompt evolution</summary>', '');
                    for (const a of sanitizedAttempts) {
                        const origExcerpt = (a.original || '').substring(0, 120).replace(/\n/g, ' ');
                        const sanExcerpt = (a.sanitized || '').substring(0, 120).replace(/\n/g, ' ');
                        md.push(`**Attempt ${a.attempt || '?'}:**`);
                        md.push(`- Original: \`${origExcerpt}...\``);
                        md.push(`- Sanitized: \`${sanExcerpt}...\``);
                        if (a.error) md.push(`- Error: ${a.error}`);
                        md.push('');
                    }
                    md.push('</details>');
                }

                md.push('');
            }
        }

        fs.writeFileSync(MD_PATH, md.join('\n'));
    }
}

// Singleton
module.exports = new PromptHistory();
