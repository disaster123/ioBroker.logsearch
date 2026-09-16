import { createReadStream, type Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

import { getActiveLogFileName, getDatedLogFileRegExp } from './logDirectory';
import {
    LOG_LEVELS,
    type FileDiagnostic,
    type LogLevel,
    type LogLocation,
    type LogRow,
    type SearchCursor,
    type SearchError,
    type SearchLogsOptions,
    type SearchResult,
} from './types';

const MAX_ROWS_HARD_LIMIT = 5000;
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

const LOG_LINE_RE =
    /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+-\s+(error|warn|info|debug|silly):\s+([^\s]+)(?:\s+\((\d+)\))?\s+(.*)$/i;

interface FilterContext {
    minTs: number;
    nowTs: number;
    effectiveLevel: LogLevel | 'all';
    searchNeedle: string;
}

interface Diagnostics {
    filesFound: number;
    filesSelected: number;
    filesSkippedName: number;
    filesSkippedTime: number;
    fileStats: FileDiagnostic[];
    unparsedSamples: string[];
}

function stripAnsiCodes(value: string): string {
    return value.replace(ANSI_ESCAPE_RE, '');
}

function createFileDiagnostic(name: string): FileDiagnostic {
    return {
        name,
        lines: 0,
        parsed: 0,
        matched: 0,
        rejectedFormat: 0,
        rejectedTime: 0,
        rejectedLevel: 0,
        rejectedText: 0,
    };
}

/**
 * Parse one ioBroker log line into a structured row.
 *
 * @param line Raw log line.
 * @returns Parsed row or null for unsupported lines.
 */
export function parseLogLine(line: string): Omit<LogRow, 'rowId'> | null {
    const raw = String(line || '').trim();
    if (!raw) {
        return null;
    }
    const rawPlain = stripAnsiCodes(raw);

    const match = rawPlain.match(LOG_LINE_RE);
    if (!match) {
        return null;
    }

    return {
        ts: match[1],
        level: match[2].toLowerCase() as LogLevel,
        source: match[3],
        message: match[5],
        raw,
        rawPlain,
    };
}

/**
 * Parse a rotated log filename and return its local day range in milliseconds.
 *
 * @param name File name, e.g. `iobroker.2026-09-16.log.gz`.
 * @param datedRe Naming pattern of the current log location.
 * @returns Day range metadata or null for non-matching names.
 */
function getFileDayRange(name: string, datedRe: RegExp): { start: number; end: number; dateKey: string } | null {
    const match = name.match(datedRe);
    if (!match) {
        return null;
    }
    const [, y, m, d] = match;
    const start = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0).getTime();
    return { start, end: start + 24 * 60 * 60 * 1000 - 1, dateKey: `${y}-${m}-${d}` };
}

/**
 * Determine the current active, non-gzipped ioBroker log file.
 *
 * @param location Where the log files are and how they are named.
 * @param entries Optional directory entries already read by the caller.
 * @returns Active file name or null when none exists.
 */
export async function getActiveLogFile(location: LogLocation, entries?: Dirent[]): Promise<string | null> {
    const dirEntries = entries || (await readdir(location.directory, { withFileTypes: true }));
    const activeName = getActiveLogFileName(location);
    const current = dirEntries.find(entry => entry.isFile() && entry.name === activeName);
    if (current) {
        return current.name;
    }

    const datedRe = getDatedLogFileRegExp(location);
    const datedFiles: { name: string; dateKey: string }[] = [];
    for (const entry of dirEntries) {
        if (!entry.isFile() || entry.name.endsWith('.gz')) {
            continue;
        }
        const range = getFileDayRange(entry.name, datedRe);
        if (range) {
            datedFiles.push({ name: entry.name, dateKey: range.dateKey });
        }
    }
    datedFiles.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    return datedFiles[0]?.name || null;
}

