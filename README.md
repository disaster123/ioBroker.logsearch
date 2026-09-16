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
- Clears the table with **From now** and shows only new matching entries until **Show history** is selected.

The text filter is a plain, case-insensitive substring search across the complete log line. It is not a regular expression.

## Requirements

- Node.js 22 or newer
- js-controller 6.0.11 or newer
- Admin 7.6.20 or newer

## Installation

The adapter is published on [npm](https://www.npmjs.com/package/iobroker.logsearch). Inclusion in the official ioBroker adapter catalog is pending.

Once included, select **Log Search** in ioBroker Admin's adapter catalog and add an instance.

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

Results are ordered newest first and show timestamp, level, source, and message. **Clear filter** clears the text filter.

**From now** immediately empties the table and starts watching for new entries. It keeps the current filters and does not delete any log files. The start point is set using the adapter's clock and remains active when searching again, changing filters, or reconnecting. Click **From now** again to start over, or **Show history** to include older entries within the selected time range again. Reloading the page also returns to the normal history view.

## Development

```bash
npm ci
npm run lint
npm run check
npm test
npm run build
```

CI runs linting and JavaScript type checking on Node.js 24, then executes adapter tests on Node.js 22, 24, and 26 across Linux, Windows, and macOS.

### Preparing a release

Use Node.js 24 and `npm ci` for releases. Update the version in `package.json`, `io-package.json`, and both root version fields in `package-lock.json`, along with the changelog and translated release notes. Generated files in `admin/build` are intentionally not committed.

Push the complete source commit and wait for its **Test and Release** workflow to pass. CI rebuilds the Admin interface for every pull request and release. Dependency updates only commit the updated package lock; CI verifies that the UI can still be built from it.

Create an annotated `v<version>` tag on that exact verified commit and push only that tag. Avoid CI-skip instructions in release commit messages. Tag runs verify that the tag and all package version fields agree. The publishing job builds the Admin interface immediately before publishing through npm Trusted Publishing and creating the GitHub release. Never move an existing published release tag.

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- (@disaster123) Add a From now button to hide old log entries.
- (@disaster123) Verify committed Admin assets and release versions before publishing; remove background asset commits.

### 0.0.2 (2026-09-15)

- (@disaster123) Update documentation for the npm publication and prepare automated releases.

### 0.0.1

- (@Disaster123) Initial release.

Older entries will be archived in [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

## License

MIT License

Copyright (c) 2026 Disaster123 <stefan-iobroker@prie.be>

See [LICENSE](LICENSE) for the full license text.
