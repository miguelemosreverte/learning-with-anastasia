/**
 * logger.js — Centralized activity logger for the pipeline
 *
 * Logs timestamped events to logs/activity.jsonl (machine-readable)
 * and auto-renders logs/activity.md (human-readable) on every write.
 *
 * Usage:
 *   const logger = require('./automation/logger');
 *   logger.sessionStart();
 *   const taskId = logger.taskStart('Generate lions images');
 *   logger.event('milestone', 'HTML built', { chapter: 'lions' });
 *   logger.taskEnd(taskId, { generated: 8, failed: 4 });
 *   logger.sessionEnd();
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'logs');
const JSONL_PATH = path.join(LOGS_DIR, 'activity.jsonl');
const MD_PATH = path.join(LOGS_DIR, 'activity.md');

function genId(prefix) {
    return prefix + '_' + crypto.randomBytes(4).toString('hex');
}

function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function formatTime(isoString) {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(isoString) {
    return isoString.slice(0, 10);
}

class Logger {
    constructor() {
        this._sessionId = null;
        this._sessionStart = null;
        this._tasks = new Map(); // taskId -> { task, startTime }
    }

    // ── Public API ──────────────────────────────────────────────────

    sessionStart() {
        this._sessionId = genId('s');
        this._sessionStart = Date.now();
        this._append({
            event: 'session_start',
            sessionId: this._sessionId
        });
        return this._sessionId;
    }

    taskStart(taskName) {
        this._ensureSession();
        const taskId = genId('t');
        this._tasks.set(taskId, { task: taskName, startTime: Date.now() });
        this._append({
            event: 'task_start',
            task: taskName,
            taskId,
            sessionId: this._sessionId
        });
        return taskId;
    }

    event(type, label, meta = {}) {
        this._ensureSession();
        this._append({
            event: type,
            label,
            sessionId: this._sessionId,
            meta
        });
    }

    taskEnd(taskId, meta = {}) {
        const info = this._tasks.get(taskId);
        if (!info) return;
        const durationS = Math.round((Date.now() - info.startTime) / 1000);
        this._append({
            event: 'task_end',
            task: info.task,
            taskId,
            sessionId: this._sessionId,
            duration_s: durationS,
            meta
        });
        this._tasks.delete(taskId);
    }

    sessionEnd() {
        if (!this._sessionId) return;
        const durationS = this._sessionStart
            ? Math.round((Date.now() - this._sessionStart) / 1000)
            : 0;
        this._append({
            event: 'session_end',
            sessionId: this._sessionId,
            duration_s: durationS
        });
        this._sessionId = null;
        this._sessionStart = null;
    }

    // ── Internal ────────────────────────────────────────────────────

    _ensureSession() {
        if (!this._sessionId) {
            this.sessionStart();
        }
    }

    _append(entry) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
        entry.ts = new Date().toISOString();
        fs.appendFileSync(JSONL_PATH, JSON.stringify(entry) + '\n');
        this._renderMarkdown();
    }

    _renderMarkdown() {
        let lines;
        try {
            lines = fs.readFileSync(JSONL_PATH, 'utf8').trim().split('\n');
        } catch {
            return;
        }

        const entries = [];
        for (const line of lines) {
            try { entries.push(JSON.parse(line)); } catch { /* skip corrupt lines */ }
        }
        if (entries.length === 0) return;

        // Group by date, then by session
        const byDate = new Map();
        for (const e of entries) {
            const date = formatDate(e.ts);
            if (!byDate.has(date)) byDate.set(date, new Map());
            const sessions = byDate.get(date);
            const sid = e.sessionId || 'unknown';
            if (!sessions.has(sid)) sessions.set(sid, []);
            sessions.get(sid).push(e);
        }

        const md = ['# Activity Log', ''];

        for (const [date, sessions] of byDate) {
            md.push(`## ${date}`, '');

            for (const [sid, events] of sessions) {
                // Compute session time range and duration
                const first = events[0];
                const last = events[events.length - 1];
                const startTime = formatTime(first.ts);
                const endTime = formatTime(last.ts);

                const sessionEnd = events.find(e => e.event === 'session_end');
                const durationStr = sessionEnd
                    ? ` — ${formatDuration(sessionEnd.duration_s)}`
                    : '';

                md.push(`### Session ${sid} (${startTime} — ${endTime})${durationStr}`, '');
                md.push('| Time | Event | Details |');
                md.push('|------|-------|---------|');

                for (const e of events) {
                    const time = formatTime(e.ts);
                    switch (e.event) {
                        case 'session_start':
                            md.push(`| ${time} | Session started | |`);
                            break;
                        case 'session_end':
                            md.push(`| ${time} | Session ended | ${formatDuration(e.duration_s)} total |`);
                            break;
                        case 'task_start':
                            md.push(`| ${time} | Task started | ${e.task} |`);
                            break;
                        case 'task_end': {
                            const dur = formatDuration(e.duration_s);
                            const metaParts = Object.entries(e.meta || {})
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(', ');
                            const details = metaParts
                                ? `${e.task} — ${dur} — ${metaParts}`
                                : `${e.task} — ${dur}`;
                            md.push(`| ${time} | Task ended | ${details} |`);
                            break;
                        }
                        default: {
                            const label = e.label || e.event;
                            const metaParts = Object.entries(e.meta || {})
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(', ');
                            const detail = metaParts ? `${label} (${metaParts})` : label;
                            md.push(`| ${time} | ${e.event} | ${detail} |`);
                            break;
                        }
                    }
                }
                md.push('');
            }
        }

        fs.writeFileSync(MD_PATH, md.join('\n'));
    }
}

module.exports = new Logger();
