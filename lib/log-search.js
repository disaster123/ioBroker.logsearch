"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const gunzip = promisify(zlib.gunzip);

const LOG_LEVELS = ["error", "warn", "info", "debug", "silly"];

/**
 * @typedef {object} SearchLogsOptions
 * @property {string} logDirectory
 * @property {string} [searchText]
 * @property {number} [hours]
 * @property {"all"|"error"|"warn"|"info"|"debug"|"silly"} [level]
 * @property {number} [maxRows]
 * @property {boolean} [includeGzip]
 */

/**
 * Parse an ioBroker log line into structured data.
 * @param {string} line
 * @returns {{ts: string, level: string, source: string, message: string, raw: string} | null}
 */
function parseLogLine(line) {
    const trimmed = line.trimEnd();
    if (!trimmed) {
        return null;
    }

    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+-\s+(\w+):\s+([^\s]+)\s+(.*)$/);
    if (!match) {
        return null;
    }

    const [, ts, level, source, message] = match;
    return { ts, level: level.toLowerCase(), source, message, raw: trimmed };
}

/**
 * @param {SearchLogsOptions} options
 */
async function searchLogs(options) {
    const {
        logDirectory,
        searchText = "",
        hours = 6,
        level = "all",
        maxRows = 500,
        includeGzip = true,
    } = options || {};

    if (!logDirectory || typeof logDirectory !== "string") {
        return { ok: false, error: "Invalid logDirectory" };
    }

    const normalizedMaxRows = Math.max(1, Math.floor(maxRows));
    const normalizedHours = Math.max(0, Number(hours) || 0);
    const searchNeedle = String(searchText || "").toLowerCase();
    const minTs = Date.now() - normalizedHours * 60 * 60 * 1000;

    let files;
    try {
        files = await fs.readdir(logDirectory, { withFileTypes: true });
    } catch (error) {
        return { ok: false, error: `Cannot read log directory: ${error.message}` };
    }

    const candidates = files
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => {
            if (name === "iobroker.current.log") {
                return true;
            }
            if (/^iobroker\.\d{4}-\d{2}-\d{2}\.log$/.test(name)) {
                return true;
            }
            if (includeGzip && /^iobroker\.\d{4}-\d{2}-\d{2}\.log\.gz$/.test(name)) {
                return true;
            }
            return false;
        })
        .sort((a, b) => a.localeCompare(b));

    const rows = [];
    for (const name of candidates) {
        if (rows.length >= normalizedMaxRows) {
            break;
        }

        const fullPath = path.join(logDirectory, name);
        let content;
        try {
            const buffer = await fs.readFile(fullPath);
            if (name.endsWith(".gz")) {
                content = (await gunzip(buffer)).toString("utf8");
            } else {
                content = buffer.toString("utf8");
            }
        } catch {
            continue;
        }

        const lines = content.split(/\r?\n/);
        for (const line of lines) {
            if (rows.length >= normalizedMaxRows) {
                break;
            }
            const parsed = parseLogLine(line);
            if (!parsed) {
                continue;
            }

            const tsDate = new Date(parsed.ts.replace(" ", "T"));
            if (Number.isNaN(tsDate.getTime()) || tsDate.getTime() < minTs) {
                continue;
            }
            if (level !== "all" && parsed.level !== level) {
                continue;
            }
            if (searchNeedle && !parsed.raw.toLowerCase().includes(searchNeedle)) {
                continue;
            }
            if (!LOG_LEVELS.includes(parsed.level)) {
                continue;
            }

            rows.push(parsed);
        }
    }

    return {
        ok: true,
        rows,
        total: rows.length,
        truncated: rows.length >= normalizedMaxRows,
    };
}

module.exports = {
    parseLogLine,
    searchLogs,
};
