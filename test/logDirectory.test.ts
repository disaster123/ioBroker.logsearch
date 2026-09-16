import { expect } from 'chai';
import { normalize } from 'node:path';

import {
    describeLogLocation,
    detectLogLocation,
    getActiveLogFileName,
    getDatedLogFileRegExp,
    getLogDirCandidates,
    type DetectLogLocationOptions,
} from '../src/lib/logDirectory';

const NPM_CONTROLLER_DIR = '/opt/iobroker/node_modules/iobroker.js-controller';
const DEV_CONTROLLER_DIR = '/home/dev/ioBroker.js-controller/packages/controller';

function toPosix(value: string): string {
    return value.replace(/\\/g, '/');
}

interface Fixture {
    /** Existing files and directories, given with forward slashes. */
    files?: string[];
    /** Directory content by posix path. */
    dirs?: Record<string, string[]>;
    /** `iobroker.json` content by posix path. */
    configs?: Record<string, unknown>;
}

/** Build injectable file system access from a declarative fixture. */
function fs(fixture: Fixture): Pick<DetectLogLocationOptions, 'exists' | 'readFile' | 'readDir'> {
    const configs = fixture.configs || {};
    const dirs = fixture.dirs || {};
    const existing = new Set([...(fixture.files || []), ...Object.keys(configs), ...Object.keys(dirs)]);

    return {
        exists: path => existing.has(toPosix(normalize(path))) || existing.has(toPosix(path)),
        readFile: path => {
            const key = toPosix(normalize(path));
            if (!(key in configs)) {
                throw new Error(`ENOENT: ${key}`);
            }
            return JSON.stringify(configs[key]);
        },
        readDir: path => {
            const key = toPosix(normalize(path));
            if (!(key in dirs)) {
                throw new Error(`ENOENT: ${key}`);
            }
            return dirs[key];
        },
    };
}

/** Minimal `iobroker.json` with a single file transport. */
function config(transport: Record<string, unknown> = {}): unknown {
    return { log: { level: 'info', transport: { file1: { type: 'file', enabled: true, ...transport } } } };
}

