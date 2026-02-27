/**
 * Style Consistency Reviewer
 * Uses Claude Code (`claude -p`) to compare newly generated character images
 * against the chapter's target art style.
 * Only runs for `generate_character: true` images.
 * Returns JSON: { pass, score, feedback }
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

class StyleReviewer {
    /**
     * Check if `claude` CLI is available.
     * @returns {Promise<boolean>}
     */
    static async isAvailable() {
        return new Promise(resolve => {
            execFile('which', ['claude'], (error) => {
                resolve(!error);
            });
        });
    }

    /**
     * Review a newly generated character image for style consistency.
     * @param {string} newImagePath - Path to the newly generated image
     * @param {string} styleDescription - Target style description from YAML
     * @param {string} [referenceImagePath] - Optional existing image to compare against
     * @returns {Promise<{pass: boolean, score: number, feedback: string}>}
     */
    static async review(newImagePath, styleDescription, referenceImagePath) {
        const filename = path.basename(newImagePath);

        let prompt = `Read the image at ${newImagePath}.`;

        if (referenceImagePath && fs.existsSync(referenceImagePath)) {
            prompt += ` Also read the reference image at ${referenceImagePath}.`;
            prompt += `\n\nCompare the new image against the reference image for art style consistency.`;
        }

        prompt += `\n\nYou are an art director reviewing illustrations for a children's educational magazine.
The target style is: ${styleDescription}

Evaluate whether the new image matches this target style. Consider:
1. Art style consistency (color palette, line quality, rendering technique)
2. Character design quality (proportions, appeal, child-friendliness)
3. Mood and atmosphere alignment
4. Overall visual quality

Respond with ONLY valid JSON (no markdown, no backticks, no explanation):
{"pass": true/false, "score": 1-10, "feedback": "brief explanation"}

Where score 1=completely wrong style, 5=partially matching, 8=good match, 10=perfect match.
Set pass=true if score >= 6.`;

        return new Promise((resolve, reject) => {
            execFile('claude', ['-p', prompt], {
                timeout: 60000,
                maxBuffer: 1024 * 1024
            }, (error, stdout, stderr) => {
                if (error) {
                    console.log(`   ⚠️ Style review unavailable for ${filename}: ${error.message}`);
                    resolve({ pass: true, score: -1, feedback: 'Style review unavailable' });
                    return;
                }

                try {
                    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                    if (!jsonMatch) {
                        console.log(`   ⚠️ Style review returned non-JSON for ${filename}`);
                        resolve({ pass: true, score: -1, feedback: 'Could not parse response' });
                        return;
                    }
                    const result = JSON.parse(jsonMatch[0]);
                    resolve({
                        pass: !!result.pass,
                        score: typeof result.score === 'number' ? result.score : -1,
                        feedback: result.feedback || ''
                    });
                } catch (parseError) {
                    console.log(`   ⚠️ Style review parse error for ${filename}: ${parseError.message}`);
                    resolve({ pass: true, score: -1, feedback: 'Parse error' });
                }
            });
        });
    }

    /**
     * Save a failed attempt to the attempts directory.
     * @param {string} imagePath - Path to the current (failed) image
     * @param {number} attemptNumber - Attempt number
     * @param {string} chapterDir - Chapter output directory
     * @returns {string} - Path to the saved attempt
     */
    static saveAttempt(imagePath, attemptNumber, chapterDir) {
        const attemptsDir = path.join(chapterDir, 'assets', 'images', 'attempts');
        if (!fs.existsSync(attemptsDir)) {
            fs.mkdirSync(attemptsDir, { recursive: true });
        }

        const ext = path.extname(imagePath);
        const base = path.basename(imagePath, ext);
        const attemptPath = path.join(attemptsDir, `${base}-attempt-${attemptNumber}${ext}`);

        fs.copyFileSync(imagePath, attemptPath);
        console.log(`   📁 Attempt ${attemptNumber} saved: ${path.basename(attemptPath)}`);
        return attemptPath;
    }
}

module.exports = StyleReviewer;
