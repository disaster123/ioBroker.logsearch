"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { expect } = require("chai");

const { parseLogLine, searchLogs } = require("./log-search");

describe("log-search utility", () => {
    /** @type {string} */
    let tempDir;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "logsearch-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should parse timestamp and level", () => {
        const parsed = parseLogLine("2026-05-27 10:11:12.123 - warn: host.adapter Some message");
        expect(parsed).to.deep.equal({
            ts: "2026-05-27 10:11:12.123",
            level: "warn",
            source: "host.adapter",
            message: "Some message",
            raw: "2026-05-27 10:11:12.123 - warn: host.adapter Some message",
        });
    });

    it("should filter case-insensitive search text, time and level", async () => {
        const now = new Date();
        const recent = new Date(now.getTime() - 30 * 60 * 1000).toISOString().replace("T", " ").slice(0, 23);
        const old = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 23);

        const content = [
            `${recent} - info: host.a Adapter Started`,
            `${recent} - error: host.a Critical failure`,
            `${old} - error: host.a Too old`,
        ].join("\n");

        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), content, "utf8");

        const result = await searchLogs({
            logDirectory: tempDir,
            hours: 6,
            level: "error",
            searchText: "CRITICAL",
        });

        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].message).to.equal("Critical failure");
    });

    it("should enforce maxRows and truncated", async () => {
        const ts = new Date().toISOString().replace("T", " ").slice(0, 23);
        const lines = [];
        for (let i = 0; i < 10; i++) {
            lines.push(`${ts} - info: host.a row ${i}`);
        }
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), lines.join("\n"), "utf8");

        const result = await searchLogs({ logDirectory: tempDir, maxRows: 3 });
        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(3);
        expect(result.total).to.equal(3);
        expect(result.truncated).to.equal(true);
    });

    it("should support includeGzip true/false", async () => {
        const ts = new Date().toISOString().replace("T", " ").slice(0, 23);
        const gzContent = `${ts} - debug: host.b from gzip`;
        const gzBuffer = zlib.gzipSync(Buffer.from(gzContent, "utf8"));
        await fs.writeFile(path.join(tempDir, "iobroker.2026-05-27.log.gz"), gzBuffer);

        const withGzip = await searchLogs({ logDirectory: tempDir, includeGzip: true, level: "debug" });
        expect(withGzip.ok).to.equal(true);
        expect(withGzip.rows).to.have.length(1);

        const withoutGzip = await searchLogs({ logDirectory: tempDir, includeGzip: false, level: "debug" });
        expect(withoutGzip.ok).to.equal(true);
        expect(withoutGzip.rows).to.have.length(0);
    });
});
