/**
 * Prompt Archiver
 * Saves a .md metadata file alongside every generated image.
 * Contains: full prompt, service, timestamp, references, QA result, generation time.
 */

const fs = require('fs');
const path = require('path');

class PromptArchiver {
    /**
     * Save prompt metadata alongside a generated image.
     * @param {string} imagePath - Absolute path to the generated image
     * @param {object} metadata - Generation metadata
     * @param {string} metadata.prompt - The full prompt used
     * @param {string} metadata.service - 'openai' or 'gemini'
     * @param {string[]} [metadata.references] - Paths to reference images used
     * @param {number} [metadata.generationTimeMs] - Time taken in milliseconds
     * @param {object} [metadata.qaResult] - QA check result { pass, issues, quality }
     * @param {object} [metadata.styleResult] - Style review result { pass, score, feedback }
     * @param {number} [metadata.attempt] - Attempt number (1-based)
     * @param {number} [metadata.totalAttempts] - Total attempts before success
     */
    static save(imagePath, metadata) {
        const mdPath = imagePath.replace(/\.[^.]+$/, '.md');
        const filename = path.basename(imagePath);
        const timestamp = new Date().toISOString();

        let content = `# Image Generation Record: ${filename}\n\n`;
        content += `**Generated:** ${timestamp}\n`;
        content += `**Service:** ${metadata.service || 'unknown'}\n`;

        if (metadata.attempt) {
            content += `**Attempt:** ${metadata.attempt}`;
            if (metadata.totalAttempts) {
                content += ` of ${metadata.totalAttempts}`;
            }
            content += '\n';
        }

        if (metadata.generationTimeMs) {
            const seconds = (metadata.generationTimeMs / 1000).toFixed(1);
            content += `**Generation Time:** ${seconds}s\n`;
        }

        content += '\n## Prompt\n\n';
        content += '```\n' + (metadata.prompt || 'N/A') + '\n```\n';

        if (metadata.references && metadata.references.length > 0) {
            content += '\n## Reference Images\n\n';
            metadata.references.forEach(ref => {
                content += `- \`${path.basename(ref)}\`\n`;
            });
        }

        if (metadata.qaResult) {
            content += '\n## QA Result\n\n';
            content += `- **Pass:** ${metadata.qaResult.pass ? 'Yes' : 'No'}\n`;
            if (metadata.qaResult.quality !== undefined) {
                content += `- **Quality Score:** ${metadata.qaResult.quality}/10\n`;
            }
            if (metadata.qaResult.issues && metadata.qaResult.issues.length > 0) {
                content += `- **Issues:** ${metadata.qaResult.issues.join(', ')}\n`;
            }
        }

        if (metadata.styleResult) {
            content += '\n## Style Review\n\n';
            content += `- **Pass:** ${metadata.styleResult.pass ? 'Yes' : 'No'}\n`;
            if (metadata.styleResult.score !== undefined) {
                content += `- **Score:** ${metadata.styleResult.score}/10\n`;
            }
            if (metadata.styleResult.feedback) {
                content += `- **Feedback:** ${metadata.styleResult.feedback}\n`;
            }
        }

        fs.writeFileSync(mdPath, content, 'utf8');
        return mdPath;
    }

    /**
     * Read existing prompt metadata for an image.
     * @param {string} imagePath - Path to the image
     * @returns {string|null} - Markdown content or null
     */
    static read(imagePath) {
        const mdPath = imagePath.replace(/\.[^.]+$/, '.md');
        if (fs.existsSync(mdPath)) {
            return fs.readFileSync(mdPath, 'utf8');
        }
        return null;
    }
}

module.exports = PromptArchiver;
