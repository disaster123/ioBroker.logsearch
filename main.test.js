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
    it("should sanitize inputs, call utility and respond via callback", async () => {
        const searchLogsStub = sinon.stub().resolves({
            ok: true,
            rows: [],
            total: 0,
            truncated: false,
        });

        class FakeAdapter {
            constructor(options) {
                this.options = options;
                this.log = { error: sinon.stub() };
                this.sendTo = sinon.stub();
            }
            on() {}
        }

        const createAdapter = proxyquire("./main", {
            "@iobroker/adapter-core": { Adapter: FakeAdapter },
            "./lib/log-search": { searchLogs: searchLogsStub },
        });
        const adapter = createAdapter();

        await adapter.onMessage({
            from: "system.adapter.admin.0",
            command: "searchLogs",
            message: { hours: "12", maxRows: "50", includeGzip: 0, level: 5, searchText: 17 },
            callback: { message: "cb" },
        });

        expect(searchLogsStub.calledOnce).to.equal(true);
        expect(searchLogsStub.firstCall.args[0]).to.deep.equal({
            logDirectory: "/opt/iobroker/log",
            searchText: "17",
            hours: 12,
            level: "all",
            maxRows: 50,
            includeGzip: false,
        });
        expect(adapter.sendTo.calledOnce).to.equal(true);
    });
});
