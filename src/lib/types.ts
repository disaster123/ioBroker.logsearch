/** Log levels used by ioBroker, ordered from the most to the least severe. */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'silly'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type LevelFilter = LogLevel | 'all';

/** One parsed log line. */
export interface LogRow {
    /** Local timestamp as written into the log file, e.g. `2026-09-16 10:11:12.123`. */
    ts: string;
    level: LogLevel;
    /** Adapter instance or host that produced the line. */
    source: string;
    message: string;
    /** Original line, ANSI escape sequences included. */
    raw: string;
    /** Original line without ANSI escape sequences. */
    rawPlain: string;
    /** `<file>:<lineNumber>`, stable for as long as the file is not rotated. */
    rowId?: string;
}

/** Read position inside the active (non-rotated) log file. */
export interface SearchCursor {
    /** Active log file name. */
    file: string;
    /** Next byte offset to read. */
    byteOffset: number;
    /** Last processed physical line number. */
    lineNumber: number;
    /** File size at the time the cursor was created. */
    size: number;
    /** File modification time at the time the cursor was created. */
    mtimeMs: number;
}

/** Where the ioBroker log files are and how they are named. */
export interface LogLocation {
    /** Absolute path of the directory that contains the log files. */
    directory: string;
    /** File name prefix without the date, e.g. `iobroker`. */
    prefix: string;
    /** File extension of the rotated files, e.g. `.log` (may be empty). */
    extension: string;
    /** How the location was determined. */
    source: 'manual' | 'controller-config' | 'probe' | 'fallback';
}

export interface SearchLogsOptions {
    /** Where the log files are and how they are named. */
    location: LogLocation;
    /** Case-insensitive text filter. */
    searchText?: string;
    /** Number of recent hours to search. */
    hours?: number;
    /** Log level filter. */
    level?: LevelFilter;
    /** Maximum number of returned rows. */
    maxRows?: number;
    /** Whether compressed historical logs should be included. Ignored when `activeOnly` is set. */
    includeGzip?: boolean;
    /** Whether only newly appended active-log lines should be read. */
    activeOnly?: boolean;
    /** Return an empty result and a cursor at the current end of the log ("From now"). */
    startNow?: boolean;
    /** Only include timestamps after this server-side Unix timestamp in milliseconds. */
    since?: number;
    /** Previous active-log read position. */
    cursor?: Partial<SearchCursor>;
    /** Internal reference time, for deterministic tests. */
    now?: Date | number | string;
    /** Optional compact debug logger. */
    debugLog?: (message: string) => void;
}

export interface SearchResult {
    ok: boolean;
    /** Matching rows, newest first. */
    rows: LogRow[];
    /** Number of returned rows in this response. */
    total: number;
    /** More matching rows exist than were returned. */
    truncated: boolean;
    /** Position to continue an `activeOnly` poll from. */
    cursor: SearchCursor | null;
    /** Server time the "From now" boundary was set to, only answered to `startNow`. */
    since?: number;
}

export interface SearchError {
    ok: false;
    error: string;
}

/** Response of the `getLogInfo` message. */
export interface LogInfoResult extends LogLocation {
    ok: true;
    /** Whether the directory could be read. */
    readable: boolean;
    /** Number of log files found that match the detected naming scheme. */
    files: number;
}

/** Per-file counters, only used for the debug log. */
export interface FileDiagnostic {
    name: string;
    lines: number;
    parsed: number;
    matched: number;
    rejectedFormat: number;
    rejectedTime: number;
    rejectedLevel: number;
    rejectedText: number;
}

/** The parts of `native` this adapter reads. */
export interface LogsearchConfig {
    /** Log directory. Empty enables the automatic detection. */
    logDirectory?: string;
    defaultHours?: number;
    defaultMaxRows?: number;
}

/** Payload of the `searchLogs` message sent by the admin UI. */
export interface SearchLogsMessage {
    searchText?: unknown;
    hours?: unknown;
    level?: unknown;
    maxRows?: unknown;
    activeOnly?: unknown;
    startNow?: unknown;
    since?: unknown;
    cursor?: unknown;
}
