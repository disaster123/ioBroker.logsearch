"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logsearch = void 0;
/*
 * Created with @iobroker/create-adapter v2.6.5
 */
const adapter_core_1 = require("@iobroker/adapter-core");
const logDirectory_1 = require("./lib/logDirectory");
const messages_1 = require("./lib/messages");
const searchHistory_1 = require("./lib/searchHistory");
class Logsearch extends adapter_core_1.Adapter {
    searchHistory = new searchHistory_1.SearchHistory(this);
    /** Detected once on start-up: changing the log configuration requires a controller restart anyway. */
    #location = null;
    constructor(options) {
        super({
            ...options,
            name: 'logsearch',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    /** Where the ioBroker log files are and how they are named. */
    getLogLocation() {
        if (!this.#location) {
            let dataDir;
            try {
                dataDir = (0, adapter_core_1.getAbsoluteDefaultDataDir)();
            }
            catch {
                dataDir = undefined;
            }
            this.#location = (0, logDirectory_1.detectLogLocation)({
                configuredDirectory: this.config.logDirectory,
                controllerDir: adapter_core_1.controllerDir,
                dataDir,
            });
            if (this.config.logDirectory && this.#location.source !== 'manual') {
                this.log.warn(`The configured log directory "${this.config.logDirectory}" does not exist. Falling back to the automatic detection.`);
            }
        }
        return this.#location;
    }
    /** Is called when databases are connected and the adapter received its configuration. */
    async onReady() {
        try {
            await this.searchHistory.get();
        }
        catch (error) {
            this.log.warn(`Cannot initialize search history: ${error}`);
        }
        const location = this.getLogLocation();
        this.log.info(`Searching ${location.prefix}.<date>${location.extension} in ${location.directory} (detected via ${location.source})`);
        const info = (0, logDirectory_1.describeLogLocation)(location);
        if (!info.readable) {
            this.log.error(`Cannot read the log directory ${location.directory}`);
        }
        else if (!info.files) {
            this.log.warn(`No log files found in ${location.directory}`);
        }
        else {
            this.log.debug(`Found ${info.files} log file(s) in ${location.directory}`);
        }
        return Promise.resolve();
    }
    /**
     * Some message was sent to this instance over the message box.
     *
     * @param obj Received ioBroker message.
     */
    async onMessage(obj) {
        await (0, messages_1.handleMessage)(this, obj, {
            getLocation: () => this.getLogLocation(),
            searchHistory: this.searchHistory,
        });
    }
    /**
     * Is called when the adapter shuts down - the callback has to be called under any circumstances.
     *
     * @param callback Completion callback.
     */
    onUnload(callback) {
        try {
            callback();
        }
        catch {
            callback();
        }
    }
}
exports.Logsearch = Logsearch;
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new Logsearch(options);
}
else {
    // otherwise start the instance directly
    (() => new Logsearch())();
}
//# sourceMappingURL=main.js.map