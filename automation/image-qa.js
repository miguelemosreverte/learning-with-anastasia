/**
 * Image QA Module
 * Uses Claude Code (`claude -p`) to check generated images for artifacts.
 * Checks: extra limbs, unwanted text, style mismatch, distorted faces, quality.
 * Returns JSON: { pass, issues, quality }
 */

const { execFile } = require('child_process');
const path = require('path');

class ImageQA {
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
     * Run QA check on a single image.
     * @param {string} imagePath - Absolute path to the image
     * @param {string} [expectedStyle] - Description of expected art style
     * @returns {Promise<{pass: boolean, issues: string[], quality: number}>}
     */
    static async check(imagePath, expectedStyle) {
        const filename = path.basename(imagePath);
        const styleNote = expectedStyle
            ? `The expected art style is: ${expectedStyle}.`
            : 'The expected art style is Studio Ghibli warmth with Pixar quality, child-friendly.';

        const prompt = `Read the image at ${imagePath}. You are a QA reviewer for AI-generated children's book illustrations.

Check this image for the following issues:
1. Extra or missing limbs on characters
2. Unwanted text, words, letters, or numbers appearing in the image
3. Distorted or uncanny faces
4. Anatomical errors on animals
5. Artifacts, glitches, or rendering errors
6. Overall quality and appeal for a children's audience

${styleNote}

Respond with ONLY valid JSON (no markdown, no backticks, no explanation):
{"pass": true/false, "issues": ["list of issues found or empty array"], "quality": 1-10}

Where quality 1=terrible, 5=acceptable, 8=good, 10=perfect.
Set pass=true if quality >= 6 and no critical issues (extra limbs, text, severe distortion).`;

        return new Promise((resolve, reject) => {
            execFile('claude', ['-p', prompt], {
                timeout: 60000,
                maxBuffer: 1024 * 1024
            }, (error, stdout, stderr) => {
                if (error) {
                    console.log(`   ⚠️ QA check unavailable for ${filename}: ${error.message}`);
                    resolve({ pass: true, issues: ['QA check unavailable'], quality: -1 });
                    return;
                }

                try {
                    // Extract JSON from response (handle potential surrounding text)
                    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                    if (!jsonMatch) {
                        console.log(`   ⚠️ QA returned non-JSON for ${filename}`);
                        resolve({ pass: true, issues: ['Could not parse QA response'], quality: -1 });
                        return;
                    }
                    const result = JSON.parse(jsonMatch[0]);
                    resolve({
                        pass: !!result.pass,
                        issues: Array.isArray(result.issues) ? result.issues : [],
                        quality: typeof result.quality === 'number' ? result.quality : -1
                    });
                } catch (parseError) {
                    console.log(`   ⚠️ QA parse error for ${filename}: ${parseError.message}`);
                    resolve({ pass: true, issues: ['QA parse error'], quality: -1 });
                }
            });
        });
    }

    /**
     * Run QA with retries. If QA fails, the caller should regenerate.
     * @param {string} imagePath - Path to image
     * @param {string} [expectedStyle] - Expected style description
     * @param {number} [maxRetries=3] - Max QA check retries (not regenerations)
     * @returns {Promise<{pass: boolean, issues: string[], quality: number}>}
     */
    static async checkWithRetry(imagePath, expectedStyle, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const result = await ImageQA.check(imagePath, expectedStyle);

            // If QA itself errored (quality=-1), retry the QA check
            if (result.quality === -1 && attempt < maxRetries) {
                console.log(`   🔄 Retrying QA check (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            return result;
        }

        // Should not reach here, but just in case
        return { pass: true, issues: ['QA exhausted retries'], quality: -1 };
    }
}

module.exports = ImageQA;
