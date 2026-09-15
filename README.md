![Logo](admin/logsearch.png)

# ioBroker.logsearch

[![Test and Release](https://github.com/disaster123/ioBroker.logsearch/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/disaster123/ioBroker.logsearch/actions/workflows/test-and-release.yml)

Search ioBroker log files directly in the Admin interface by time range, level, and text.

## Features

- Searches the active ioBroker log and rotated `iobroker.YYYY-MM-DD.log` files.
- Transparently reads gzip-compressed historical logs.
- Filters by a case-insensitive text fragment and the levels `error`, `warn`, `info`, `debug`, or `silly`.
- Limits the result count and clearly indicates truncated results.
- Refreshes the active log every five seconds after a search.
- Resynchronizes after the browser tab, network connection, or Admin socket resumes.
- Keeps duplicate physical log lines as separate results.

The text filter is a plain, case-insensitive substring search across the complete log line. It is not a regular expression.

## Requirements

- Node.js 22 or newer
- js-controller 6.0.11 or newer
- Admin 7.6.20 or newer

## Installation

The adapter is currently in development and is not yet published on npm. Install it through ioBroker Admin's custom installation dialog using this GitHub URL:

```text
https://github.com/disaster123/ioBroker.logsearch
```

## Configuration

| Setting | Default | Description |
|---|---:|---|
| Log directory | `/opt/iobroker/log` | Directory containing the ioBroker log files. |
| Default hours | `72` | Initial time range used by the Log Search tab. |
| Default max rows | `500` | Initial maximum number of rows returned. |

The adapter enforces an absolute maximum of 5,000 rows per request. The configured log directory is used server-side; a client cannot override it in a search request.

## Usage

1. Open the **Log Search** tab in ioBroker Admin.
2. Enter an optional text fragment and choose the time range, level, and row limit.
3. Select **Search**. Changing a filter automatically starts a new search after a short delay.
4. Leave the tab open to receive new matching entries automatically.

Results are ordered newest first and show timestamp, level, source, and message. **Clear filter** restores the configured defaults.

## Development

```bash
npm ci
npm run lint
npm run check
npm test
npm run build
```

CI runs linting and JavaScript type checking on Node.js 24, then executes adapter tests on Node.js 22, 24, and 26 across Linux, Windows, and macOS.

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- (@disaster123) Modernize testing, repository metadata, and release automation.

### 0.0.1

- (@Disaster123) Initial release.

## License

MIT License

Copyright (c) 2026 Disaster123 <stefan-iobroker@prie.be>

See [LICENSE](LICENSE) for the full license text.
