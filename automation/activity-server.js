#!/usr/bin/env node
/**
 * activity-server.js — Lightweight HTTP API for activity logs and prompt history
 *
 * Endpoints:
 *   GET /api/activity              — All activity events
 *   GET /api/activity/sessions     — Sessions grouped with durations
 *   GET /api/activity/current      — Active session + running tasks
 *   GET /api/status                — Summary: total time, tasks, errors
 *   GET /api/prompts               — Full prompt history
 *   GET /api/prompts/:chapter      — Prompt history by chapter
 *   GET /api/prompts/:chapter/:id  — Version history for one image
 *
 * Usage:
 *   node automation/activity-server.js [port]   # default: 3001
 *   const { startServer } = require('./automation/activity-server');
 *   startServer(3001);
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const ACTIVITY_JSONL = path.join(LOGS_DIR, 'activity.jsonl');
const PROMPTS_JSONL = path.join(LOGS_DIR, 'prompt-history.jsonl');
const DEFAULT_PORT = 3001;

// ── Parsers ─────────────────────────────────────────────────────────

function parseJSONL(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    const entries = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch { /* skip corrupt */ }
    }
    return entries;
}

// ── Activity Helpers ────────────────────────────────────────────────

function getSessionsGrouped(entries) {
    const sessions = {};
    for (const e of entries) {
        const sid = e.sessionId || 'unknown';
        if (!sessions[sid]) sessions[sid] = { events: [], startTs: null, endTs: null, durationS: null };
        const s = sessions[sid];
        s.events.push(e);
        if (e.event === 'session_start') s.startTs = e.ts;
        if (e.event === 'session_end') { s.endTs = e.ts; s.durationS = e.duration_s; }
    }
    return sessions;
}

function getCurrentSession(entries) {
    let currentSid = null;
    for (const e of entries) {
        if (e.event === 'session_start') currentSid = e.sessionId;
        if (e.event === 'session_end' && e.sessionId === currentSid) currentSid = null;
    }
    if (!currentSid) return { active: false };

    const sessionEvents = entries.filter(e => e.sessionId === currentSid);
    const startedTasks = sessionEvents.filter(e => e.event === 'task_start');
    const endedTaskIds = new Set(sessionEvents.filter(e => e.event === 'task_end').map(e => e.taskId));
    const runningTasks = startedTasks.filter(t => !endedTaskIds.has(t.taskId));
    const completedTasks = startedTasks.filter(t => endedTaskIds.has(t.taskId));

    return {
        active: true,
        sessionId: currentSid,
        startedAt: sessionEvents[0]?.ts,
        runningTasks: runningTasks.map(t => ({ task: t.task, taskId: t.taskId, startedAt: t.ts })),
        completedTasks: completedTasks.length,
        totalEvents: sessionEvents.length
    };
}

function getStatus(entries) {
    const sessionIds = new Set(entries.map(e => e.sessionId));
    const sessionEnds = entries.filter(e => e.event === 'session_end');
    const totalTimeS = sessionEnds.reduce((sum, e) => sum + (e.duration_s || 0), 0);
    const taskEnds = entries.filter(e => e.event === 'task_end');
    const errors = entries.filter(e => e.event === 'error' || (e.meta && e.meta.error));

    const h = Math.floor(totalTimeS / 3600);
    const m = Math.floor((totalTimeS % 3600) / 60);
    const s = totalTimeS % 60;
    const formatted = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;

    return {
        totalSessions: sessionIds.size,
        totalTimeS,
        totalTimeFormatted: formatted,
        completedTasks: taskEnds.length,
        errors: errors.length,
        lastEvent: entries.length > 0 ? entries[entries.length - 1] : null
    };
}

// ── Route Handler ───────────────────────────────────────────────────

function handleRequest(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    const parts = pathname.split('/').filter(Boolean);

    // Activity endpoints
    if (parts[0] === 'api' && parts[1] === 'activity') {
        const entries = parseJSONL(ACTIVITY_JSONL);

        if (!parts[2]) {
            return json(res, entries);
        }
        if (parts[2] === 'sessions') {
            return json(res, getSessionsGrouped(entries));
        }
        if (parts[2] === 'current') {
            return json(res, getCurrentSession(entries));
        }
    }

    // Status
    if (parts[0] === 'api' && parts[1] === 'status') {
        const entries = parseJSONL(ACTIVITY_JSONL);
        return json(res, getStatus(entries));
    }

    // Prompt history endpoints
    if (parts[0] === 'api' && parts[1] === 'prompts') {
        let entries = parseJSONL(PROMPTS_JSONL);

        if (parts[2]) {
            entries = entries.filter(e => e.chapter === parts[2]);
        }
        if (parts[3]) {
            entries = entries.filter(e => e.sectionId === parts[3]);
        }

        return json(res, entries);
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found', routes: [
        '/api/activity', '/api/activity/sessions', '/api/activity/current',
        '/api/status', '/api/prompts', '/api/prompts/:chapter', '/api/prompts/:chapter/:sectionId'
    ]}));
}

function json(res, data) {
    res.writeHead(200);
    res.end(JSON.stringify(data, null, 2));
}

// ── Server ──────────────────────────────────────────────────────────

function startServer(port) {
    const p = port || DEFAULT_PORT;
    const server = http.createServer(handleRequest);
    server.listen(p, () => {
        console.log(`\n📊 Activity API listening on http://localhost:${p}`);
        console.log(`   Routes: /api/status, /api/activity, /api/activity/current, /api/prompts`);
    });
    return server;
}

if (require.main === module) {
    const port = parseInt(process.argv[2]) || DEFAULT_PORT;
    startServer(port);
}

module.exports = { startServer };
