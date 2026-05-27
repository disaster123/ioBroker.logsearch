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
 * @property {Date|number|string} [now] Internal reference time for deterministic tests
 * @property {(message: string) => void} [debugLog] Optional compact debug logger
 */

/**
 * Parse one ioBroker log line into a structured row.
 * @param {string} line Raw log line.
 * @returns {{ts: string, level: string, source: string, message: string, raw: string} | null} Parsed row or null for unsupported lines.
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

/**
 * Parse a dated log filename and return its local day range in milliseconds.
 * @param {string} name File name like iobroker.YYYY-MM-DD.log(.gz).
 * @returns {{start: number, end: number, dateKey: string} | null} Day range metadata or null for non-matching names.
 */
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

/**
 * Search ioBroker log files with time/level/text filters.
 *
 * Result notes:
 * - `total` is the number of returned rows in this response.
 * - `truncated` indicates that more matching rows exist than were returned.
 *
 * @param {SearchLogsOptions} options Search options.
 * @returns {Promise<{ok: true, rows: Array<{ts: string, level: string, source: string, message: string, raw: string}>, total: number, truncated: boolean} | {ok: false, error: string}>}
 */
async function searchLogs(options) {
    const {
        logDirectory,
        searchText = "",
        hours = 6,
        level = "all",
        maxRows = 500,
        includeGzip = true,
        now,
        debugLog,
    } = options || {};

    if (!logDirectory || typeof logDirectory !== "string") {
        return { ok: false, error: "Invalid logDirectory" };
    }

    const normalizedHours = Math.max(1, Math.floor(Number(hours) || 0));
    const requestedMaxRows = Math.max(1, Math.floor(Number(maxRows) || 0));
    const normalizedMaxRows = Math.min(requestedMaxRows, MAX_ROWS_HARD_LIMIT);
    const effectiveLevel = LOG_LEVELS.includes(level) ? level : "all";
    const searchNeedle = String(searchText || "").toLowerCase();

    const providedNowTs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const nowTs = Number.isNaN(providedNowTs) ? Date.now() : providedNowTs;
    const minTs = nowTs - normalizedHours * 60 * 60 * 1000;
    const scanLimit = normalizedMaxRows + 1;

    const debug = typeof debugLog === "function" ? debugLog : null;
    const diagnostics = {
        filesFound: 0,
        filesSelected: 0,
        filesSkippedName: 0,
        filesSkippedTime: 0,
        fileStats: [],
        unparsedSamples: [],
    };

    const addUnparsedSample = (line) => {
        if (diagnostics.unparsedSamples.length >= 3) {
            return;
        }
        const normalizedLine = String(line || "").trim();
        const truncatedLine = normalizedLine.length > 300 ? `${normalizedLine.slice(0, 300)}...` : normalizedLine;
        diagnostics.unparsedSamples.push(truncatedLine);
    };

    const emitDiagnostics = () => {
        if (!debug) {
            return;
        }
        debug(`Log search start: dir=${logDirectory}, hours=${normalizedHours}, level=${effectiveLevel}, includeGzip=${includeGzip}, maxRows=${normalizedMaxRows}`);
        debug(`Log search files: found=${diagnostics.filesFound}, selected=${diagnostics.filesSelected}, skipped_name=${diagnostics.filesSkippedName}, skipped_time=${diagnostics.filesSkippedTime}`);
        for (const stat of diagnostics.fileStats) {
            debug(`Log search file: name=${stat.name}, lines=${stat.lines}, parsed=${stat.parsed}, matched=${stat.matched}, rejected_format=${stat.rejectedFormat}, rejected_time=${stat.rejectedTime}, rejected_level=${stat.rejectedLevel}, rejected_text=${stat.rejectedText}`);
        }
        for (const sample of diagnostics.unparsedSamples) {
            debug(`Log search sample unparsed: ${sample}`);
        }
    };


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
        diagnostics.filesFound += 1;
        if (entry.name === "iobroker.current.log") {
            currentFile.push(entry.name);
            continue;
        }

        const range = getFileDayRange(entry.name);
        if (!range) {
            diagnostics.filesSkippedName += 1;
            continue;
        }
        if (!includeGzip && entry.name.endsWith(".gz")) {
            continue;
        }
        const overlapsWindow = range.end >= minTs && range.start <= nowTs;
        if (!overlapsWindow) {
            diagnostics.filesSkippedTime += 1;
            continue;
        }

        datedFiles.push({ name: entry.name, dateKey: range.dateKey });
    }

    datedFiles.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    const candidates = currentFile.concat(datedFiles.map(file => file.name));
    diagnostics.filesSelected = candidates.length;

    const rows = [];
    for (const name of candidates) {
        if (rows.length >= scanLimit) {
            break;
        }

        const fullPath = path.join(logDirectory, name);
        const fileDiagnostic = {
            name,
            lines: 0,
            parsed: 0,
            matched: 0,
            rejectedFormat: 0,
            rejectedTime: 0,
            rejectedLevel: 0,
            rejectedText: 0,
        };
        let content;
        try {
            const buffer = await fs.readFile(fullPath);
            content = name.endsWith(".gz") ? (await gunzip(buffer)).toString("utf8") : buffer.toString("utf8");
        } catch {
            diagnostics.fileStats.push(fileDiagnostic);
            continue;
        }

        const lines = content.split(/\r?\n/);
        fileDiagnostic.lines = lines.length;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (rows.length >= scanLimit) {
                break;
            }
            const parsed = parseLogLine(lines[i]);
            if (!parsed || !LOG_LEVELS.includes(parsed.level)) {
                fileDiagnostic.rejectedFormat += 1;
                addUnparsedSample(lines[i]);
                continue;
            }
            fileDiagnostic.parsed += 1;

            const tsDate = new Date(parsed.ts.replace(" ", "T"));
            const tsMillis = tsDate.getTime();
            if (Number.isNaN(tsMillis) || tsMillis < minTs || tsMillis > nowTs) {
                fileDiagnostic.rejectedTime += 1;
                continue;
            }
            if (effectiveLevel !== "all" && parsed.level !== effectiveLevel) {
                fileDiagnostic.rejectedLevel += 1;
                continue;
            }
            if (searchNeedle && !parsed.raw.toLowerCase().includes(searchNeedle)) {
                fileDiagnostic.rejectedText += 1;
                continue;
            }

            fileDiagnostic.matched += 1;
            rows.push(parsed);
        }
        diagnostics.fileStats.push(fileDiagnostic);
    }

    rows.sort((a, b) => new Date(b.ts.replace(" ", "T")).getTime() - new Date(a.ts.replace(" ", "T")).getTime());

    const truncated = rows.length > normalizedMaxRows;
    const limitedRows = rows.slice(0, normalizedMaxRows);

    emitDiagnostics();
    if (debug) {
        debug(`Log search done: returned=${limitedRows.length}, matched=${rows.length}, truncated=${truncated}`);
    }

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
