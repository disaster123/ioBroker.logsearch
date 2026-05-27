"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { expect } = require("chai");

const { parseLogLine, searchLogs } = require("./log-search");

function toLogTs(date) {
    return date.toISOString().replace("T", " ").slice(0, 23);
}

describe("log-search utility", () => {
    /** @type {string} */
    let tempDir;
    const fixedNowIso = "2026-05-27T12:00:00.000Z";
    const fixedNow = new Date(fixedNowIso);

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
        const recent = toLogTs(new Date(fixedNow.getTime() - 30 * 60 * 1000));
        const old = toLogTs(new Date(fixedNow.getTime() - 8 * 60 * 60 * 1000));
        const content = [`${recent} - info: host.a Adapter Started`, `${recent} - error: host.a Critical failure`, `${old} - error: host.a Too old`].join("\n");
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), content, "utf8");

        const result = await searchLogs({ logDirectory: tempDir, hours: 6, level: "error", searchText: "CRITICAL", now: fixedNowIso });
        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].message).to.equal("Critical failure");
    });

    it("should set truncated only when more than maxRows exist", async () => {
        const ts = toLogTs(fixedNow);
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), [`${ts} - info: host.a row 1`, `${ts} - info: host.a row 2`, `${ts} - info: host.a row 3`].join("\n"), "utf8");

        const exact = await searchLogs({ logDirectory: tempDir, maxRows: 3, now: fixedNow });
        expect(exact.rows).to.have.length(3);
        expect(exact.truncated).to.equal(false);

        const truncated = await searchLogs({ logDirectory: tempDir, maxRows: 2, now: fixedNow.getTime() });
        expect(truncated.rows).to.have.length(2);
        expect(truncated.total).to.equal(2);
        expect(truncated.truncated).to.equal(true);
    });

    it("should support includeGzip true/false", async () => {
        const ts = toLogTs(fixedNow);
        const gzBuffer = zlib.gzipSync(Buffer.from(`${ts} - debug: host.b from gzip`, "utf8"));
        await fs.writeFile(path.join(tempDir, "iobroker.2026-05-27.log.gz"), gzBuffer);

        const withGzip = await searchLogs({ logDirectory: tempDir, includeGzip: true, level: "debug", now: fixedNow });
        expect(withGzip.ok).to.equal(true);
        expect(withGzip.rows).to.have.length(1);

        const withoutGzip = await searchLogs({ logDirectory: tempDir, includeGzip: false, level: "debug", now: fixedNow });
        expect(withoutGzip.ok).to.equal(true);
        expect(withoutGzip.rows).to.have.length(0);
    });

    it("should prefer current log before dated logs", async () => {
        const currentTs = toLogTs(new Date(fixedNow.getTime() - 10 * 1000));
        const datedTs = toLogTs(new Date(fixedNow.getTime() - 30 * 1000));
        await fs.writeFile(path.join(tempDir, "iobroker.2026-05-27.log"), `${datedTs} - info: host.a from dated`, "utf8");
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), `${currentTs} - info: host.a from current`, "utf8");

        const result = await searchLogs({ logDirectory: tempDir, maxRows: 1, now: fixedNow });
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].message).to.equal("from current");
    });

    it("should process newer dated files before older dated files", async () => {
        await fs.writeFile(path.join(tempDir, "iobroker.2026-05-25.log"), "2026-05-25 01:00:00.000 - info: host.a old file", "utf8");
        await fs.writeFile(path.join(tempDir, "iobroker.2026-05-26.log"), "2026-05-26 01:00:00.000 - info: host.a newer file", "utf8");

        const result = await searchLogs({ logDirectory: tempDir, hours: 72, maxRows: 1, now: fixedNow });
        expect(result.rows[0].message).to.equal("newer file");
    });

    it("should skip dated files outside the time window", async () => {
        await fs.writeFile(path.join(tempDir, "iobroker.2026-05-17.log"), "2026-05-17 10:00:00.000 - info: host.a too old", "utf8");

        const result = await searchLogs({ logDirectory: tempDir, hours: 6, now: fixedNow });
        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(0);
    });

    it("should fallback to all for invalid level and clamp low hours", async () => {
        const ts = toLogTs(new Date(fixedNow.getTime() - 20 * 60 * 1000));
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), `${ts} - warn: host.a warning line`, "utf8");

        const result = await searchLogs({ logDirectory: tempDir, level: "", hours: 0, now: fixedNow });
        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].level).to.equal("warn");
    });

    it("should not crash on invalid now and fallback to current time", async () => {
        const ts = toLogTs(new Date(Date.now() - 5 * 60 * 1000));
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), `${ts} - info: host.a fallback now`, "utf8");

        const result = await searchLogs({ logDirectory: tempDir, hours: 1, now: "not-a-date" });
        expect(result.ok).to.equal(true);
        expect(result.rows.length).to.be.greaterThan(0);
    });
});
