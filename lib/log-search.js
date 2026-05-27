"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const gunzip = promisify(zlib.gunzip);

const LOG_LEVELS = ["error", "warn", "info", "debug", "silly"];
const MAX_ROWS_HARD_LIMIT = 5000;
const DATED_LOG_RE = /^iobroker\.(\d{4})-(\d{2})-(\d{2})\.log(\.gz)?$/;

/**
 * @typedef {object} SearchLogsOptions
 * @property {string} logDirectory
 * @property {string} [searchText]
 * @property {number} [hours]
 * @property {"all"|"error"|"warn"|"info"|"debug"|"silly"} [level]
 * @property {number} [maxRows]
 * @property {boolean} [includeGzip]
 */

function parseLogLine(line) {
    const trimmed = line.trimEnd();
    if (!trimmed) {
        return null;
    }

    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+-\s+(\w+):\s+([^\s]+)\s+(.*)$/);
    if (!match) {
        return null;
    }

    const [, ts, level, source, message] = match;
    return { ts, level: level.toLowerCase(), source, message, raw: trimmed };
}

function getFileDayRange(name) {
    const match = name.match(DATED_LOG_RE);
    if (!match) {
        return null;
    }
    const [, y, m, d] = match;
    const start = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0).getTime();
    const end = start + 24 * 60 * 60 * 1000 - 1;
    return { start, end, dateKey: `${y}-${m}-${d}` };
}

async function searchLogs(options) {
    const {
        logDirectory,
        searchText = "",
        hours = 6,
        level = "all",
        maxRows = 500,
        includeGzip = true,
    } = options || {};

    if (!logDirectory || typeof logDirectory !== "string") {
        return { ok: false, error: "Invalid logDirectory" };
    }

    const normalizedHours = Math.max(1, Math.floor(Number(hours) || 0));
    const requestedMaxRows = Math.max(1, Math.floor(Number(maxRows) || 0));
    const normalizedMaxRows = Math.min(requestedMaxRows, MAX_ROWS_HARD_LIMIT);
    const effectiveLevel = LOG_LEVELS.includes(level) ? level : "all";
    const searchNeedle = String(searchText || "").toLowerCase();

    const nowTs = Date.now();
    const minTs = nowTs - normalizedHours * 60 * 60 * 1000;
    const scanLimit = normalizedMaxRows + 1;

    let files;
    try {
        files = await fs.readdir(logDirectory, { withFileTypes: true });
    } catch (error) {
        return { ok: false, error: `Cannot read log directory: ${error.message}` };
    }

    const currentFile = [];
    const datedFiles = [];

    for (const entry of files) {
        if (!entry.isFile()) {
            continue;
        }
        if (entry.name === "iobroker.current.log") {
            currentFile.push(entry.name);
            continue;
        }

        const range = getFileDayRange(entry.name);
        if (!range) {
            continue;
        }
        if (!includeGzip && entry.name.endsWith(".gz")) {
            continue;
        }
        const overlapsWindow = range.end >= minTs && range.start <= nowTs;
        if (!overlapsWindow) {
            continue;
        }

        datedFiles.push({ name: entry.name, dateKey: range.dateKey });
    }

    datedFiles.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    const candidates = currentFile.concat(datedFiles.map(file => file.name));

    const rows = [];
    for (const name of candidates) {
        if (rows.length >= scanLimit) {
            break;
        }

        const fullPath = path.join(logDirectory, name);
        let content;
        try {
            const buffer = await fs.readFile(fullPath);
            content = name.endsWith(".gz") ? (await gunzip(buffer)).toString("utf8") : buffer.toString("utf8");
        } catch {
            continue;
        }

        const lines = content.split(/\r?\n/);
        for (let i = lines.length - 1; i >= 0; i--) {
            if (rows.length >= scanLimit) {
                break;
            }
            const parsed = parseLogLine(lines[i]);
            if (!parsed || !LOG_LEVELS.includes(parsed.level)) {
                continue;
            }

            const tsDate = new Date(parsed.ts.replace(" ", "T"));
            const tsMillis = tsDate.getTime();
            if (Number.isNaN(tsMillis) || tsMillis < minTs || tsMillis > nowTs) {
                continue;
            }
            if (effectiveLevel !== "all" && parsed.level !== effectiveLevel) {
                continue;
            }
            if (searchNeedle && !parsed.raw.toLowerCase().includes(searchNeedle)) {
                continue;
            }

            rows.push(parsed);
        }
    }

    rows.sort((a, b) => new Date(b.ts.replace(" ", "T")).getTime() - new Date(a.ts.replace(" ", "T")).getTime());

    const truncated = rows.length > normalizedMaxRows;
    const limitedRows = rows.slice(0, normalizedMaxRows);

    return {
        ok: true,
        rows: limitedRows,
        total: limitedRows.length,
        truncated,
    };
}

module.exports = {
    parseLogLine,
    searchLogs,
};
