/**
 * Report Generator
 * Generates a comprehensive generation-report.md for each chapter.
 * Includes: total time, per-image times, retries, QA results, style scores, costs.
 */

const fs = require('fs');
const path = require('path');

class ReportGenerator {
    constructor(chapterName) {
        this.chapterName = chapterName;
        this.startTime = Date.now();
        this.images = [];
        this.errors = [];
        this.totalRetries = 0;
    }

    /**
     * Record a generated image result.
     * @param {object} entry
     * @param {string} entry.filename - Image filename
     * @param {string} entry.sectionId - Section ID
     * @param {string} entry.service - 'openai' or 'gemini'
     * @param {number} entry.timeMs - Generation time in ms
     * @param {boolean} entry.skipped - Whether the image was already present
     * @param {boolean} entry.success - Whether generation succeeded
     * @param {number} [entry.attempts] - Number of attempts
     * @param {object} [entry.qaResult] - QA result
     * @param {object} [entry.styleResult] - Style review result
     * @param {string} [entry.error] - Error message if failed
     */
    recordImage(entry) {
        this.images.push({
            ...entry,
            timestamp: new Date().toISOString()
        });
        if (entry.attempts && entry.attempts > 1) {
            this.totalRetries += entry.attempts - 1;
        }
        if (entry.error) {
            this.errors.push({ filename: entry.filename, error: entry.error });
        }
    }

    /**
     * Record an error not tied to a specific image.
     */
    recordError(message) {
        this.errors.push({ filename: 'N/A', error: message });
    }

    /**
     * Estimate API costs based on service and image count.
     */
    _estimateCosts() {
        let openaiCount = 0;
        let geminiCount = 0;

        this.images.forEach(img => {
            if (img.skipped) return;
            if (!img.success) return;
            if (img.service === 'openai') openaiCount++;
            else if (img.service === 'gemini') geminiCount++;
        });

        // Rough estimates (DALL-E 3 HD 1792x1024 ~ $0.12, Gemini image gen ~ $0.04)
        const openaiCost = openaiCount * 0.12;
        const geminiCost = geminiCount * 0.04;

        return {
            openai: { count: openaiCount, estimated: openaiCost },
            gemini: { count: geminiCount, estimated: geminiCost },
            total: openaiCost + geminiCost
        };
    }

    /**
     * Generate the final report markdown.
     * @param {string} outputDir - Chapter output directory
     * @returns {string} - Path to the generated report
     */
    generate(outputDir) {
        const totalTimeMs = Date.now() - this.startTime;
        const totalSeconds = (totalTimeMs / 1000).toFixed(1);
        const totalMinutes = (totalTimeMs / 60000).toFixed(1);
        const costs = this._estimateCosts();

        const generated = this.images.filter(i => i.success && !i.skipped);
        const skipped = this.images.filter(i => i.skipped);
        const failed = this.images.filter(i => !i.success && !i.skipped);
        const qaRun = this.images.filter(i => i.qaResult);
        const qaPassed = qaRun.filter(i => i.qaResult && i.qaResult.pass);
        const styleRun = this.images.filter(i => i.styleResult);
        const stylePassed = styleRun.filter(i => i.styleResult && i.styleResult.pass);

        let report = `# Generation Report: ${this.chapterName}\n\n`;
        report += `**Date:** ${new Date().toISOString()}\n`;
        report += `**Total Time:** ${totalMinutes} minutes (${totalSeconds}s)\n`;
        report += `**Total Images:** ${this.images.length}\n\n`;

        // Summary table
        report += '## Summary\n\n';
        report += '| Metric | Value |\n';
        report += '|--------|-------|\n';
        report += `| Generated | ${generated.length} |\n`;
        report += `| Skipped (already existed) | ${skipped.length} |\n`;
        report += `| Failed | ${failed.length} |\n`;
        report += `| Total Retries | ${this.totalRetries} |\n`;
        if (qaRun.length > 0) {
            report += `| QA Checks | ${qaPassed.length}/${qaRun.length} passed |\n`;
        }
        if (styleRun.length > 0) {
            report += `| Style Reviews | ${stylePassed.length}/${styleRun.length} passed |\n`;
        }
        report += '\n';

        // Cost estimate
        report += '## Estimated API Costs\n\n';
        report += '| Service | Images | Estimated Cost |\n';
        report += '|---------|--------|----------------|\n';
        report += `| OpenAI (DALL-E 3) | ${costs.openai.count} | $${costs.openai.estimated.toFixed(2)} |\n`;
        report += `| Gemini | ${costs.gemini.count} | $${costs.gemini.estimated.toFixed(2)} |\n`;
        report += `| **Total** | **${costs.openai.count + costs.gemini.count}** | **$${costs.total.toFixed(2)}** |\n\n`;

        // Per-image details
        report += '## Per-Image Details\n\n';
        report += '| # | Filename | Service | Time | Attempts | QA | Style | Status |\n';
        report += '|---|----------|---------|------|----------|-------|-------|--------|\n';

        this.images.forEach((img, idx) => {
            const time = img.skipped ? '-' : img.timeMs ? `${(img.timeMs / 1000).toFixed(1)}s` : '-';
            const attempts = img.attempts || 1;
            const qa = img.qaResult ? (img.qaResult.pass ? 'Pass' : 'Fail') : '-';
            const style = img.styleResult ? (img.styleResult.pass ? 'Pass' : 'Fail') : '-';
            const status = img.skipped ? 'Skipped' : img.success ? 'OK' : 'Failed';
            report += `| ${idx + 1} | ${img.filename} | ${img.service || '-'} | ${time} | ${attempts} | ${qa} | ${style} | ${status} |\n`;
        });
        report += '\n';

        // Errors section
        if (this.errors.length > 0) {
            report += '## Issues Encountered\n\n';
            this.errors.forEach(err => {
                report += `- **${err.filename}**: ${err.error}\n`;
            });
            report += '\n';
        }

        // Write report
        const reportPath = path.join(outputDir, 'generation-report.md');
        fs.writeFileSync(reportPath, report, 'utf8');
        console.log(`\n📊 Report saved: ${reportPath}`);
        return reportPath;
    }
}

module.exports = ReportGenerator;
