"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSearchOptions = buildSearchOptions;
exports.buildLogInfo = buildLogInfo;
exports.handleMessage = handleMessage;
const logDirectory_1 = require("./logDirectory");
const logSearch_1 = require("./logSearch");
const DEFAULT_HOURS = 72;
const DEFAULT_MAX_ROWS = 500;
/** Accept only primitives, so that objects do not end up as "[object Object]". */
function toText(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return '';
}
function toNumber(value, fallback) {
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
function buildSearchOptions(config, message, location, debugLog) {
    const payload = typeof message === 'object' && message !== null ? message : {};
    let cursor;
    if (typeof payload.cursor === 'object' && payload.cursor !== null) {
        const raw = payload.cursor;
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
        level: typeof payload.level === 'string' ? payload.level : 'all',
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
function buildLogInfo(location, describeLocation = logDirectory_1.describeLogLocation) {
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
async function handleMessage(adapter, obj, deps) {
    if (!obj) {
        return;
    }
    const respond = (response) => {
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
    const search = deps.searchLogs || logSearch_1.searchLogs;
    const options = buildSearchOptions(adapter.config, obj.message, deps.getLocation(), message => adapter.log.debug(message));
    try {
        respond(await search(options));
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        adapter.log.error(`searchLogs failed: ${errorMessage}`);
        respond({ ok: false, error: errorMessage });
    }
}
//# sourceMappingURL=messages.js.map