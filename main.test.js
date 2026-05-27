"use strict";

/**
 * This is a dummy TypeScript test file using chai and mocha
 *
 * It's automatically excluded from npm and its build output is excluded from both git and npm.
 * It is advised to test all your modules with accompanying *.test.js-files
 */

// tslint:disable:no-unused-expression

const { expect } = require("chai");
const sinon = require("sinon");
const proxyquire = require("proxyquire").noCallThru();
// import { functionToTest } from "./moduleToTest";

describe("module to test => function to test", () => {
    // initializing logic
    const expected = 5;

    it(`should return ${expected}`, () => {
        const result = 5;
        // assign result a value from functionToTest
        expect(result).to.equal(expected);
        // or using the should() syntax
        result.should.equal(expected);
    });
    // ... more tests => it

});

// ... more test suites => describe

describe("onMessage searchLogs handler", () => {
    function createTestAdapter(searchLogsStub) {
        class FakeAdapter {
            constructor(options) {
                this.options = options;
                this.config = {
                    logDirectory: "/configured/log/dir",
                    includeGzip: true,
                    defaultHours: 6,
                    defaultMaxRows: 500,
                };
                this.log = { error: sinon.stub(), debug: sinon.stub() };
                this.sendTo = sinon.stub();
            }
            on() {}
        }

        const createAdapter = proxyquire("./main", {
            "@iobroker/adapter-core": { Adapter: FakeAdapter },
            "./lib/log-search": { searchLogs: searchLogsStub },
        });
        return createAdapter();
    }

    it("should use config logDirectory/defaults and sanitize includeGzip string", async () => {
        const searchLogsStub = sinon.stub().resolves({ ok: true, rows: [], total: 0, truncated: false });
        const adapter = createTestAdapter(searchLogsStub);

        await adapter.onMessage({
            from: "system.adapter.admin.0",
            command: "searchLogs",
            message: {
                logDirectory: "/ignore/me",
                includeGzip: "false",
                level: 5,
                searchText: 17,
            },
            callback: { message: "cb" },
        });

        expect(searchLogsStub.calledOnce).to.equal(true);
        expect(searchLogsStub.firstCall.args[0]).to.include({
            logDirectory: "/configured/log/dir",
            searchText: "17",
            hours: 6,
            level: "all",
            maxRows: 500,
            includeGzip: false,
        });
        expect(searchLogsStub.firstCall.args[0].debugLog).to.be.a("function");
        expect(adapter.sendTo.calledOnce).to.equal(true);
    });

    it("should not crash when callback is missing", async () => {
        const searchLogsStub = sinon.stub().resolves({ ok: true, rows: [], total: 0, truncated: false });
        const adapter = createTestAdapter(searchLogsStub);

        await adapter.onMessage({
            from: "system.adapter.admin.0",
            command: "searchLogs",
            message: { hours: "2", maxRows: "15" },
        });

        expect(searchLogsStub.calledOnce).to.equal(true);
        expect(adapter.sendTo.called).to.equal(false);
    });

    it("should send structured error response when search throws", async () => {
        const searchLogsStub = sinon.stub().rejects(new Error("boom"));
        const adapter = createTestAdapter(searchLogsStub);

        await adapter.onMessage({
            from: "system.adapter.admin.0",
            command: "searchLogs",
            message: {},
            callback: { message: "cb" },
        });

        expect(adapter.sendTo.calledOnce).to.equal(true);
        expect(adapter.sendTo.firstCall.args[2]).to.deep.equal({
            ok: false,
            error: "boom",
        });
    });
});
