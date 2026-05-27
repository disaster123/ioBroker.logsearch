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
        const recent = toLogTs(new Date(now.getTime() - 30 * 60 * 1000));
        const old = toLogTs(new Date(now.getTime() - 8 * 60 * 60 * 1000));

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

    it("should set truncated only when more than maxRows exist", async () => {
        const ts = toLogTs(new Date());
        await fs.writeFile(
            path.join(tempDir, "iobroker.current.log"),
            [`${ts} - info: host.a row 1`, `${ts} - info: host.a row 2`, `${ts} - info: host.a row 3`].join("\n"),
            "utf8",
        );

        const exact = await searchLogs({ logDirectory: tempDir, maxRows: 3 });
        expect(exact.rows).to.have.length(3);
        expect(exact.truncated).to.equal(false);

        const truncated = await searchLogs({ logDirectory: tempDir, maxRows: 2 });
        expect(truncated.rows).to.have.length(2);
        expect(truncated.total).to.equal(2);
        expect(truncated.truncated).to.equal(true);
    });

    it("should support includeGzip true/false", async () => {
        const ts = toLogTs(new Date());
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

    it("should prefer current log before dated logs", async () => {
        const now = new Date();
        const currentTs = toLogTs(new Date(now.getTime() - 10 * 1000));
        const datedTs = toLogTs(new Date(now.getTime() - 30 * 1000));
        const day = now.toISOString().slice(0, 10);

        await fs.writeFile(path.join(tempDir, `iobroker.${day}.log`), `${datedTs} - info: host.a from dated`, "utf8");
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), `${currentTs} - info: host.a from current`, "utf8");

        const result = await searchLogs({ logDirectory: tempDir, maxRows: 1 });
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].message).to.equal("from current");
    });

    it("should process newer dated files before older dated files", async () => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const twoDays = new Date(now.getTime() - 48 * 60 * 60 * 1000);

        await fs.writeFile(
            path.join(tempDir, `iobroker.${twoDays.toISOString().slice(0, 10)}.log`),
            `${toLogTs(new Date(twoDays.getTime() + 3600 * 1000))} - info: host.a old file`,
            "utf8",
        );
        await fs.writeFile(
            path.join(tempDir, `iobroker.${yesterday.toISOString().slice(0, 10)}.log`),
            `${toLogTs(new Date(yesterday.getTime() + 3600 * 1000))} - info: host.a newer file`,
            "utf8",
        );

        const result = await searchLogs({ logDirectory: tempDir, hours: 72, maxRows: 1 });
        expect(result.rows[0].message).to.equal("newer file");
    });

    it("should skip dated files outside the time window", async () => {
        const now = new Date();
        const oldDay = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        await fs.writeFile(
            path.join(tempDir, `iobroker.${oldDay}.log`),
            `${toLogTs(new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000))} - info: host.a too old`,
            "utf8",
        );

        const result = await searchLogs({ logDirectory: tempDir, hours: 6 });
        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(0);
    });

    it("should fallback to all for invalid level and clamp low hours", async () => {
        const ts = toLogTs(new Date(Date.now() - 20 * 60 * 1000));
        await fs.writeFile(
            path.join(tempDir, "iobroker.current.log"),
            `${ts} - warn: host.a warning line`,
            "utf8",
        );

        const result = await searchLogs({ logDirectory: tempDir, level: "", hours: 0 });
        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].level).to.equal("warn");
    });
});
