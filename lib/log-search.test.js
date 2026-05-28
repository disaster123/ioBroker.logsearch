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
            rawPlain: "2026-05-27 10:11:12.123 - warn: host.adapter Some message",
        });
    });


    it("should parse real ioBroker line with process id", () => {
        const parsed = parseLogLine("2026-05-27 23:07:56.548 - info: javascript.0 (526) script.js.common._test: start JavaScript (Javascript/js)");
        expect(parsed).to.deep.equal({
            ts: "2026-05-27 23:07:56.548",
            level: "info",
            source: "javascript.0",
            message: "script.js.common._test: start JavaScript (Javascript/js)",
            raw: "2026-05-27 23:07:56.548 - info: javascript.0 (526) script.js.common._test: start JavaScript (Javascript/js)",
            rawPlain: "2026-05-27 23:07:56.548 - info: javascript.0 (526) script.js.common._test: start JavaScript (Javascript/js)",
        });
    });

    it("should parse real ioBroker line with ANSI level and keep raw", () => {
        const ansiLine = "2026-05-27 23:16:13.426 - \u001b[32minfo\u001b[39m: javascript.0 (526) script.js.common._test: start JavaScript";
        const parsed = parseLogLine(ansiLine);
        expect(parsed).to.deep.equal({
            ts: "2026-05-27 23:16:13.426",
            level: "info",
            source: "javascript.0",
            message: "script.js.common._test: start JavaScript",
            raw: ansiLine,
            rawPlain: "2026-05-27 23:16:13.426 - info: javascript.0 (526) script.js.common._test: start JavaScript",
        });
    });

    it("should parse line with leading whitespace", () => {
        const parsed = parseLogLine("	 2026-05-27 10:11:12.123 - debug: host.adapter Leading whitespace");
        expect(parsed).to.deep.equal({
            ts: "2026-05-27 10:11:12.123",
            level: "debug",
            source: "host.adapter",
            message: "Leading whitespace",
            raw: "2026-05-27 10:11:12.123 - debug: host.adapter Leading whitespace",
            rawPlain: "2026-05-27 10:11:12.123 - debug: host.adapter Leading whitespace",
        });
    });

    it("should parse line without process id", () => {
        const parsed = parseLogLine("2026-05-27 10:11:12.123 - info: host.adapter message without pid");
        expect(parsed).to.deep.equal({
            ts: "2026-05-27 10:11:12.123",
            level: "info",
            source: "host.adapter",
            message: "message without pid",
            raw: "2026-05-27 10:11:12.123 - info: host.adapter message without pid",
            rawPlain: "2026-05-27 10:11:12.123 - info: host.adapter message without pid",
        });
    });

    it("should normalize uppercase level to lowercase", () => {
        const parsed = parseLogLine("2026-05-27 10:11:12.123 - WARN: host.adapter uppercase level");
        expect(parsed).to.deep.equal({
            ts: "2026-05-27 10:11:12.123",
            level: "warn",
            source: "host.adapter",
            message: "uppercase level",
            raw: "2026-05-27 10:11:12.123 - WARN: host.adapter uppercase level",
            rawPlain: "2026-05-27 10:11:12.123 - WARN: host.adapter uppercase level",
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

    it("should match searchText in ANSI log lines", async () => {
        const recent = toLogTs(new Date(fixedNow.getTime() - 5 * 60 * 1000));
        const ansiLine = `${recent} - \u001b[32minfo\u001b[39m: javascript.0 (526) script.js.common._test: start JavaScript`;
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), ansiLine, "utf8");

        const result = await searchLogs({ logDirectory: tempDir, hours: 6, searchText: "script.js.common._test", now: fixedNowIso });
        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].level).to.equal("info");
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

    it("should keep gzip effective for normal searches even when includeGzip is false", async () => {
        const ts = toLogTs(fixedNow);
        const gzBuffer = zlib.gzipSync(Buffer.from(`${ts} - debug: host.b from gzip`, "utf8"));
        await fs.writeFile(path.join(tempDir, "iobroker.2026-05-27.log.gz"), gzBuffer);

        const result = await searchLogs({ logDirectory: tempDir, includeGzip: false, level: "debug", now: fixedNow });
        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].message).to.equal("from gzip");
    });


    it("should stream a normal text log and return a cursor", async () => {
        const ts = toLogTs(new Date(fixedNow.getTime() - 5 * 60 * 1000));
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), `${ts} - info: host.a streamed text hit`, "utf8");

        const result = await searchLogs({ logDirectory: tempDir, searchText: "streamed text", now: fixedNow });
        const stats = await fs.stat(path.join(tempDir, "iobroker.current.log"));

        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].message).to.equal("streamed text hit");
        expect(result.cursor).to.include({ file: "iobroker.current.log", byteOffset: stats.size, size: stats.size });
        expect(result.cursor.mtimeMs).to.equal(stats.mtimeMs);
    });

    it("should stream a gzip log and find matches", async () => {
        const ts = toLogTs(new Date(fixedNow.getTime() - 5 * 60 * 1000));
        const gzBuffer = zlib.gzipSync(Buffer.from(`${ts} - warn: host.gz streamed gzip hit`, "utf8"));
        await fs.writeFile(path.join(tempDir, "iobroker.2026-05-27.log.gz"), gzBuffer);

        const result = await searchLogs({ logDirectory: tempDir, level: "warn", searchText: "gzip hit", now: fixedNow });

        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].message).to.equal("streamed gzip hit");
    });

    it("should read only new active log lines from cursor byteOffset", async () => {
        const firstTs = toLogTs(new Date(fixedNow.getTime() - 10 * 60 * 1000));
        const secondTs = toLogTs(new Date(fixedNow.getTime() - 5 * 60 * 1000));
        const firstLine = `${firstTs} - info: host.a first line\n`;
        const filePath = path.join(tempDir, "iobroker.current.log");
        await fs.writeFile(filePath, firstLine, "utf8");
        const initialStats = await fs.stat(filePath);
        await fs.appendFile(filePath, `${secondTs} - info: host.a second line\n`, "utf8");

        const result = await searchLogs({
            logDirectory: tempDir,
            activeOnly: true,
            cursor: { file: "iobroker.current.log", byteOffset: initialStats.size, lineNumber: 1, size: initialStats.size, mtimeMs: initialStats.mtimeMs },
            now: fixedNow,
        });
        const endStats = await fs.stat(filePath);

        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].message).to.equal("second line");
        expect(result.cursor.byteOffset).to.equal(endStats.size);
        expect(result.cursor.lineNumber).to.equal(2);
    });

    it("should restart activeOnly from beginning after rotation or truncation", async () => {
        const ts = toLogTs(new Date(fixedNow.getTime() - 5 * 60 * 1000));
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), `${ts} - error: host.a after rotation`, "utf8");

        const result = await searchLogs({
            logDirectory: tempDir,
            activeOnly: true,
            cursor: { file: "iobroker.current.log", byteOffset: 9999, lineNumber: 20, size: 9999, mtimeMs: 1 },
            now: fixedNow,
        });

        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(1);
        expect(result.rows[0].message).to.equal("after rotation");
        expect(result.cursor.lineNumber).to.equal(1);
    });

    it("should not use gzip files for activeOnly searches", async () => {
        const ts = toLogTs(new Date(fixedNow.getTime() - 5 * 60 * 1000));
        const gzBuffer = zlib.gzipSync(Buffer.from(`${ts} - info: host.gz archived`, "utf8"));
        await fs.writeFile(path.join(tempDir, "iobroker.2026-05-27.log.gz"), gzBuffer);

        const result = await searchLogs({ logDirectory: tempDir, activeOnly: true, searchText: "archived", now: fixedNow });

        expect(result.ok).to.equal(true);
        expect(result.rows).to.have.length(0);
        expect(result.cursor).to.equal(null);
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

        const result = await searchLogs({ logDirectory: tempDir, level: /** @type {any} */ (""), hours: 0, now: fixedNow });
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

    it("should call debugLog with compact diagnostics", async () => {
        const recent = toLogTs(new Date(fixedNow.getTime() - 10 * 60 * 1000));
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), `${recent} - info: host.a debug check`, "utf8");

        const debugMessages = [];
        const result = await searchLogs({
            logDirectory: tempDir,
            now: fixedNow,
            debugLog: message => debugMessages.push(message),
        });

        expect(result.ok).to.equal(true);
        expect(debugMessages.some(message => message.startsWith("Log search start:"))).to.equal(true);
        expect(debugMessages.some(message => message.startsWith("Log search files:"))).to.equal(true);
        expect(debugMessages.some(message => message.startsWith("Log search file:"))).to.equal(true);
        expect(debugMessages.some(message => message.startsWith("Log search done:"))).to.equal(true);
    });

    it("should limit unparsed sample debug lines to three entries", async () => {
        const invalidLines = [
            "broken line one",
            "broken line two",
            "broken line three",
            "broken line four",
            "broken line five",
        ].join("\n");
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), invalidLines, "utf8");

        const debugMessages = [];
        await searchLogs({
            logDirectory: tempDir,
            now: fixedNow,
            debugLog: message => debugMessages.push(message),
        });

        const sampleMessages = debugMessages.filter(message => message.startsWith("Log search sample unparsed:"));
        expect(sampleMessages).to.have.length(3);
        expect(sampleMessages[0]).to.match(/len=\d+, line="/);
    });

    it("should ignore empty lines for rejected format and unparsed samples", async () => {
        const content = ["", "   ", "\t", "broken line", ""].join("\n");
        await fs.writeFile(path.join(tempDir, "iobroker.current.log"), content, "utf8");

        const debugMessages = [];
        await searchLogs({
            logDirectory: tempDir,
            now: fixedNow,
            debugLog: message => debugMessages.push(message),
        });

        const fileMessage = debugMessages.find(message => message.startsWith("Log search file:"));
        expect(fileMessage).to.include("rejected_format=1");
        const sampleMessages = debugMessages.filter(message => message.startsWith("Log search sample unparsed:"));
        expect(sampleMessages).to.have.length(1);
    });

});
