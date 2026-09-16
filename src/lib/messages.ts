import { describeLogLocation } from './logDirectory';
import { searchLogs as defaultSearchLogs } from './logSearch';
import type {
    LevelFilter,
    LogInfoResult,
    LogLocation,
    LogsearchConfig,
    SearchCursor,
    SearchError,
    SearchLogsMessage,
    SearchLogsOptions,
    SearchResult,
} from './types';

const DEFAULT_HOURS = 72;
const DEFAULT_MAX_ROWS = 500;

/** The adapter members the message handler needs. Kept minimal so tests can pass a plain object. */
export interface MessageAdapter {
    config: LogsearchConfig;
    log: {
        debug: (message: string) => void;
        error: (message: string) => void;
    };
    sendTo: (
        from: string,
        command: string,
        message: any,
        callback?: ioBroker.MessageCallbackInfo | ioBroker.MessageCallback,
    ) => void;
}

export interface MessageHandlerDeps {
    /** Log location, resolved once on adapter start. */
    getLocation: () => LogLocation;
    /** Injectable for tests. */
    searchLogs?: (options: SearchLogsOptions) => Promise<SearchResult | SearchError>;
    /** Injectable for tests. */
    describeLocation?: typeof describeLogLocation;
}

/** Accept only primitives, so that objects do not end up as "[object Object]". */
function toText(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return '';
}

function toNumber(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Normalize an untrusted `searchLogs` message into search options.
 *
 * `includeGzip` is always forced on: the caller may not decide how much of the history is scanned.
 *
 * @param config The instance configuration.
 * @param message The received message payload.
 * @param location The resolved log location.
 * @param debugLog Optional debug logger handed to the search.
 */
export function buildSearchOptions(
    config: LogsearchConfig,
    message: unknown,
    location: LogLocation,
    debugLog?: (message: string) => void,
): SearchLogsOptions {
    const payload: SearchLogsMessage = typeof message === 'object' && message !== null ? message : {};

    let cursor: SearchCursor | undefined;
    if (typeof payload.cursor === 'object' && payload.cursor !== null) {
        const raw = payload.cursor as Partial<Record<keyof SearchCursor, unknown>>;
        cursor = {
            file: typeof raw.file === 'string' ? raw.file : '',
            byteOffset: Number(raw.byteOffset),
            lineNumber: Number(raw.lineNumber),
            size: Number(raw.size),
            mtimeMs: Number(raw.mtimeMs),
        };
    }

    return {
        location,
        searchText: toText(payload.searchText),
        hours: toNumber(payload.hours, toNumber(config.defaultHours, DEFAULT_HOURS)),
        level: typeof payload.level === 'string' ? (payload.level as LevelFilter) : 'all',
        maxRows: toNumber(payload.maxRows, toNumber(config.defaultMaxRows, DEFAULT_MAX_ROWS)),
        includeGzip: true,
        activeOnly: payload.activeOnly === true,
        startNow: payload.startNow === true,
        // invalid values are passed on on purpose: the search rejects them instead of showing old entries
        since: payload.since === undefined || payload.since === null ? undefined : Number(payload.since),
        cursor,
        debugLog,
    };
}

/** Build the `getLogInfo` response for the admin UI. */
export function buildLogInfo(
    location: LogLocation,
    describeLocation: typeof describeLogLocation = describeLogLocation,
): LogInfoResult {
    return { ok: true, ...location, ...describeLocation(location) };
}

/**
 * Handle a message sent to this instance over the message box.
 *
 * Unknown commands are ignored, so that other senders do not get a bogus answer.
 *
 * @param adapter The adapter (or a test double).
 * @param obj The received ioBroker message.
 * @param deps Log location accessor and injectable collaborators.
 */
export async function handleMessage(
    adapter: MessageAdapter,
    obj: ioBroker.Message | null | undefined,
    deps: MessageHandlerDeps,
): Promise<void> {
    if (!obj) {
        return;
    }

    const respond = (response: unknown): void => {
        if (obj.callback) {
            adapter.sendTo(obj.from, obj.command, response, obj.callback);
        }
    };

    if (obj.command === 'getLogInfo') {
        respond(buildLogInfo(deps.getLocation(), deps.describeLocation));
        return;
    }

    if (obj.command !== 'searchLogs') {
        return;
    }

    const search = deps.searchLogs || defaultSearchLogs;
    const options = buildSearchOptions(adapter.config, obj.message, deps.getLocation(), message =>
        adapter.log.debug(message),
    );

    try {
        respond(await search(options));
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        adapter.log.error(`searchLogs failed: ${errorMessage}`);
        respond({ ok: false, error: errorMessage });
    }
}
