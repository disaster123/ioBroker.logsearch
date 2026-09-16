"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_DEFAULT_DIRECTORY = void 0;
exports.getLogDirCandidates = getLogDirCandidates;
exports.getConfigFileCandidates = getConfigFileCandidates;
exports.resolveTransportLocation = resolveTransportLocation;
exports.getActiveLogFileName = getActiveLogFileName;
exports.getDatedLogFileRegExp = getDatedLogFileRegExp;
exports.detectLogLocation = detectLogLocation;
exports.describeLogLocation = describeLogLocation;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/** Default log file prefix of js-controller (`log/${appName}`). */
const DEFAULT_PREFIX = 'iobroker';
/** Default extension js-controller appends when the configured filename has none. */
const DEFAULT_EXTENSION = '.log';
/** The value this adapter used to ship as `native.logDirectory`. */
exports.LEGACY_DEFAULT_DIRECTORY = '/opt/iobroker/log';
function toPosix(path) {
    return path.replace(/\\/g, '/');
}
/**
 * js-controller resolves relative log file names against the installation root for npm installations
 * and against the controller directory itself when it runs from its own repository.
 * See `isNpm` in `packages/common-db/src/lib/common/logger.ts`.
 *
 * @param controllerDir Root directory of js-controller.
 */
function isNpmInstallation(controllerDir) {
    return !toPosix(controllerDir).toLowerCase().includes('iobroker.js-controller/packages/');
}
/**
 * Candidate directories for a relative log path, in the order js-controller itself tries them
 * in the `getLogFiles` host command (`packages/controller/src/main.ts`): it walks up from the
 * controller directory and takes the first one that exists.
 *
 * @param relativeDir Directory part of the configured `filename`, e.g. `log`.
 * @param controllerDir Root directory of js-controller.
 */
function getLogDirCandidates(relativeDir, controllerDir) {
    const candidates = [];
    const parts = ['..', '..', '..', '..'];
    do {
        parts.pop();
        candidates.push((0, node_path_1.normalize)(`${controllerDir}/${parts.join('/')}/${relativeDir}`));
    } while (parts.length);
    return candidates;
}
/** Resolve `controllerDir` lazily, so that this module stays usable without a js-controller. */
function resolveControllerDir() {
    try {
        // Importing this at the top level terminates the process when no js-controller is installed.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const utils = require('@iobroker/adapter-core');
        return utils.controllerDir || '';
    }
    catch {
        return '';
    }
}
/**
 * Candidate locations of `iobroker.json`, preferring the data directory resolved by js-controller.
 *
 * @param controllerDir Root directory of js-controller.
 * @param dataDir Absolute data directory provided by adapter-core, including custom controller paths.
 */
function getConfigFileCandidates(controllerDir, dataDir) {
    const candidates = [];
    if (dataDir) {
        candidates.push((0, node_path_1.join)(dataDir, 'iobroker.json'));
    }
    if (controllerDir) {
        // npm installation: <root>/iobroker-data/iobroker.json
        candidates.push((0, node_path_1.normalize)((0, node_path_1.join)(controllerDir, '..', '..', 'iobroker-data', 'iobroker.json')));
        // development checkout
        candidates.push((0, node_path_1.join)(controllerDir, 'conf', 'iobroker.json'));
        candidates.push((0, node_path_1.join)(controllerDir, 'data', 'iobroker.json'));
    }
    return candidates;
}
/**
 * Derive directory and file naming from the `log.transport` section of `iobroker.json`.
 *
 * Both file naming and relative path resolution follow the transport preparation in `logger.ts`.
 * Existing directories must not override this configured destination: they may contain stale logs
 * or belong to another installation. Probing is only a fallback when no transport can be resolved.
 *
 * @param config Parsed content of `iobroker.json`.
 * @param controllerDir Root directory of js-controller.
 */
function resolveTransportLocation(config, controllerDir) {
    const transports = config?.log?.transport;
    if (!transports || typeof transports !== 'object') {
        return null;
    }
    for (const transport of Object.values(transports)) {
        if (!transport || typeof transport !== 'object') {
            continue;
        }
        if (transport.type !== 'file' || transport.enabled === false) {
            continue;
        }
        const configured = typeof transport.filename === 'string' && transport.filename ? transport.filename : `log/${DEFAULT_PREFIX}`;
        const filename = toPosix(configured);
        const isAbsolute = /^\w:\/|^\//.test(filename);
        const prefix = (0, node_path_1.basename)(filename);
        // js-controller only appends ".log" when the configured name does not already end with it
        let extension;
        if (typeof transport.fileext === 'string' && transport.fileext) {
            extension = transport.fileext;
        }
        else {
            extension = prefix.toLowerCase().endsWith('.log') ? '' : DEFAULT_EXTENSION;
        }
        const naming = { prefix, extension };
        if (isAbsolute) {
            return { ...naming, directory: (0, node_path_1.dirname)((0, node_path_1.normalize)(filename)) };
        }
        // Use the logger's destination even before it exists or contains any log files.
        return {
            ...naming,
            directory: (0, node_path_1.dirname)((0, node_path_1.normalize)(`${controllerDir}${isNpmInstallation(controllerDir) ? '/../../' : '/'}${filename}`)),
        };
    }
    return null;
}
/**
 * Name of the symlink js-controller keeps pointing at the currently written file.
 *
 * @param location The log location, only `prefix` is used.
 */