function createCursor(file: string, stats: { size: number; mtimeMs: number } | null, lineNumber = 0): SearchCursor {
    return {
        file: file || '',
        byteOffset: stats ? stats.size : 0,
        lineNumber,
        size: stats ? stats.size : 0,
        mtimeMs: stats ? stats.mtimeMs : 0,
    };
}

function getRowTime(row: Pick<LogRow, 'ts'>): number {
    return new Date(row.ts.replace(' ', 'T')).getTime();
}

function cursorStartOffset(
    cursor: Partial<SearchCursor> | undefined,
    activeFile: string,
    stats: { size: number },
): number {
    if (!cursor || typeof cursor !== 'object' || cursor.file !== activeFile) {
        return 0;
    }
    const offset = Math.floor(Number(cursor.byteOffset));
    if (!Number.isFinite(offset) || offset < 0 || stats.size < offset) {
        return 0;
    }
    return offset;
}

function cursorLineNumber(cursor: Partial<SearchCursor> | undefined): number {
    const lineNumber = Math.floor(Number(cursor?.lineNumber));
    return Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : 0;
}

function matchesFilters(
    parsed: Omit<LogRow, 'rowId'> | null,
    context: FilterContext,
    fileDiagnostic: FileDiagnostic,
    addUnparsedSample: (line: string) => void,
    originalLine: string,
): parsed is Omit<LogRow, 'rowId'> {
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
    if (context.effectiveLevel !== 'all' && parsed.level !== context.effectiveLevel) {
        fileDiagnostic.rejectedLevel += 1;
        return false;
    }
    if (
        context.searchNeedle &&
        !parsed.rawPlain.toLowerCase().includes(context.searchNeedle) &&
        !parsed.raw.toLowerCase().includes(context.searchNeedle)
    ) {
        fileDiagnostic.rejectedText += 1;
        return false;
    }
    return true;
}

