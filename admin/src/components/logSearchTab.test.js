"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const { expect } = require("chai");
const sinon = require("sinon");
const ts = require("typescript");

// Run the real component methods with synchronous setState and mocked browser/MUI boundaries.
function createTab(sendTo, browser = {}) {
    const source = fs.readFileSync(require.resolve("./logSearchTab.jsx"), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, {
        exports,
        require: name => {
            if (name === "react") return require("react");
            if (name === "@mui/styles") return { withStyles: () => component => component };
            return {};
        },
        setTimeout, clearTimeout, setInterval, clearInterval,
        window: browser.window || {}, document: browser.document || {},
    });
    const tab = new exports.LogSearchTab({ sendTo });
    tab.setState = (update, callback) => {
        Object.assign(tab.state, typeof update === "function" ? update(tab.state) : update);
        if (callback) callback();
    };
    return tab;
}

describe("LogSearchTab new entries and export", () => {
    let clock;
    let tab;
    const cursor = { file: "iobroker.current.log", byteOffset: 100, lineNumber: 0 };
    beforeEach(() => { clock = sinon.useFakeTimers(); });
    afterEach(() => {
        if (tab) { tab.stopAutoUpdate(true); tab.clearSearchDebounce(); }
        clock.restore();
    });

    it("ignores an old in-flight search after From now clears the table", async () => {
        /** @type {(value: any) => void} */
        let finishOld = () => { throw new Error("Old search was not started"); };
        const sendTo = sinon.stub();
        sendTo.onFirstCall().returns(new Promise(resolve => { finishOld = resolve; }));
        sendTo.onSecondCall().resolves({ ok: true, rows: [], cursor, since: 1000 });
        tab = createTab(sendTo);
        tab.onSearch();
        tab.state.rows = [{ message: "old" }];
        tab.onNewLogs(true);
        expect(tab.state.rows).to.have.length(0);
        await clock.tickAsync(0);
        finishOld({ ok: true, rows: [{ message: "stale response" }], cursor });
        await clock.tickAsync(0);
        expect(tab.state.rows).to.have.length(0);
        expect(tab.state.since).to.equal(1000);
        expect(tab.state.autoUpdateActive).to.equal(true);
    });

    it("retains the boundary on poll, filter changes and resume, and restores history explicitly", async () => {
        const sendTo = sinon.stub().resolves({ ok: true, rows: [], cursor, since: 1000 });
        tab = createTab(sendTo);
        tab.onNewLogs(true);
        await clock.tickAsync(0);
        expect(sendTo.lastCall.args[1].startNow).to.equal(true);
        await tab.runAutoUpdate();
        expect(sendTo.lastCall.args[1]).to.include({ activeOnly: true, since: 1000 });
        tab.onFieldChange("searchText", "needle");
        await clock.tickAsync(700);
        expect(sendTo.lastCall.args[1]).to.include({ startNow: false, since: 1000, searchText: "needle" });
        tab.resyncAfterResume();
        await clock.tickAsync(0);
        expect(sendTo.lastCall.args[1].since).to.equal(1000);
        tab.onNewLogs(true);
        await clock.tickAsync(0);
        expect(sendTo.lastCall.args[1].startNow).to.equal(true);
        tab.onNewLogs(false);
        await clock.tickAsync(0);
        expect(sendTo.lastCall.args[1]).to.include({ startNow: false, since: null });
        expect(tab.state.onlyNew).to.equal(false);
        expect(tab.state.searchText).to.equal("needle");
    });

    it("ignores an old in-flight poll after clearing the table again", async () => {
        /** @type {(value: any) => void} */
        let finishPoll = () => { throw new Error("Poll was not started"); };
        const sendTo = sinon.stub().resolves({ ok: true, rows: [], cursor, since: 1000 });
        tab = createTab(sendTo);
        tab.onNewLogs(true);
        await clock.tickAsync(0);
        sendTo.onCall(1).returns(new Promise(resolve => { finishPoll = resolve; }));
        const poll = tab.runAutoUpdate();
        tab.onNewLogs(true);
        await clock.tickAsync(0);
        finishPoll({ ok: true, rows: [{ message: "old poll" }], cursor });
        await poll;
        expect(tab.state.rows).to.have.length(0);
    });

    it("exports a snapshot in display order with duplicates, Unicode and no ANSI colors", async () => {
        /** @type {Blob | undefined} */
        let blob;
        const click = sinon.spy();
        const remove = sinon.spy();
        const link = { click, remove };
        const revokeObjectURL = sinon.spy();
        tab = createTab(sinon.stub(), {
            window: { Blob, URL: { createObjectURL: value => { blob = value; return "blob:test"; }, revokeObjectURL } },
            document: { createElement: () => link, body: { appendChild: sinon.spy() } },
        });
        tab.state.rows = [
            { rawPlain: "newest äöü", raw: "\u001b[32mnewest äöü" },
            { rawPlain: "duplicate" },
            { rawPlain: "duplicate" },
        ];
        tab.onExport();
        tab.state.rows = [];
        if (!blob) throw new Error("No download was created");
        expect(await blob.text()).to.equal("newest äöü\nduplicate\nduplicate\n");
        expect(blob.type).to.equal("text/plain;charset=utf-8");
        expect(link.download).to.match(/^logsearch-.*\.txt$/);
        expect(click.calledOnce && remove.calledOnce).to.equal(true);
        await clock.tickAsync(1000);
        expect(revokeObjectURL.calledWith("blob:test")).to.equal(true);
    });

});
