import { expect } from 'chai';

import { buildLogInfo, buildSearchOptions, handleMessage, type MessageAdapter } from '../src/lib/messages';
import type { LogLocation, LogsearchConfig, SearchLogsOptions } from '../src/lib/types';

const LOCATION: LogLocation = {
    directory: '/configured/log/dir',
    prefix: 'iobroker',
    extension: '.log',
    source: 'manual',
};

const CONFIG: LogsearchConfig = { logDirectory: '/configured/log/dir', defaultHours: 72, defaultMaxRows: 500 };

interface FakeAdapter extends MessageAdapter {
    errors: string[];
    debugs: string[];
    sent: { from: string; command: string; message: unknown; callback: unknown }[];
}

function createAdapter(config: LogsearchConfig = CONFIG): FakeAdapter {
    const adapter: FakeAdapter = {
        config,
        errors: [],
        debugs: [],
        sent: [],
        log: {
            debug: message => adapter.debugs.push(message),
            error: message => adapter.errors.push(message),
        },
        sendTo: (from, command, message, callback) => adapter.sent.push({ from, command, message, callback }),
    };
    return adapter;
}

function message(payload: Record<string, unknown>, command = 'searchLogs', callback: unknown = { message: 'cb' }): any {
    return { from: 'system.adapter.admin.0', command, message: payload, callback };
}

describe('buildSearchOptions', () => {
    it('should apply the configured defaults and always force includeGzip', () => {
        const options = buildSearchOptions(
            CONFIG,
            { logDirectory: '/ignore/me', includeGzip: 'false', level: 5, searchText: 17 },
            LOCATION,
        );

        expect(options.location).to.deep.equal(LOCATION);
        expect(options.searchText).to.equal('17');
        expect(options.hours).to.equal(72);
        expect(options.level).to.equal('all');
        expect(options.maxRows).to.equal(500);
        expect(options.includeGzip).to.equal(true);
        expect(options.activeOnly).to.equal(false);
        expect(options.cursor).to.equal(undefined);
        expect(options.startNow).to.equal(false);
        expect(options.since).to.equal(undefined);
    });

    it('should forward an invalid since, so that the search rejects it', () => {
        expect(buildSearchOptions(CONFIG, { since: 'soon' }, LOCATION).since).to.be.NaN;
    });

    it('should fall back to the built-in defaults without configuration', () => {
        const options = buildSearchOptions({}, {}, LOCATION);

        expect(options.hours).to.equal(72);
        expect(options.maxRows).to.equal(500);
    });

    it('should accept numeric strings and a sanitized cursor', () => {
        const options = buildSearchOptions(
            CONFIG,
            {
                hours: '2',
                maxRows: '15',
                level: 'warn',
                activeOnly: true,
                startNow: true,
                since: '123456789',
                includeGzip: false,
                cursor: {
                    file: 'iobroker.current.log',
                    byteOffset: '123',
                    lineNumber: '4',
                    size: '456',
                    mtimeMs: '789',
                    ignored: 'value',
                },
            },
            LOCATION,
        );

        expect(options.hours).to.equal(2);
        expect(options.maxRows).to.equal(15);
        expect(options.level).to.equal('warn');
        expect(options.activeOnly).to.equal(true);
        expect(options.startNow).to.equal(true);
        expect(options.since).to.equal(123456789);
        expect(options.includeGzip).to.equal(true);
        expect(options.cursor).to.deep.equal({
            file: 'iobroker.current.log',
            byteOffset: 123,
            lineNumber: 4,
            size: 456,
            mtimeMs: 789,
        });
    });

    it('should ignore unusable numbers instead of forwarding NaN', () => {
        const options = buildSearchOptions(CONFIG, { hours: 'many', maxRows: null }, LOCATION);

        expect(options.hours).to.equal(72);
        expect(options.maxRows).to.equal(500);
    });
});