describe('logDirectory detection', () => {
    it('resolves the default transport of an npm installation against the installation root', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            env: {},
            ...fs({ configs: { '/opt/iobroker/iobroker-data/iobroker.json': config() } }),
        });

        expect(location).to.deep.equal({
            directory: normalize('/opt/iobroker/log'),
            prefix: 'iobroker',
            extension: '.log',
            source: 'controller-config',
        });
    });

    it('walks up from the controller directory like the getLogFiles host command', () => {
        // js-controller tries <controllerDir>/../../../, /../../, /../ and / in that order
        expect(getLogDirCandidates('log', NPM_CONTROLLER_DIR).map(toPosix)).to.deep.equal([
            '/opt/log',
            '/opt/iobroker/log',
            '/opt/iobroker/node_modules/log',
            '/opt/iobroker/node_modules/iobroker.js-controller/log',
        ]);
    });

    it('prefers the walk-up candidate that actually holds log files', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            env: {},
            ...fs({
                configs: { '/opt/iobroker/iobroker-data/iobroker.json': config() },
                dirs: {
                    // exists, but holds nothing that looks like an ioBroker log
                    '/opt/log': ['other.txt'],
                    '/opt/iobroker/log': ['iobroker.current.log', 'iobroker.2026-09-15.log'],
                },
            }),
        });

        expect(location.directory).to.equal(normalize('/opt/iobroker/log'));
        expect(location.source).to.equal('controller-config');
    });

    it('keeps the order of js-controller when no candidate holds log files', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            env: {},
            ...fs({
                configs: { '/opt/iobroker/iobroker-data/iobroker.json': config() },
                dirs: { '/opt/log': [], '/opt/iobroker/log': [] },
            }),
        });

        expect(location.directory).to.equal(normalize('/opt/log'));
    });

    it('finds the log directory of a development checkout by walking up', () => {
        const location = detectLogLocation({
            controllerDir: DEV_CONTROLLER_DIR,
            env: {},
            ...fs({
                configs: { [`${DEV_CONTROLLER_DIR}/conf/iobroker.json`]: config() },
                dirs: { [`${DEV_CONTROLLER_DIR}/log`]: ['iobroker.current.log'] },
            }),
        });

        expect(location.directory).to.equal(normalize(`${DEV_CONTROLLER_DIR}/log`));
    });

    it('resolves a relative transport of a development checkout against the controller directory', () => {
        const location = detectLogLocation({
            controllerDir: DEV_CONTROLLER_DIR,
            env: {},
            ...fs({ configs: { [`${DEV_CONTROLLER_DIR}/conf/iobroker.json`]: config() } }),
        });

        expect(location.directory).to.equal(normalize(`${DEV_CONTROLLER_DIR}/log`));
        expect(location.source).to.equal('controller-config');
    });

    it('keeps an absolute posix filename', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            env: {},
            ...fs({
                configs: {
                    '/opt/iobroker/iobroker-data/iobroker.json': config({ filename: '/var/log/iobroker/iob' }),
                },
            }),
        });

        expect(location.directory).to.equal(normalize('/var/log/iobroker'));
        expect(location.prefix).to.equal('iob');
        expect(location.extension).to.equal('.log');
    });

    it('keeps an absolute windows filename', () => {
        const location = detectLogLocation({
            controllerDir: 'C:/iobroker/node_modules/iobroker.js-controller',
            env: {},
            ...fs({
                configs: {
                    'C:/iobroker/iobroker-data/iobroker.json': config({ filename: 'D:\\logs\\iobroker' }),
                },
            }),
        });

        expect(toPosix(location.directory)).to.equal('D:/logs');
        expect(location.prefix).to.equal('iobroker');
    });

    it('uses a custom filename and file extension', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            env: {},
            ...fs({
                configs: {
                    '/opt/iobroker/iobroker-data/iobroker.json': config({ filename: 'logs/mylog', fileext: '.txt' }),
                },
            }),
        });

        expect(location.directory).to.equal(normalize('/opt/iobroker/logs'));
        expect(location.prefix).to.equal('mylog');
        expect(location.extension).to.equal('.txt');
        expect(getDatedLogFileRegExp(location).test('mylog.2026-09-16.txt')).to.equal(true);
        expect(getDatedLogFileRegExp(location).test('mylog.2026-09-16.txt.gz')).to.equal(true);
        expect(getDatedLogFileRegExp(location).test('mylog.2026-09-16.log')).to.equal(false);
        // the symlink of js-controller always ends with ".current.log"
        expect(getActiveLogFileName(location)).to.equal('mylog.current.log');
    });

    it('adds no extension when the filename already ends with .log', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            env: {},
            ...fs({
                configs: {
                    '/opt/iobroker/iobroker-data/iobroker.json': config({ filename: 'log/iobroker.log' }),
                },
            }),
        });

        expect(location.prefix).to.equal('iobroker.log');
        expect(location.extension).to.equal('');
        expect(getDatedLogFileRegExp(location).test('iobroker.log.2026-09-16')).to.equal(true);
        expect(getActiveLogFileName(location)).to.equal('iobroker.log.current.log');
    });

    it('reads the config from IOBROKER_DATA_DIR', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            env: { IOBROKER_DATA_DIR: '/mnt/data' },
            ...fs({
                configs: {
                    '/mnt/data/iobroker.json': config({ filename: 'log/fromenv' }),
                    // must not win over the environment
                    '/opt/iobroker/iobroker-data/iobroker.json': config({ filename: 'log/fromroot' }),
                },
            }),
        });

        expect(location.prefix).to.equal('fromenv');
    });

    it('skips disabled and non-file transports', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            env: {},
            ...fs({
                configs: {
                    '/opt/iobroker/iobroker-data/iobroker.json': {
                        log: {
                            transport: {
                                syslog1: { type: 'syslog', enabled: true, filename: 'log/ignored' },
                                file1: { type: 'file', enabled: false, filename: 'log/disabled' },
                                file2: { type: 'file', enabled: true, filename: 'log/active' },
                            },
                        },
                    },
                },
            }),
        });

        expect(location.prefix).to.equal('active');
    });

    it('prefers the configured directory over the detected one', () => {
        const location = detectLogLocation({
            configuredDirectory: '  /mnt/logs  ',
            controllerDir: NPM_CONTROLLER_DIR,
            env: {},
            ...fs({
                files: ['/mnt/logs'],
                configs: { '/opt/iobroker/iobroker-data/iobroker.json': config({ fileext: '.txt' }) },
            }),
        });

        expect(location.directory).to.equal(normalize('/mnt/logs'));
        expect(location.source).to.equal('manual');
        // the naming still comes from the controller configuration
        expect(location.extension).to.equal('.txt');
    });

    it('keeps a configured directory that does not exist', () => {
        const location = detectLogLocation({
            configuredDirectory: '/mnt/typo',
            controllerDir: NPM_CONTROLLER_DIR,
            env: {},
            ...fs({ configs: { '/opt/iobroker/iobroker-data/iobroker.json': config() } }),
        });

        expect(location.directory).to.equal(normalize('/mnt/typo'));
        expect(location.source).to.equal('manual');
    });

    it('ignores the obsolete default directory when it does not exist', () => {
        const location = detectLogLocation({
            configuredDirectory: '/opt/iobroker/log',
            controllerDir: 'C:/iobroker/node_modules/iobroker.js-controller',
            env: {},
            ...fs({ configs: { 'C:/iobroker/iobroker-data/iobroker.json': config() } }),
        });

        expect(toPosix(location.directory)).to.equal('C:/iobroker/log');
        expect(location.source).to.equal('controller-config');
    });

    it('honours the obsolete default directory when it exists', () => {
        const location = detectLogLocation({
            configuredDirectory: '/opt/iobroker/log',
            controllerDir: NPM_CONTROLLER_DIR,
            env: {},
            ...fs({
                files: ['/opt/iobroker/log'],
                configs: { '/opt/iobroker/iobroker-data/iobroker.json': config() },
            }),
        });

        expect(location.source).to.equal('manual');
    });

    it('probes for a directory with matching log files when no config is readable', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            dataDir: '/opt/iobroker/iobroker-data',
            env: {},
            ...fs({
                dirs: {
                    // the data-dir sibling exists but holds nothing that looks like a log
                    '/opt/iobroker/log': ['readme.txt'],
                    '/opt/iobroker/node_modules/iobroker.js-controller/log': ['iobroker.current.log'],
                },
            }),
        });

        expect(location.directory).to.equal(normalize(`${NPM_CONTROLLER_DIR}/log`));
        expect(location.source).to.equal('probe');
    });

    it('falls back to an existing directory even without matching files', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            dataDir: '/opt/iobroker/iobroker-data',
            env: {},
            ...fs({ dirs: { '/opt/iobroker/log': ['readme.txt'] } }),
        });

        expect(location.directory).to.equal(normalize('/opt/iobroker/log'));
        expect(location.source).to.equal('probe');
    });

    it('falls back to the data directory sibling when nothing exists', () => {
        const location = detectLogLocation({
            controllerDir: NPM_CONTROLLER_DIR,
            dataDir: '/opt/iobroker/iobroker-data',
            env: {},
            ...fs({}),
        });

        expect(location.directory).to.equal(normalize('/opt/iobroker/log'));
        expect(location.source).to.equal('fallback');
    });

    it('describes a location by counting its log files', () => {
        const location = {
            directory: '/opt/iobroker/log',
            prefix: 'iobroker',
            extension: '.log',
            source: 'manual',
        } as const;

        expect(
            describeLogLocation(location, () => [
                'iobroker.current.log',
                'iobroker.2026-09-15.log',
                'iobroker.2026-09-14.log.gz',
                'iobroker.2026-09-13.log-audit.json',
                'other.txt',
            ]),
        ).to.deep.equal({ readable: true, files: 3 });

        expect(
            describeLogLocation(location, () => {
                throw new Error('EACCES');
            }),
        ).to.deep.equal({ readable: false, files: 0 });
    });
});
