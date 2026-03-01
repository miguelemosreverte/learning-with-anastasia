/**
 * prompt-sanitizer.js — AI-powered prompt rewriter for content moderation safety
 *
 * Rewrites image generation prompts to avoid content moderation triggers
 * while preserving artistic intent. Uses Gemini text model for intelligent
 * rewrites, with regex pre-screening and rule-based fallback.
 *
 * Usage:
 *   const sanitizer = require('./automation/prompt-sanitizer');
 *   const { sanitized, wasModified, triggeredPatterns } = await sanitizer.sanitize(prompt);
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// In-memory cache: prompt hash -> sanitized result
const cache = new Map();

// Known problematic patterns for image generation APIs
const RISK_PATTERNS = [
    { pattern: /\battack(ing|ed|s)?\b/i, label: 'attack' },
    { pattern: /\bfight(ing|s)?\b/i, label: 'fight' },
    { pattern: /\bkill(ed|ing|s)?\b/i, label: 'kill' },
    { pattern: /\bblood(y|ied)?\b/i, label: 'blood' },
    { pattern: /\bbattle[sd]?\b/i, label: 'battle' },
    { pattern: /\bwar\b/i, label: 'war' },
    { pattern: /\bdeath\b/i, label: 'death' },
    { pattern: /\bdying\b/i, label: 'dying' },
    { pattern: /\bsting(ing|s)?\b/i, label: 'sting' },
    { pattern: /\baggress(ion|ive|ively)?\b/i, label: 'aggression' },
    { pattern: /\bscar(red|s)?\b/i, label: 'scar' },
    { pattern: /\bwound(ed|s)?\b/i, label: 'wound' },
    { pattern: /\brival(ry|s)?\b/i, label: 'rival' },
    { pattern: /\bconquer(ed|ing|s)?\b/i, label: 'conquer' },
    { pattern: /\bdestroy(ed|ing|s)?\b/i, label: 'destroy' },
    { pattern: /\binvad(e|ing|ers?)?\b/i, label: 'invade' },
    { pattern: /\bsnarl(ing|s)?\b/i, label: 'snarl' },
    { pattern: /\bteeth\s+bared\b/i, label: 'teeth bared' },
    { pattern: /\bfierce(ly)?\b/i, label: 'fierce' },
    { pattern: /\bvenom(ous)?\b/i, label: 'venom' },
    { pattern: /\bpredator(y|s)?\b/i, label: 'predator' },
    { pattern: /\bprey(ing|ed|s)?\b/i, label: 'prey' },
    { pattern: /\bdefeat(ed|ing)?\b/i, label: 'defeat' },
    { pattern: /\bslaughter/i, label: 'slaughter' },
    { pattern: /\bbiting\b/i, label: 'biting' },
    { pattern: /\bclawing\b/i, label: 'clawing' },
    { pattern: /\bcowering\b/i, label: 'cowering' },
    { pattern: /\bfallen\b/i, label: 'fallen' },
    { pattern: /\bdomin(ance|ating|ant)\b/i, label: 'dominance' },
    { pattern: /\bmat(e|ing)\b/i, label: 'mating' },
    { pattern: /\bbreed(ing|s)?\b/i, label: 'breeding' },
    { pattern: /\breproduct/i, label: 'reproduction' },
    { pattern: /\bchemical\s+warfare\b/i, label: 'chemical warfare' },
    { pattern: /\bsiege\b/i, label: 'siege' },
    { pattern: /\barmy\b/i, label: 'army' },
    { pattern: /\bweapon(s|ry)?\b/i, label: 'weapon' },
    { pattern: /\bintruder(s)?\b/i, label: 'intruder' },
    { pattern: /\bthreat(en|ening|s)?\b/i, label: 'threat' },
    { pattern: /\bdevour(ing|ed|s)?\b/i, label: 'devour' },
    { pattern: /\bhunt(ing|ed|s|er)?\b/i, label: 'hunt' },
    { pattern: /\bstalk(ing|ed|s)?\b/i, label: 'stalk' },
];

function findTriggeredPatterns(prompt) {
    return RISK_PATTERNS
        .filter(rp => rp.pattern.test(prompt))
        .map(rp => rp.label);
}

function hashPrompt(prompt) {
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
        hash = ((hash << 5) - hash) + prompt.charCodeAt(i);
        hash |= 0;
    }
    return 'p_' + Math.abs(hash).toString(36);
}

class PromptSanitizer {
    constructor() {
        this.ai = null;
        this._initAI();
    }

    _initAI() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
            this.ai = new GoogleGenerativeAI(apiKey);
        }
    }

    /**
     * Sanitize a prompt for image generation APIs.
     * @param {string} prompt - The raw prompt text
     * @returns {Promise<{sanitized: string, wasModified: boolean, original: string, triggeredPatterns: string[], method: string}>}
     */
    async sanitize(prompt) {
        const triggeredPatterns = findTriggeredPatterns(prompt);

        // Quick check: if no risky patterns, return as-is
        if (triggeredPatterns.length === 0) {
            return { sanitized: prompt, wasModified: false, original: prompt, triggeredPatterns: [], method: 'none' };
        }

        // Check cache
        const key = hashPrompt(prompt);
        if (cache.has(key)) {
            const cached = cache.get(key);
            return { ...cached, cached: true };
        }

        // No AI available, do rule-based fallback
        if (!this.ai) {
            if (!process.env.GEMINI_API_KEY) this._initAI();
            if (!this.ai) {
                const fallback = this._ruleBased(prompt);
                const result = { sanitized: fallback, wasModified: true, original: prompt, triggeredPatterns, method: 'rule-based' };
                cache.set(key, result);
                return result;
            }
        }

        // Use Gemini to rewrite
        try {
            const model = this.ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const response = await model.generateContent(`You are a prompt rewriter for AI image generation APIs (DALL-E, Gemini Image).

Your job: rewrite the prompt below to preserve the EXACT same visual scene and artistic intent, but remove or rephrase any words/phrases that could trigger content moderation filters.

RULES:
- Replace violence words (attack, fight, kill, battle, scar, hunt, stalk) with visual equivalents (confrontation, tension, marked, weathered, pursuing, observing)
- Replace death/injury (wound, blood, fallen, defeat) with metaphorical descriptions (weariness, solitude, departure)
- Replace aggression (snarling, teeth bared, fierce) with intensity (intense expression, powerful stance, determined gaze)
- Replace mating/reproduction terms with neutral alternatives (bonding, closeness, pair bond)
- Replace military terms (army, siege, warfare, weapon) with group terms (large group, encirclement, defense, tools)
- Keep ALL visual details: colors, composition, lighting, animals, setting, characters
- Keep the scene recognizable — same characters, same mood, same framing
- Output ONLY the rewritten prompt, nothing else

ORIGINAL PROMPT:
${prompt}`);

            const sanitized = response.response.text().trim();
            console.log(`   [Sanitizer] Rewrote prompt (${prompt.length} -> ${sanitized.length} chars, triggers: ${triggeredPatterns.join(', ')})`);
            const result = { sanitized, wasModified: true, original: prompt, triggeredPatterns, method: 'gemini' };
            cache.set(key, result);
            return result;
        } catch (err) {
            console.log(`   [Sanitizer] AI rewrite failed (${err.message}), using rule-based fallback`);
            const fallback = this._ruleBased(prompt);
            const result = { sanitized: fallback, wasModified: true, original: prompt, triggeredPatterns, method: 'rule-based' };
            cache.set(key, result);
            return result;
        }
    }

    /**
     * Rule-based fallback when Gemini text is unavailable
     */
    _ruleBased(prompt) {
        return prompt
            .replace(/\battack(ing|ed|s)?\b/gi, 'approaching')
            .replace(/\bfight(ing|s)?\b/gi, 'confrontation')
            .replace(/\bbattle[sd]?\b/gi, 'standoff')
            .replace(/\bkill(ed|ing|s)?\b/gi, 'overpower')
            .replace(/\bblood(y|ied)?\b/gi, 'intense')
            .replace(/\bwar\b/gi, 'conflict')
            .replace(/\bdeath\b/gi, 'departure')
            .replace(/\bdying\b/gi, 'fading')
            .replace(/\bscar(red|s)?\b/gi, 'weathered')
            .replace(/\bwound(ed|s)?\b/gi, 'marked')
            .replace(/\bsnarl(ing|s)?\b/gi, 'intense expression')
            .replace(/\bteeth\s+bared\b/gi, 'mouth open in a powerful roar')
            .replace(/\bfierce(ly)?\b/gi, 'intensely determined')
            .replace(/\baggress(ion|ive|ively)?\b/gi, 'intensity')
            .replace(/\bdefeat(ed)?\b/gi, 'weariness')
            .replace(/\bfallen\b/gi, 'departing')
            .replace(/\bcowering\b/gi, 'sheltering')
            .replace(/\bchemical\s+warfare\b/gi, 'chemical defense')
            .replace(/\bsiege\b/gi, 'encirclement')
            .replace(/\binvad(e|ing|ers?)\b/gi, 'approaching')
            .replace(/\barmy\b/gi, 'large group')
            .replace(/\bmat(e|ing)\b/gi, 'bonding')
            .replace(/\bbreed(ing|s)?\b/gi, 'nurturing')
            .replace(/\bhunt(ing|ed|s|er)?\b/gi, 'pursuing')
            .replace(/\bstalk(ing|ed|s)?\b/gi, 'observing')
            .replace(/\bpredator(y|s)?\b/gi, 'observer')
            .replace(/\bprey(ing|ed|s)?\b/gi, 'target')
            .replace(/\bdevour(ing|ed|s)?\b/gi, 'consuming')
            .replace(/\bvenom(ous)?\b/gi, 'potent')
            .replace(/\bsting(ing|s)?\b/gi, 'touching')
            .replace(/\bthreat(en|ening|s)?\b/gi, 'approaching')
            .replace(/\bweapon(s|ry)?\b/gi, 'tools')
            .replace(/\bdomin(ance|ating|ant)\b/gi, 'leadership')
            .replace(/\bslaughter/gi, 'overwhelm');
    }
}

// Singleton
module.exports = new PromptSanitizer();
