/** Mirror of the response types of `src/lib/types.ts` in the adapter. */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'silly';
export type LevelFilter = LogLevel | 'all';

export const LEVEL_FILTERS: LevelFilter[] = ['all', 'error', 'warn', 'info', 'debug', 'silly'];

export interface LogRow {
    ts: string;
    level: LogLevel;
    source: string;
    message: string;
    raw: string;
    rawPlain: string;
    rowId?: string;
}

export interface SearchCursor {
    file: string;
    byteOffset: number;
    lineNumber: number;
    size: number;
    mtimeMs: number;
}

export interface SearchResponse {
    ok: boolean;
    rows?: LogRow[];
    total?: number;
    truncated?: boolean;
    cursor?: SearchCursor | null;
    error?: string;
}

export interface LogInfoResponse {
    ok: boolean;
    directory: string;
    prefix: string;
    extension: string;
    source: 'manual' | 'controller-config' | 'probe' | 'fallback';
    readable: boolean;
    files: number;
}

export interface SearchRequest {
    searchText: string;
    hours: number;
    level: LevelFilter;
    maxRows: number;
    activeOnly?: boolean;
    cursor?: SearchCursor | null;
}
