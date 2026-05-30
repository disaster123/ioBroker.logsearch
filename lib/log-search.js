"use strict";

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const zlib = require("node:zlib");

const LOG_LEVELS = ["error", "warn", "info", "debug", "silly"];
const MAX_ROWS_HARD_LIMIT = 5000;
const DATED_LOG_RE = /^iobroker\.(\d{4})-(\d{2})-(\d{2})\.log(\.gz)?$/;
const PLAIN_DATED_LOG_RE = /^iobroker\.(\d{4})-(\d{2})-(\d{2})\.log$/;
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

function stripAnsiCodes(value) {
    return String(value || "").replace(ANSI_ESCAPE_RE, "");
}

/**
 * @typedef {{ts: string, level: string, source: string, message: string, raw: string, rawPlain: string, rowId?: string}} LogRow
 */

/**
 * @typedef {{name: string, lines: number, parsed: number, matched: number, rejectedFormat: number, rejectedTime: number, rejectedLevel: number, rejectedText: number}} FileDiagnostic
 */

/**
 * @typedef {{ok: boolean, rows: LogRow[], total: number, truncated: boolean, cursor: SearchCursor | null, error?: string}} SearchResult
 */

/**
 * @typedef {object} SearchCursor
 * @property {string} file
 * @property {number} byteOffset
 * @property {number} lineNumber
 * @property {number} size
 * @property {number} mtimeMs
 */

/**
 * @typedef {object} SearchLogsOptions
 * @property {string} logDirectory
 * @property {string} [searchText]
 * @property {number} [hours]
 * @property {"all"|"error"|"warn"|"info"|"debug"|"silly"} [level]
 * @property {number} [maxRows]
 * @property {boolean} [includeGzip]
 * @property {boolean} [activeOnly]
 * @property {Partial<SearchCursor>} [cursor]
 * @property {Date|number|string} [now] Internal reference time for deterministic tests
 * @property {(message: string) => void} [debugLog] Optional compact debug logger
 */

/**
 * Parse one ioBroker log line into a structured row.
 * @param {string} line Raw log line.
 * @returns {{ts: string, level: string, source: string, message: string, raw: string, rawPlain: string} | null} Parsed row or null for unsupported lines.
 */
function parseLogLine(line) {
    const raw = String(line || "").trim();
    if (!raw) {
        return null;
    }
    const rawPlain = stripAnsiCodes(raw);

    const match = rawPlain.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+-\s+(error|warn|info|debug|silly):\s+([^\s]+)(?:\s+\((\d+)\))?\s+(.*)$/i);
    if (!match) {
        return null;
    }

    const ts = match[1];
    const level = match[2];
    const source = match[3];
    const message = match[5];
    return { ts, level: level.toLowerCase(), source, message, raw, rawPlain };
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
 * Determine the current active non-gzip ioBroker log file.
 * @param {string} logDirectory Directory containing ioBroker logs.
 * @param {import("node:fs").Dirent[]} [entries] Optional directory entries already read by the caller.
 * @returns {Promise<string | null>} Active file name or null when none exists.
 */
async function getActiveLogFile(logDirectory, entries) {
    const dirEntries = entries || await fs.readdir(logDirectory, { withFileTypes: true });
    const current = dirEntries.find(entry => entry.isFile() && entry.name === "iobroker.current.log");
    if (current) {
        return current.name;
    }

    const datedFiles = [];
    for (const entry of dirEntries) {
        if (!entry.isFile()) {
            continue;
        }
        const match = entry.name.match(PLAIN_DATED_LOG_RE);
        if (match) {
            datedFiles.push({ name: entry.name, dateKey: `${match[1]}-${match[2]}-${match[3]}` });
        }
    }
    datedFiles.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    return datedFiles[0]?.name || null;
}

function createCursor(file, stats, lineNumber = 0) {
    return {
        file: file || "",
        byteOffset: stats ? stats.size : 0,
        lineNumber,
        size: stats ? stats.size : 0,
        mtimeMs: stats ? stats.mtimeMs : 0,
    };
}

function getRowTime(row) {
    return new Date(row.ts.replace(" ", "T")).getTime();
}

function cursorStartOffset(cursor, activeFile, stats) {
    if (!cursor || typeof cursor !== "object" || cursor.file !== activeFile) {
        return 0;
    }
    const offset = Math.floor(Number(cursor.byteOffset));
    if (!Number.isFinite(offset) || offset < 0 || stats.size < offset) {
        return 0;
    }
    return offset;
}

function cursorLineNumber(cursor) {
    const lineNumber = Math.floor(Number(cursor?.lineNumber));
    return Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : 0;
}