describe('handleMessage', () => {
    it('reads and remembers history without starting a log search', async () => {
        const adapter = createAdapter();
        const remembered: unknown[] = [];
        const deps = {
            getLocation: (): LogLocation => {
                throw new Error('must not access logs');
            },
            searchHistory: {
                get: async () => ({ entries: ['previous'], lastSearch: '' }),
                remember: async (text: unknown) => {
                    remembered.push(text);
                    return { entries: ['next', 'previous'], lastSearch: 'next' };
                },
            },
        };
        await handleMessage(adapter, message({}, 'getSearchHistory'), deps);
        await handleMessage(adapter, message({ searchText: 'next' }, 'rememberSearch'), deps);
        expect(remembered).to.deep.equal(['next']);
        expect(adapter.sent.map(entry => entry.message)).to.deep.equal([
            { ok: true, entries: ['previous'], lastSearch: '' },
            { ok: true, entries: ['next', 'previous'], lastSearch: 'next' },
        ]);
    });

    it('returns history storage failures to the caller', async () => {
        const adapter = createAdapter();
        await handleMessage(adapter, message({}, 'getSearchHistory'), {
            getLocation: () => LOCATION,
            searchHistory: {
                get: () => Promise.reject(new Error('storage offline')),
                remember: async () => ({ entries: [], lastSearch: '' }),
            },
        });
        expect(adapter.sent[0].message).to.deep.equal({ ok: false, error: 'storage offline' });
        expect(adapter.errors).to.deep.equal(['getSearchHistory failed: storage offline']);
    });

    it('should answer searchLogs with the search result', async () => {
        const adapter = createAdapter();
        const calls: SearchLogsOptions[] = [];
        const result = { ok: true, rows: [], total: 0, truncated: false, cursor: null };

        await handleMessage(adapter, message({ searchText: 'boot' }), {
            getLocation: () => LOCATION,
            searchLogs: options => {
                calls.push(options);
                return Promise.resolve(result);
            },
        });

        expect(calls).to.have.length(1);
        expect(calls[0].searchText).to.equal('boot');
        expect(calls[0].debugLog).to.be.a('function');
        expect(adapter.sent).to.have.length(1);
        expect(adapter.sent[0].message).to.equal(result);
        expect(adapter.sent[0].callback).to.deep.equal({ message: 'cb' });
    });

    it('should forward the debug logger of the adapter', async () => {
        const adapter = createAdapter();

        await handleMessage(adapter, message({}), {
            getLocation: () => LOCATION,
            searchLogs: options => {
                options.debugLog?.('hello');
                return Promise.resolve({ ok: true, rows: [], total: 0, truncated: false, cursor: null });
            },
        });

        expect(adapter.debugs).to.deep.equal(['hello']);
    });

    it('should not crash when the callback is missing', async () => {
        const adapter = createAdapter();
        let called = 0;

        await handleMessage(adapter, message({ hours: '2' }, 'searchLogs', null), {
            getLocation: () => LOCATION,
            searchLogs: () => {
                called++;
                return Promise.resolve({ ok: true, rows: [], total: 0, truncated: false, cursor: null });
            },
        });

        expect(called).to.equal(1);
        expect(adapter.sent).to.have.length(0);
    });

    it('should send a structured error response when the search throws', async () => {
        const adapter = createAdapter();

        await handleMessage(adapter, message({}), {
            getLocation: () => LOCATION,
            searchLogs: () => Promise.reject(new Error('boom')),
        });

        expect(adapter.sent).to.have.length(1);
        expect(adapter.sent[0].message).to.deep.equal({ ok: false, error: 'boom' });
        expect(adapter.errors).to.deep.equal(['searchLogs failed: boom']);
    });

    it('should answer getLogInfo with the detected location', async () => {
        const adapter = createAdapter();

        await handleMessage(adapter, message({}, 'getLogInfo'), {
            getLocation: () => LOCATION,
            describeLocation: () => ({ readable: true, files: 4 }),
        });

        expect(adapter.sent[0].message).to.deep.equal({ ok: true, ...LOCATION, readable: true, files: 4 });
    });

    it('should ignore unknown commands and missing messages', async () => {
        const adapter = createAdapter();
        const deps = { getLocation: () => LOCATION, searchLogs: () => Promise.reject(new Error('must not run')) };

        await handleMessage(adapter, message({}, 'somethingElse'), deps);
        await handleMessage(adapter, undefined, deps);

        expect(adapter.sent).to.have.length(0);
    });
});

describe('buildLogInfo', () => {
    it('should merge the location with its readability', () => {
        expect(buildLogInfo(LOCATION, () => ({ readable: false, files: 0 }))).to.deep.equal({
            ok: true,
            ...LOCATION,
            readable: false,
            files: 0,
        });
    });
});
