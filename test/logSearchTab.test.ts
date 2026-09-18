import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vm from 'node:vm';
import * as sinon from 'sinon';
import * as ts from 'typescript';

const COMPONENT = join(__dirname, '..', 'src-admin', 'src', 'components', 'LogSearchTab.tsx');

/** Minimal React base class: the tests call the component methods directly and never render. */
class FakeComponent {
    public props: any;
    public state: any = {};
    constructor(props: any) {
        this.props = props;
    }
}

interface Browser {
    window?: Record<string, any>;
    document?: Record<string, any>;
}

/**
 * Run the real component methods with a synchronous setState and mocked browser, MUI and
 * gui-components boundaries. The GUI is a separate npm project, so nothing of it is imported.
 */
function createTab(sendTo: sinon.SinonStub, browser: Browser = {}): any {
    const compiled = ts.transpileModule(readFileSync(COMPONENT, 'utf8'), {
        compilerOptions: {
            jsx: ts.JsxEmit.React,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText;

    const moduleExports: Record<string, any> = {};
    vm.runInNewContext(compiled, {
        exports: moduleExports,
        require: (name: string): any => {
            if (name === 'react') {
                return { Component: FakeComponent };
            }
            if (name === '@iobroker/gui-components') {
                return { I18n: { t: (word: string) => word } };
            }
            if (name === '../types') {
                return { LEVEL_FILTERS: ['all', 'error', 'warn', 'info', 'debug', 'silly'] };
            }
            return {};
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        window: browser.window || {},
        document: browser.document || {},
    });

    const tab = new moduleExports.default({ sendTo, socketReady: true, alive: true, logInfo: null });
    tab.setState = (update: any, callback?: () => void): void => {
        Object.assign(tab.state, typeof update === 'function' ? update(tab.state) : update);
        callback?.();
    };
    return tab;
}

describe('LogSearchTab new entries and export', () => {
    let clock: sinon.SinonFakeTimers;
    let tab: any;
    const cursor = { file: 'iobroker.current.log', byteOffset: 100, lineNumber: 0 };

    beforeEach(() => {
        clock = sinon.useFakeTimers();
    });

    afterEach(() => {
        if (tab) {
            tab.stopAutoUpdate(true);
            tab.clearSearchDebounce();
        }
        clock.restore();
    });

    it('remembers completed input on blur, not keystrokes or polling', async () => {
        const sendTo = sinon.stub().resolves({ ok: true, rows: [], cursor });
        sendTo.withArgs('rememberSearch').resolves({ ok: true, entries: ['mqtt.0'] });
        tab = createTab(sendTo);
        tab.onFieldChange('searchText', 'm');
        await clock.tickAsync(700);
        tab.onFieldChange('searchText', 'mqtt.0');
        await clock.tickAsync(700);
        await tab.runAutoUpdate();
        expect(sendTo.calledWith('rememberSearch')).to.equal(false);

        tab.rememberCurrentSearch(true);
        await clock.tickAsync(0);
        expect(sendTo.withArgs('rememberSearch').calledOnceWith('rememberSearch', { searchText: 'mqtt.0' })).to.equal(
            true,
        );
        expect(tab.state.searchHistory).to.deep.equal(['mqtt.0']);
        tab.rememberCurrentSearch(true);
        expect(sendTo.withArgs('rememberSearch').calledOnce).to.equal(true);
    });

    it('searches a history selection immediately, preserving filters and From now', async () => {
        const sendTo = sinon.stub().resolves({ ok: true, rows: [], cursor, entries: ['chosen'] });
        tab = createTab(sendTo);
        Object.assign(tab.state, { onlyNew: true, since: 123, hours: 24, level: 'warn', maxRows: 100 });
        tab.onFieldChange('searchText', 'unfinished');
        tab.selectSearch('chosen');
        await clock.tickAsync(1000);
        expect(sendTo.withArgs('searchLogs').calledOnce).to.equal(true);
        expect(sendTo.withArgs('searchLogs').firstCall.args[1]).to.include({
            searchText: 'chosen',
            since: 123,
            hours: 24,
            level: 'warn',
            maxRows: 100,
            startNow: false,
        });
        expect(sendTo.calledWith('rememberSearch', { searchText: 'chosen' })).to.equal(true);
    });

    it('ignores stale history loads and responses after unmount', async () => {
        let finishLoad!: (value: unknown) => void;
        const sendTo = sinon.stub().resolves({ ok: true, entries: ['new'] });
        sendTo.withArgs('getSearchHistory').returns(
            new Promise(resolve => {
                finishLoad = resolve;
            }),
        );
        tab = createTab(sendTo);
        const loading = tab.loadSearchHistory();
        tab.state.searchText = 'new';
        tab.rememberCurrentSearch();
        await clock.tickAsync(0);
        finishLoad({ ok: true, entries: ['old'] });
        await loading;
        expect(tab.state.searchHistory).to.deep.equal(['new']);

        const secondLoad = tab.loadSearchHistory();
        tab.unmounted = true;
        await secondLoad;
        expect(tab.state.searchHistory).to.deep.equal(['new']);
    });

    it('keeps searching when history is unavailable and skips empty history entries', async () => {
        const sendTo = sinon.stub().resolves({ ok: true, rows: [], cursor });
        sendTo.withArgs('rememberSearch').rejects(new Error('offline'));
        tab = createTab(sendTo);
        tab.onSubmitSearch();
        await clock.tickAsync(0);
        expect(sendTo.calledWith('rememberSearch')).to.equal(false);
        tab.state.searchText = 'needle';
        tab.onSubmitSearch();
        await clock.tickAsync(0);
        expect(sendTo.withArgs('searchLogs').callCount).to.equal(2);
        expect(tab.state.error).to.equal('');
    });

    it('ignores an old in-flight search after From now clears the table', async () => {
        let finishOld: (value: any) => void = () => {
            throw new Error('Old search was not started');
        };
        const sendTo = sinon.stub();
        sendTo.onFirstCall().returns(
            new Promise(resolve => {
                finishOld = resolve;
            }),
        );
        sendTo.onSecondCall().resolves({ ok: true, rows: [], cursor, since: 1000 });
        tab = createTab(sendTo);

        tab.onSearch();
        tab.state.rows = [{ message: 'old' }];
        tab.onToggleNewLogs();
        expect(tab.state.rows).to.have.length(0);

        await clock.tickAsync(0);
        finishOld({ ok: true, rows: [{ message: 'stale response' }], cursor });
        await clock.tickAsync(0);

        expect(tab.state.rows).to.have.length(0);
        expect(tab.state.since).to.equal(1000);
        expect(tab.state.autoUpdateActive).to.equal(true);
    });

    it('retains the boundary on poll, filter changes and resume, and toggles history on the second click', async () => {
        const sendTo = sinon.stub().resolves({ ok: true, rows: [], cursor, since: 1000 });
        tab = createTab(sendTo);

        tab.onToggleNewLogs();
        await clock.tickAsync(0);
        expect(sendTo.lastCall.args[1].startNow).to.equal(true);
        expect(tab.state.onlyNew).to.equal(true);

        await tab.runAutoUpdate();
        expect(sendTo.lastCall.args[1]).to.include({ activeOnly: true, since: 1000 });

        tab.onFieldChange('searchText', 'needle');
        await clock.tickAsync(700);
        expect(sendTo.lastCall.args[1]).to.include({ startNow: false, since: 1000, searchText: 'needle' });

        tab.resyncAfterResume();
        await clock.tickAsync(0);
        expect(sendTo.lastCall.args[1].since).to.equal(1000);

        tab.onToggleNewLogs();
        await clock.tickAsync(0);
        expect(sendTo.lastCall.args[1]).to.include({ startNow: false, since: null });
        expect(tab.state.onlyNew).to.equal(false);
        expect(tab.state.searchText).to.equal('needle');
    });

    it('ignores an old in-flight poll after switching back to history', async () => {
        let finishPoll: (value: any) => void = () => {
            throw new Error('Poll was not started');
        };
        const sendTo = sinon.stub().resolves({ ok: true, rows: [], cursor, since: 1000 });
        tab = createTab(sendTo);

        tab.onToggleNewLogs();
        await clock.tickAsync(0);
        sendTo.onCall(1).returns(
            new Promise(resolve => {
                finishPoll = resolve;
            }),
        );
        const poll = tab.runAutoUpdate();
        tab.onToggleNewLogs();
        await clock.tickAsync(0);
        finishPoll({ ok: true, rows: [{ message: 'old poll' }], cursor });
        await poll;

        expect(tab.state.rows).to.have.length(0);
        expect(tab.state.onlyNew).to.equal(false);
        expect(tab.state.since).to.equal(null);
    });

    it('reports an adapter that does not know startNow yet', async () => {
        // an adapter from before "From now" answers the search, but without `since`
        const sendTo = sinon.stub().resolves({ ok: true, rows: [], cursor });
        tab = createTab(sendTo);

        tab.onToggleNewLogs();
        await clock.tickAsync(0);

        expect(tab.state.error).to.match(/requires an updated logsearch adapter/);
        expect(tab.state.autoUpdateActive).to.equal(false);
    });

    it('exports a snapshot in display order with duplicates, Unicode and no ANSI colors', async () => {
        let blob: Blob | undefined;
        const click = sinon.spy();
        const remove = sinon.spy();
        const link: Record<string, any> = { click, remove };
        const revokeObjectURL = sinon.spy();
        tab = createTab(sinon.stub(), {
            window: {
                Blob,
                URL: {
                    createObjectURL: (value: Blob): string => {
                        blob = value;
                        return 'blob:test';
                    },
                    revokeObjectURL,
                },
            },
            document: { createElement: () => link, body: { appendChild: sinon.spy() } },
        });
        tab.state.rows = [
            { rawPlain: 'newest äöü', raw: '\u001b[32mnewest äöü' },
            { rawPlain: 'duplicate' },
            { rawPlain: 'duplicate' },
        ];

        tab.onExport();
        tab.state.rows = [];

        if (!blob) {
            throw new Error('No download was created');
        }
        expect(await blob.text()).to.equal('newest äöü\nduplicate\nduplicate\n');
        expect(blob.type).to.equal('text/plain;charset=utf-8');
        expect(link.download).to.match(/^logsearch-.*\.txt$/);
        expect(click.calledOnce && remove.calledOnce).to.equal(true);

        await clock.tickAsync(1000);
        expect(revokeObjectURL.calledWith('blob:test')).to.equal(true);
    });

    it('does not export an empty table', () => {
        const createElement = sinon.spy();
        tab = createTab(sinon.stub(), { document: { createElement } });

        tab.onExport();

        expect(createElement.called).to.equal(false);
    });
});