function matchesFilters(parsed, context, fileDiagnostic, addUnparsedSample, originalLine) {
    if (!parsed || !LOG_LEVELS.includes(parsed.level)) {
        fileDiagnostic.rejectedFormat += 1;
        addUnparsedSample(originalLine);
        return false;
    }
    fileDiagnostic.parsed += 1;

    const tsMillis = getRowTime(parsed);
    if (Number.isNaN(tsMillis) || tsMillis < context.minTs || tsMillis > context.nowTs) {
        fileDiagnostic.rejectedTime += 1;
        return false;
    }
    if (context.effectiveLevel !== "all" && parsed.level !== context.effectiveLevel) {
        fileDiagnostic.rejectedLevel += 1;
        return false;
    }
    if (context.searchNeedle && !parsed.rawPlain.toLowerCase().includes(context.searchNeedle) && !parsed.raw.toLowerCase().includes(context.searchNeedle)) {
        fileDiagnostic.rejectedText += 1;
        return false;
    }
    return true;
}

async function streamLogLines(filePath, isGzip, startOffset, onLine) {
    const input = fsSync.createReadStream(filePath, isGzip || !startOffset ? undefined : { start: startOffset });
    const stream = isGzip ? input.pipe(zlib.createGunzip()) : input;
    const lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
        for await (const line of lineReader) {
            await onLine(line);
        }
    } finally {
        lineReader.close();
        input.destroy();
        if (isGzip) {
            stream.destroy();
        }
    }
}

/**
 * Search ioBroker log files with time/level/text filters.
 *
 * Result notes:
 * - `total` is the number of returned rows in this response.
 * - `truncated` indicates that more matching rows exist than were returned.
 *
 * @param {SearchLogsOptions} options Search options.
 * @returns {Promise<any>}
 */