async function streamLogLines(
    filePath: string,
    isGzip: boolean,
    startOffset: number,
    onLine: (line: string) => void | Promise<void>,
    endOffset?: number,
): Promise<void> {
    const hasStartOffset = Number.isFinite(startOffset) && startOffset > 0;
    const hasEndOffset = Number.isFinite(endOffset);
    const streamOptions = isGzip
        ? undefined
        : {
              ...(hasStartOffset || hasEndOffset ? { start: hasStartOffset ? startOffset : 0 } : {}),
              ...(hasEndOffset ? { end: endOffset } : {}),
          };
    const input = createReadStream(
        filePath,
        streamOptions && Object.keys(streamOptions).length ? streamOptions : undefined,
    );
    const stream = isGzip ? input.pipe(createGunzip()) : input;
    const lineReader = createInterface({ input: stream, crlfDelay: Infinity });

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
 * @param options Search options.
 * @returns Search response and active-log cursor metadata.
 */
export async function searchLogs(options: SearchLogsOptions): Promise<SearchResult | SearchError> {
    const startedAt = Date.now();
    const {
        location,
        searchText = '',
        hours = 6,
        level = 'all',
        maxRows = 500,
        activeOnly = false,
        startNow = false,
        since,
        cursor,
        now,
        debugLog,
    } = options;

    const logDirectory = location?.directory;
    if (!logDirectory || typeof logDirectory !== 'string') {
        return { ok: false, error: 'Invalid logDirectory' };
    }
    if (since !== undefined && (!Number.isFinite(since) || since < 0)) {
        return { ok: false, error: 'Invalid since timestamp' };
    }

    const normalizedHours = Math.max(1, Math.floor(Number(hours) || 0));
    const requestedMaxRows = Math.max(1, Math.floor(Number(maxRows) || 0));
    const normalizedMaxRows = Math.min(requestedMaxRows, MAX_ROWS_HARD_LIMIT);
    const effectiveLevel: LogLevel | 'all' = LOG_LEVELS.includes(level as LogLevel) ? level : 'all';
    const effectiveIncludeGzip = !activeOnly;
    const searchNeedle = String(searchText || '').toLowerCase();

    const providedNowTs =
        now === undefined ? Number.NaN : now instanceof Date ? now.getTime() : new Date(now).getTime();
    const nowTs = Number.isNaN(providedNowTs) ? Date.now() : providedNowTs;
    const minTs = Math.max(nowTs - normalizedHours * 60 * 60 * 1000, since === undefined ? -Infinity : since + 1);
    const scanLimit = normalizedMaxRows + 1;

    const datedRe = getDatedLogFileRegExp(location);
    const activeLogName = getActiveLogFileName(location);

    const debug = typeof debugLog === 'function' ? debugLog : null;
    const diagnostics: Diagnostics = {
        filesFound: 0,
        filesSelected: 0,
        filesSkippedName: 0,
        filesSkippedTime: 0,
        fileStats: [],
        unparsedSamples: [],
    };

    const addUnparsedSample = (line: string): void => {
        if (diagnostics.unparsedSamples.length >= 3) {
            return;
        }
        const sampleLine = stripAnsiCodes((line || '').trim());
        if (!sampleLine) {
            return;
        }
        const truncatedLine = sampleLine.length > 300 ? `${sampleLine.slice(0, 300)}...` : sampleLine;
        diagnostics.unparsedSamples.push(`len=${sampleLine.length}, line=${JSON.stringify(truncatedLine)}`);
    };

    const emitDiagnostics = (): void => {
        if (!debug) {
            return;
        }
        debug(
            `Log search start: dir=${logDirectory}, prefix=${location.prefix}, ext=${location.extension}, source=${location.source}, hours=${normalizedHours}, level=${effectiveLevel}, includeGzip=${effectiveIncludeGzip}, activeOnly=${!!activeOnly}, maxRows=${normalizedMaxRows}`,
        );
        debug(
            `Log search files: found=${diagnostics.filesFound}, selected=${diagnostics.filesSelected}, skipped_name=${diagnostics.filesSkippedName}, skipped_time=${diagnostics.filesSkippedTime}`,
        );
        for (const stat of diagnostics.fileStats) {
            debug(
                `Log search file: name=${stat.name}, lines=${stat.lines}, parsed=${stat.parsed}, matched=${stat.matched}, rejected_format=${stat.rejectedFormat}, rejected_time=${stat.rejectedTime}, rejected_level=${stat.rejectedLevel}, rejected_text=${stat.rejectedText}`,
            );
        }
        for (const sample of diagnostics.unparsedSamples) {
            debug(`Log search sample unparsed: ${sample}`);
        }
    };

    const emitDoneDiagnostics = (
        returned: number,
        matched: number,
        doneTruncated: boolean,
        stopReason: string,
    ): void => {
        if (!debug) {
            return;
        }
        const durationMs = Math.max(0, Date.now() - startedAt);
        const filesRead = diagnostics.fileStats.length;
        const linesRead = diagnostics.fileStats.reduce((sum, fileStat) => sum + fileStat.lines, 0);
        debug(
            `Log search done: duration_ms=${durationMs}, files_read=${filesRead}, lines_read=${linesRead}, returned=${returned}, matched=${matched}, truncated=${doneTruncated}, stop_reason=${stopReason}`,
        );
    };

    let files: Dirent[];
    try {
        files = await readdir(logDirectory, { withFileTypes: true });
    } catch (error: any) {
        return { ok: false, error: `Cannot read log directory: ${error.message}` };
    }

    const activeFile = await getActiveLogFile(location, files);
    if (startNow) {
        // Establish the boundary on the server without reading historical log contents.
        // An empty cursor keeps polling alive when the first log file does not exist yet.
        const stats = activeFile ? await stat(join(logDirectory, activeFile)) : null;
        return {
            ok: true,
            rows: [],
            total: 0,
            truncated: false,
            cursor: createCursor(activeFile || '', stats),
            since: nowTs,
        };
    }
    let responseCursor: SearchCursor | null = since === undefined ? null : createCursor('', null);

    const context: FilterContext = { minTs, nowTs, effectiveLevel, searchNeedle };
    const rows: LogRow[] = [];
    let truncated = false;
    let stopReason = 'eof';

    const pushMatchedRow = (row: LogRow): void => {
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
            return { ok: true, rows: [], total: 0, truncated: false, cursor: responseCursor };
        }

        const fullPath = join(logDirectory, activeFile);
        let snapshotStats;
        try {
            snapshotStats = await stat(fullPath);
        } catch {
            emitDiagnostics();
            return { ok: true, rows: [], total: 0, truncated: false, cursor: null };
        }

        const snapshotSize = snapshotStats.size;
        const startOffset = cursorStartOffset(cursor, activeFile, snapshotStats);
        const initialLineNumber = startOffset > 0 ? cursorLineNumber(cursor) : 0;
        if (debug) {
            debug(
                `Log search active cursor: start_offset=${startOffset}, snapshot_size=${snapshotSize}, cursor_offset=${Number(cursor?.byteOffset) || 0}`,
            );
        }
        if (startOffset >= snapshotSize) {
            emitDiagnostics();
            return {
                ok: true,
                rows: [],
                total: 0,
                truncated: false,
                cursor: createCursor(activeFile, snapshotStats, initialLineNumber),
            };
        }
        let lineNumber = initialLineNumber;
        const fileDiagnostic = createFileDiagnostic(activeFile);
        diagnostics.filesFound = files.filter(entry => entry.isFile()).length;
        diagnostics.filesSelected = 1;

        try {
            await streamLogLines(
                fullPath,
                false,
                startOffset,
                line => {
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
                },
                snapshotSize - 1,
            );
        } catch {
            // Ignore unreadable active files so a concurrent rotation does not fail the poll.
        }
        diagnostics.fileStats.push(fileDiagnostic);

        responseCursor = createCursor(activeFile, snapshotStats, lineNumber);
    } else {
        const currentFile: string[] = [];
        const datedFiles: { name: string; dateKey: string }[] = [];

        for (const entry of files) {
            if (!entry.isFile()) {
                continue;
            }
            diagnostics.filesFound += 1;
            if (entry.name === activeLogName) {
                currentFile.push(entry.name);
                continue;
            }

            const range = getFileDayRange(entry.name, datedRe);
            if (!range) {
                diagnostics.filesSkippedName += 1;
                continue;
            }
            if (!effectiveIncludeGzip && entry.name.endsWith('.gz')) {
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
        let activeSnapshotStats: { size: number; mtimeMs: number } | null = null;
        if (activeFile) {
            try {
                activeSnapshotStats = await stat(join(logDirectory, activeFile));
            } catch {
                activeSnapshotStats = null;
            }
        }

        for (const name of candidates) {
            const fullPath = join(logDirectory, name);
            const fileDiagnostic = createFileDiagnostic(name);
            const isGzip = name.endsWith('.gz');
            const snapshotEndOffset =
                !isGzip && name === activeFile && activeSnapshotStats ? activeSnapshotStats.size - 1 : undefined;
            try {
                await streamLogLines(
                    fullPath,
                    isGzip,
                    0,
                    line => {
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
                    },
                    snapshotEndOffset,
                );
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
                stopReason = 'max_rows';
                break;
            }
        }

        if (activeFile && activeSnapshotStats) {
            const activePath = join(logDirectory, activeFile);
            try {
                if (!activeFileWasRead) {
                    await streamLogLines(
                        activePath,
                        false,
                        0,
                        () => {
                            activeFileLineNumber += 1;
                        },
                        activeSnapshotStats.size - 1,
                    );
                }
                responseCursor = createCursor(activeFile, activeSnapshotStats, activeFileLineNumber);
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