function getActiveLogFileName(location) {
    // logger.ts: symlinkName = basename(`${filename}.current.log`) - always ".log", regardless of fileext
    return `${location.prefix}.current.log`;
}
/**
 * Regular expression matching the rotated (optionally gzipped) log files of a location.
 * js-controller always rotates with `datePattern: 'YYYY-MM-DD'`.
 *
 * @param location The log location, `prefix` and `extension` are used.
 */
function getDatedLogFileRegExp(location) {
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escape(location.prefix)}\\.(\\d{4})-(\\d{2})-(\\d{2})${escape(location.extension)}(\\.gz)?$`);
}
/**
 * Count the files in a directory that match the naming scheme of a location.
 *
 * @param directory Directory to look into.
 * @param location Naming scheme to match against.
 * @param readDir Directory reader.
 */
function countLogFiles(directory, location, readDir) {
    const dated = getDatedLogFileRegExp(location);
    const active = getActiveLogFileName(location);
    let found = 0;
    for (const name of readDir(directory)) {
        if (name === active || dated.test(name)) {
            found++;
        }
    }
    return found;
}
/**
 * Determine where the ioBroker log files are and how they are named.
 *
 * The configured directory always wins, with one exception: the obsolete default `/opt/iobroker/log`
 * is ignored when it does not exist, because earlier versions wrote it into every instance.
 *
 * @param options Detection inputs and injectable file system access.
 */
function detectLogLocation(options = {}) {
    const exists = options.exists || ((path) => (0, node_fs_1.existsSync)(path));
    const readFile = options.readFile || ((path) => (0, node_fs_1.readFileSync)(path, 'utf8'));
    const readDir = options.readDir || ((path) => (0, node_fs_1.readdirSync)(path));
    const controllerDir = options.controllerDir === undefined ? resolveControllerDir() : options.controllerDir;
    const probe = (directory, naming) => {
        if (!exists(directory)) {
            return 'no';
        }
        try {
            return countLogFiles(directory, naming, readDir) > 0 ? 'files' : 'exists';
        }
        catch {
            return 'exists';
        }
    };
    let fromConfig = null;
    for (const candidate of getConfigFileCandidates(controllerDir, options.dataDir)) {
        if (!exists(candidate)) {
            continue;
        }
        try {
            fromConfig = resolveTransportLocation(JSON.parse(readFile(candidate)), controllerDir);
        }
        catch {
            fromConfig = null;
        }
        if (fromConfig) {
            break;
        }
    }
    const configured = typeof options.configuredDirectory === 'string' ? options.configuredDirectory.trim() : '';
    if (configured) {
        const isObsoleteDefault = toPosix((0, node_path_1.normalize)(configured)) === exports.LEGACY_DEFAULT_DIRECTORY;
        if (!isObsoleteDefault || exists(configured)) {
            return {
                directory: (0, node_path_1.normalize)(configured),
                prefix: fromConfig ? fromConfig.prefix : DEFAULT_PREFIX,
                extension: fromConfig ? fromConfig.extension : DEFAULT_EXTENSION,
                source: 'manual',
            };
        }
    }
    if (fromConfig) {
        return { ...fromConfig, source: 'controller-config' };
    }
    // no readable iobroker.json: fall back to the default location `log/` next to the installation
    const naming = { prefix: DEFAULT_PREFIX, extension: DEFAULT_EXTENSION };
    const candidates = [
        options.dataDir ? (0, node_path_1.normalize)((0, node_path_1.join)(options.dataDir, '..', 'log')) : '',
        ...(controllerDir ? getLogDirCandidates('log', controllerDir) : []),
        exports.LEGACY_DEFAULT_DIRECTORY,
    ].filter(candidate => !!candidate);
    const withFiles = candidates.find(candidate => probe(candidate, naming) === 'files');
    if (withFiles) {
        return { ...naming, directory: withFiles, source: 'probe' };
    }
    const existing = candidates.find(candidate => probe(candidate, naming) !== 'no');
    if (existing) {
        return { ...naming, directory: existing, source: 'probe' };
    }
    return { ...naming, directory: candidates[0], source: 'fallback' };
}
/**
 * Collect the information the admin UI shows about the detected location.
 *
 * @param location The detected log location.
 * @param readDir Optional directory reader, for tests.
 */
function describeLogLocation(location, readDir = (path) => (0, node_fs_1.readdirSync)(path)) {
    try {
        return { readable: true, files: countLogFiles(location.directory, location, readDir) };
    }
    catch {
        return { readable: false, files: 0 };
    }
}
//# sourceMappingURL=logDirectory.js.map