async function searchLogs(options) {
    const startedAt = Date.now();
    const {
        logDirectory,
        searchText = "",
        hours = 6,
        level = "all",
        maxRows = 500,
        activeOnly = false,
        cursor,
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
    const effectiveIncludeGzip = !activeOnly;
    const searchNeedle = String(searchText || "").toLowerCase();

    const providedNowTs = now === undefined ? Number.NaN : (now instanceof Date ? now.getTime() : new Date(now).getTime());
    const nowTs = Number.isNaN(providedNowTs) ? Date.now() : providedNowTs;
    const minTs = nowTs - normalizedHours * 60 * 60 * 1000;
    const scanLimit = normalizedMaxRows + 1;

    const debug = typeof debugLog === "function" ? debugLog : null;
    /** @type {{filesFound: number, filesSelected: number, filesSkippedName: number, filesSkippedTime: number, fileStats: FileDiagnostic[], unparsedSamples: string[]}} */
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
        const sampleLine = stripAnsiCodes(String(line || "").trim());
        if (!sampleLine) {
            return;
        }
        const truncatedLine = sampleLine.length > 300 ? `${sampleLine.slice(0, 300)}...` : sampleLine;
        diagnostics.unparsedSamples.push(`len=${sampleLine.length}, line=${JSON.stringify(truncatedLine)}`);
    };

    const emitDiagnostics = () => {
        if (!debug) {
            return;
        }
        debug(`Log search start: dir=${logDirectory}, hours=${normalizedHours}, level=${effectiveLevel}, includeGzip=${effectiveIncludeGzip}, activeOnly=${!!activeOnly}, maxRows=${normalizedMaxRows}`);
        debug(`Log search files: found=${diagnostics.filesFound}, selected=${diagnostics.filesSelected}, skipped_name=${diagnostics.filesSkippedName}, skipped_time=${diagnostics.filesSkippedTime}`);
        for (const stat of diagnostics.fileStats) {
            debug(`Log search file: name=${stat.name}, lines=${stat.lines}, parsed=${stat.parsed}, matched=${stat.matched}, rejected_format=${stat.rejectedFormat}, rejected_time=${stat.rejectedTime}, rejected_level=${stat.rejectedLevel}, rejected_text=${stat.rejectedText}`);
        }
        for (const sample of diagnostics.unparsedSamples) {
            debug(`Log search sample unparsed: ${sample}`);
        }
    };

    const emitDoneDiagnostics = (returned, matched, doneTruncated, stopReason) => {
        if (!debug) {
            return;
        }
        const durationMs = Math.max(0, Date.now() - startedAt);
        const filesRead = diagnostics.fileStats.length;
        const linesRead = diagnostics.fileStats.reduce((sum, stat) => sum + stat.lines, 0);
        debug(`Log search done: duration_ms=${durationMs}, files_read=${filesRead}, lines_read=${linesRead}, returned=${returned}, matched=${matched}, truncated=${doneTruncated}, stop_reason=${stopReason}`);
    };

    let files;
    try {
        files = await fs.readdir(logDirectory, { withFileTypes: true });
    } catch (error) {
        return { ok: false, error: `Cannot read log directory: ${error.message}` };
    }

    const activeFile = await getActiveLogFile(logDirectory, files);
    /** @type {SearchCursor | null} */
    let responseCursor = null;

    const context = { minTs, nowTs, effectiveLevel, searchNeedle };
    /** @type {LogRow[]} */
    const rows = [];
    let truncated = false;
    let stopReason = "eof";

    const pushMatchedRow = (row) => {
        rows.push(row);
        if (rows.length > scanLimit) {
            rows.sort((a, b) => getRowTime(b) - getRowTime(a));
            rows.length = scanLimit;
            truncated = true;
        }
    };

    if (activeOnly) {
        if (!activeFile) {
            emitDiagnostics();
            return { ok: true, rows: [], total: 0, truncated: false, cursor: null };
        }

        const fullPath = path.join(logDirectory, activeFile);
        let stats;
        try {
            stats = await fs.stat(fullPath);
        } catch {
            emitDiagnostics();
            return { ok: true, rows: [], total: 0, truncated: false, cursor: null };
        }

        const startOffset = cursorStartOffset(cursor, activeFile, stats);
        const initialLineNumber = startOffset > 0 ? cursorLineNumber(cursor) : 0;
        if (startOffset >= stats.size) {
            emitDiagnostics();
            return { ok: true, rows: [], total: 0, truncated: false, cursor: createCursor(activeFile, stats, initialLineNumber) };
        }
        let lineNumber = initialLineNumber;
        const fileDiagnostic = {
            name: activeFile,
            lines: 0,
            parsed: 0,
            matched: 0,
            rejectedFormat: 0,
            rejectedTime: 0,
            rejectedLevel: 0,
            rejectedText: 0,
        };
        diagnostics.filesFound = files.filter(entry => entry.isFile()).length;
        diagnostics.filesSelected = 1;

        try {
            await streamLogLines(fullPath, false, startOffset, (line) => {
                fileDiagnostic.lines += 1;
                lineNumber += 1;
                if (!line.trim()) {
                    return;
                }
                const parsed = parseLogLine(line);
                if (!matchesFilters(parsed, context, fileDiagnostic, addUnparsedSample, line)) {
                    return;
                }
                fileDiagnostic.matched += 1;
                pushMatchedRow({ ...parsed, rowId: `${activeFile}:${lineNumber}` });
            });
        } catch {
            // Ignore unreadable active files so a concurrent rotation does not fail the poll.
        }
        diagnostics.fileStats.push(fileDiagnostic);

        let endStats = stats;
        try {
            endStats = await fs.stat(fullPath);
        } catch {
            // Keep the pre-read stats if the file vanished during rotation.
        }
        responseCursor = createCursor(activeFile, endStats, lineNumber);
    } else {
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
            if (!effectiveIncludeGzip && entry.name.endsWith(".gz")) {
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

        let activeFileLineNumber = 0;
        let activeFileWasRead = false;

        for (const name of candidates) {
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
            try {
                await streamLogLines(fullPath, name.endsWith(".gz"), 0, (line) => {
                    fileDiagnostic.lines += 1;
                    if (!line.trim()) {
                        return;
                    }
                    const parsed = parseLogLine(line);
                    if (!matchesFilters(parsed, context, fileDiagnostic, addUnparsedSample, line)) {
                        return;
                    }
                    fileDiagnostic.matched += 1;
                    pushMatchedRow({ ...parsed, rowId: `${name}:${fileDiagnostic.lines}` });
                });
            } catch {
                // Continue with other files if a log file is rotated or unreadable while searching.
            }
            diagnostics.fileStats.push(fileDiagnostic);
            if (name === activeFile) {
                activeFileLineNumber = fileDiagnostic.lines;
                activeFileWasRead = true;
            }
            if (rows.length >= scanLimit) {
                truncated = true;
                stopReason = "max_rows";
                break;
            }
        }

        if (activeFile) {
            const activePath = path.join(logDirectory, activeFile);
            try {
                if (!activeFileWasRead) {
                    await streamLogLines(activePath, false, 0, () => {
                        activeFileLineNumber += 1;
                    });
                }
                const stats = await fs.stat(activePath);
                responseCursor = createCursor(activeFile, stats, activeFileLineNumber);
            } catch {
                responseCursor = null;
            }
        }
    }

    rows.sort((a, b) => getRowTime(b) - getRowTime(a));

    if (rows.length > normalizedMaxRows) {
        truncated = true;
    }
    const limitedRows = rows.slice(0, normalizedMaxRows);

    emitDiagnostics();
    emitDoneDiagnostics(limitedRows.length, rows.length, truncated, stopReason);

    return {
        ok: true,
        rows: limitedRows,
        total: limitedRows.length,
        truncated,
        cursor: responseCursor,
    };
}

module.exports = {
    getActiveLogFile,
    parseLogLine,
    searchLogs,
};
