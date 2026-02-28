/**
 * changelog.js — Forensic intervention logging + KPI summary
 *
 * Tracks every fix-image / restyle-image / regenerate intervention
 * per chapter, preserving before/after image references for visual
 * comparison. Nothing is discarded — every attempt is evidence.
 *
 * Outputs:
 *   - changelog.json  — Machine-readable entries + KPI summary
 *   - changelog.md    — Human-readable Markdown report
 *   - changelog.html  — Visual forensic report with before/after images
 *
 * Usage:
 *   const ChangeLog = require('./automation/changelog');
 *   const log = new ChangeLog('birds');
 *   log.log({
 *     image: 'zuri-portrait.jpg',
 *     tag: '#1',
 *     type: 'anatomical-fix',
 *     tool: 'fix-image',
 *     description: 'bird has 3 legs',
 *     beforeImage: 'assets/images/attempts/zuri-portrait-v1.jpg',
 *     afterImage: 'assets/images/zuri-portrait.jpg',
 *     attemptImages: ['assets/images/attempts/zuri-portrait-v1.jpg', 'assets/images/attempts/zuri-portrait-v2.jpg'],
 *     ...
 *   });
 *   log.save();
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

class ChangeLog {
    constructor(chapterName) {
        this.chapter = chapterName;
        this.chapterDir = path.join(ROOT, chapterName);
        this.jsonPath = path.join(this.chapterDir, 'changelog.json');
        this.mdPath = path.join(this.chapterDir, 'changelog.md');
        this.htmlPath = path.join(this.chapterDir, 'changelog.html');
        this.entries = [];
        this.load();
    }

    /**
     * Load existing changelog from disk (if any)
     */
    load() {
        if (fs.existsSync(this.jsonPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8'));
                this.entries = data.entries || [];
            } catch {
                this.entries = [];
            }
        }
        return this;
    }

    /**
     * Log a single intervention event with full image forensics
     *
     * @param {Object} entry
     * @param {string} entry.image         — Filename (e.g. 'zuri-portrait.jpg')
     * @param {string} entry.tag           — Tag shorthand (e.g. '#1', 'V2')
     * @param {string} entry.type          — anatomical-fix | physics-fix | style-restyle | composition-fix | narrative-fix
     * @param {string} entry.tool          — fix-image | restyle-image | regenerate
     * @param {string} entry.description   — What was wrong / what was requested
     * @param {number} entry.attempts      — How many generation attempts
     * @param {boolean} entry.verified     — Did the final result pass verification
     * @param {boolean} entry.automated    — true if agent-driven, false if human-invoked
     * @param {string} entry.beforeImage   — Relative path to original (before fix), from chapter dir
     * @param {string} entry.afterImage    — Relative path to result (after fix), from chapter dir
     * @param {string[]} entry.attemptImages — Relative paths to all intermediate attempts
     * @param {number} entry.cost_estimate — Estimated API cost in USD
     */
    log({
        image,
        tag = '',
        type = 'anatomical-fix',
        tool = 'fix-image',
        description = '',
        attempts = 1,
        verified = false,
        automated = false,
        beforeImage = '',
        afterImage = '',
        attemptImages = [],
        cost_estimate = 0
    }) {
        const entry = {
            timestamp: new Date().toISOString(),
            image,
            tag,
            type,
            tool,
            description,
            attempts,
            verified,
            automated,
            beforeImage,
            afterImage,
            attemptImages,
            cost_estimate: cost_estimate || this._estimateCost(tool, attempts)
        };

        this.entries.push(entry);
        return entry;
    }

    /**
     * Rough cost estimate per intervention
     */
    _estimateCost(tool, attempts) {
        const baseCost = { 'fix-image': 0.04, 'restyle-image': 0.05, 'regenerate': 0.06 };
        return parseFloat(((baseCost[tool] || 0.04) * attempts).toFixed(3));
    }

    /**
     * Generate KPI summary object
     */
    summarize() {
        const total = this.entries.length;
        if (total === 0) return { total: 0 };

        const byType = {};
        const byTool = {};
        let totalAttempts = 0;
        let verified = 0;
        let automated = 0;
        let totalCost = 0;

        for (const e of this.entries) {
            byType[e.type] = (byType[e.type] || 0) + 1;
            byTool[e.tool] = (byTool[e.tool] || 0) + 1;
            totalAttempts += e.attempts;
            if (e.verified) verified++;
            if (e.automated) automated++;
            totalCost += e.cost_estimate || 0;
        }

        return {
            total,
            byType,
            byTool,
            verified,
            verifiedRate: `${((verified / total) * 100).toFixed(0)}%`,
            automated,
            manual: total - automated,
            automatedRate: `${((automated / total) * 100).toFixed(0)}%`,
            avgAttempts: parseFloat((totalAttempts / total).toFixed(1)),
            totalCost: parseFloat(totalCost.toFixed(3))
        };
    }

    /**
     * Save JSON, Markdown, and HTML files
     */
    save() {
        if (!fs.existsSync(this.chapterDir)) {
            fs.mkdirSync(this.chapterDir, { recursive: true });
        }

        // Write JSON
        const jsonData = {
            chapter: this.chapter,
            lastUpdated: new Date().toISOString(),
            summary: this.summarize(),
            entries: this.entries
        };
        fs.writeFileSync(this.jsonPath, JSON.stringify(jsonData, null, 2));

        // Write Markdown
        fs.writeFileSync(this.mdPath, this._generateMarkdown());

        // Write HTML (visual forensic report)
        fs.writeFileSync(this.htmlPath, this._generateHTML());

        return this;
    }

    /**
     * Generate human-readable Markdown changelog
     */
    _generateMarkdown() {
        const summary = this.summarize();
        const lines = [];

        lines.push(`# Changelog: ${this.chapter}`);
        lines.push(`> Last updated: ${new Date().toISOString()}\n`);

        lines.push(`## KPI Summary`);
        lines.push(`| Metric | Value |`);
        lines.push(`|--------|-------|`);
        lines.push(`| Total interventions | ${summary.total} |`);

        if (summary.total > 0) {
            lines.push(`| Verified fixes | ${summary.verified} (${summary.verifiedRate}) |`);
            lines.push(`| Automated | ${summary.automated} (${summary.automatedRate}) |`);
            lines.push(`| Manual | ${summary.manual} |`);
            lines.push(`| Avg attempts per fix | ${summary.avgAttempts} |`);
            lines.push(`| Estimated cost | $${summary.totalCost.toFixed(2)} |`);

            lines.push(`\n## By Type`);
            lines.push(`| Type | Count |`);
            lines.push(`|------|-------|`);
            for (const [type, count] of Object.entries(summary.byType)) {
                lines.push(`| ${type} | ${count} |`);
            }

            lines.push(`\n## By Tool`);
            lines.push(`| Tool | Count |`);
            lines.push(`|------|-------|`);
            for (const [tool, count] of Object.entries(summary.byTool)) {
                lines.push(`| ${tool} | ${count} |`);
            }

            lines.push(`\n## Intervention Log`);
            this.entries.forEach((e, i) => {
                const time = e.timestamp.replace('T', ' ').replace(/\.\d+Z/, '');
                const v = e.verified ? 'PASS' : 'FAIL';
                const a = e.automated ? 'auto' : 'manual';
                lines.push(`\n### #${i + 1} — ${e.image} (${e.tag})`);
                lines.push(`- **Time:** ${time}`);
                lines.push(`- **Type:** ${e.type} | **Tool:** ${e.tool} | **Mode:** ${a}`);
                lines.push(`- **Attempts:** ${e.attempts} | **Verified:** ${v}`);
                lines.push(`- **Description:** ${e.description}`);
                if (e.beforeImage) lines.push(`- **Before:** ${e.beforeImage}`);
                if (e.afterImage) lines.push(`- **After:** ${e.afterImage}`);
                if (e.attemptImages && e.attemptImages.length > 0) {
                    lines.push(`- **Attempts:** ${e.attemptImages.join(', ')}`);
                }
            });
        } else {
            lines.push(`\n*No interventions recorded — clean generation!*`);
        }

        lines.push('');
        return lines.join('\n');
    }

    /**
     * Generate visual HTML forensic report with before/after images
     */
    _generateHTML() {
        const summary = this.summarize();
        const timestamp = new Date().toISOString();

        // Build intervention cards
        let cardsHTML = '';
        if (summary.total > 0) {
            this.entries.forEach((e, i) => {
                const time = e.timestamp.replace('T', ' ').replace(/\.\d+Z/, '');
                const statusClass = e.verified ? 'verified' : 'failed';
                const statusLabel = e.verified ? 'VERIFIED' : 'FAILED';
                const modeLabel = e.automated ? 'Automated' : 'Manual';

                // Before/after images
                let imagesHTML = '';
                if (e.beforeImage || e.afterImage) {
                    imagesHTML += `<div class="image-comparison">`;
                    if (e.beforeImage) {
                        imagesHTML += `
              <div class="image-panel">
                <div class="image-label">BEFORE</div>
                <img src="${e.beforeImage}" alt="Before: ${e.image}" onerror="this.parentElement.innerHTML='<div class=\\'missing\\'>Image not found</div>'" />
              </div>`;
                    }
                    if (e.afterImage) {
                        imagesHTML += `
              <div class="image-panel">
                <div class="image-label after-label">AFTER</div>
                <img src="${e.afterImage}" alt="After: ${e.image}" onerror="this.parentElement.innerHTML='<div class=\\'missing\\'>Image not found</div>'" />
              </div>`;
                    }
                    imagesHTML += `</div>`;
                }

                // Intermediate attempts
                let attemptsHTML = '';
                if (e.attemptImages && e.attemptImages.length > 1) {
                    attemptsHTML = `
            <details class="attempts-detail">
              <summary>All ${e.attemptImages.length} attempts</summary>
              <div class="attempts-grid">
                ${e.attemptImages.map((img, j) => `
                  <div class="attempt-thumb">
                    <div class="attempt-label">v${j + 1}</div>
                    <img src="${img}" alt="Attempt ${j + 1}" onerror="this.parentElement.innerHTML='<div class=\\'missing\\'>v${j + 1} missing</div>'" />
                  </div>`).join('')}
              </div>
            </details>`;
                }

                cardsHTML += `
          <div class="card ${statusClass}">
            <div class="card-header">
              <span class="card-number">#${i + 1}</span>
              <span class="card-image">${e.image}</span>
              <span class="card-tag">${e.tag}</span>
              <span class="status-badge ${statusClass}">${statusLabel}</span>
            </div>
            <div class="card-meta">
              <span>${e.type}</span>
              <span>${e.tool}</span>
              <span>${modeLabel}</span>
              <span>${e.attempts} attempt${e.attempts !== 1 ? 's' : ''}</span>
              <span class="card-time">${time}</span>
            </div>
            <div class="card-description">${e.description}</div>
            ${imagesHTML}
            ${attemptsHTML}
          </div>`;
            });
        } else {
            cardsHTML = `<div class="clean-run">No interventions — clean generation!</div>`;
        }

        // Summary stats
        const statsHTML = summary.total > 0 ? `
        <div class="stats-grid">
          <div class="stat"><div class="stat-value">${summary.total}</div><div class="stat-label">Interventions</div></div>
          <div class="stat"><div class="stat-value">${summary.verified}</div><div class="stat-label">Verified (${summary.verifiedRate})</div></div>
          <div class="stat"><div class="stat-value">${summary.automated}</div><div class="stat-label">Automated (${summary.automatedRate})</div></div>
          <div class="stat"><div class="stat-value">${summary.manual}</div><div class="stat-label">Manual</div></div>
          <div class="stat"><div class="stat-value">${summary.avgAttempts}</div><div class="stat-label">Avg Attempts</div></div>
          <div class="stat"><div class="stat-value">$${summary.totalCost.toFixed(2)}</div><div class="stat-label">Est. Cost</div></div>
        </div>
        <div class="breakdown-row">
          <div class="breakdown">
            <h3>By Type</h3>
            ${Object.entries(summary.byType).map(([t, c]) => `<div class="breakdown-item"><span>${t}</span><span>${c}</span></div>`).join('')}
          </div>
          <div class="breakdown">
            <h3>By Tool</h3>
            ${Object.entries(summary.byTool).map(([t, c]) => `<div class="breakdown-item"><span>${t}</span><span>${c}</span></div>`).join('')}
          </div>
        </div>` : '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Changelog — ${this.chapter}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; }
  h1 { color: #f0f6fc; margin-bottom: 0.25rem; }
  .subtitle { color: #8b949e; margin-bottom: 2rem; font-size: 0.9rem; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; text-align: center; }
  .stat-value { font-size: 1.8rem; font-weight: 700; color: #58a6ff; }
  .stat-label { font-size: 0.8rem; color: #8b949e; margin-top: 0.25rem; }
  .breakdown-row { display: flex; gap: 2rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .breakdown { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem; flex: 1; min-width: 200px; }
  .breakdown h3 { color: #f0f6fc; font-size: 0.9rem; margin-bottom: 0.5rem; }
  .breakdown-item { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem; border-bottom: 1px solid #21262d; }
  .breakdown-item:last-child { border-bottom: none; }
  h2 { color: #f0f6fc; margin: 2rem 0 1rem; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 1.5rem; overflow: hidden; }
  .card.verified { border-left: 4px solid #3fb950; }
  .card.failed { border-left: 4px solid #f85149; }
  .card-header { display: flex; align-items: center; gap: 0.75rem; padding: 1rem 1rem 0.5rem; flex-wrap: wrap; }
  .card-number { font-weight: 700; color: #8b949e; font-size: 0.85rem; }
  .card-image { font-weight: 600; color: #f0f6fc; font-family: monospace; font-size: 0.95rem; }
  .card-tag { background: #30363d; color: #c9d1d9; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-family: monospace; }
  .status-badge { padding: 0.15rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
  .status-badge.verified { background: #23842a; color: #fff; }
  .status-badge.failed { background: #b62324; color: #fff; }
  .card-meta { display: flex; gap: 1rem; padding: 0 1rem 0.5rem; font-size: 0.8rem; color: #8b949e; flex-wrap: wrap; }
  .card-time { margin-left: auto; }
  .card-description { padding: 0.5rem 1rem 1rem; font-size: 0.9rem; line-height: 1.5; }
  .image-comparison { display: flex; gap: 1rem; padding: 0 1rem 1rem; flex-wrap: wrap; }
  .image-panel { flex: 1; min-width: 250px; }
  .image-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; padding: 0.3rem 0.6rem; background: #b62324; color: #fff; display: inline-block; border-radius: 4px 4px 0 0; }
  .after-label { background: #23842a; }
  .image-panel img { width: 100%; border-radius: 0 4px 4px 4px; border: 1px solid #30363d; display: block; }
  .missing { padding: 3rem; text-align: center; color: #8b949e; background: #0d1117; border-radius: 4px; border: 1px dashed #30363d; }
  .attempts-detail { padding: 0 1rem 1rem; }
  .attempts-detail summary { cursor: pointer; color: #58a6ff; font-size: 0.85rem; padding: 0.25rem 0; }
  .attempts-grid { display: flex; gap: 0.75rem; margin-top: 0.5rem; overflow-x: auto; padding-bottom: 0.5rem; }
  .attempt-thumb { min-width: 150px; max-width: 200px; }
  .attempt-label { font-size: 0.7rem; font-weight: 600; color: #8b949e; text-transform: uppercase; margin-bottom: 0.25rem; }
  .attempt-thumb img { width: 100%; border-radius: 4px; border: 1px solid #30363d; }
  .clean-run { text-align: center; padding: 4rem 2rem; font-size: 1.2rem; color: #3fb950; background: #161b22; border-radius: 8px; border: 1px solid #30363d; }
</style>
</head>
<body>
  <h1>Changelog: ${this.chapter}</h1>
  <div class="subtitle">Last updated: ${timestamp} &mdash; Every attempt is preserved, nothing is discarded.</div>

  ${statsHTML}

  <h2>Interventions</h2>
  ${cardsHTML}
</body>
</html>`;
    }
}

module.exports = ChangeLog;
