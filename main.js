"use strict";

/*
 * Created with @iobroker/create-adapter v2.6.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const { searchLogs } = require("./lib/log-search");

// Load your modules here, e.g.:
// const fs = require("fs");

class Logsearch extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "logsearch",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on("objectChange", this.onObjectChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.log.debug("Adapter started");
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            // clearTimeout(timeout2);
            // ...
            // clearInterval(interval1);

            callback();
        } catch (e) {
            callback();
        }
    }

    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    //  * @param {string} id
    //  * @param {ioBroker.Object | null | undefined} obj
    //  */
    // onObjectChange(id, obj) {
    //     if (obj) {
    //         // The object was changed
    //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    //     } else {
    //         // The object was deleted
    //         this.log.info(`object ${id} deleted`);
    //     }
    // }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    /**
     * Some message was sent to this instance over message box.
     * @param {ioBroker.Message} obj
     */
    async onMessage(obj) {
        if (!obj || obj.command !== "searchLogs") {
            return;
        }

        const message = typeof obj.message === "object" && obj.message !== null ? obj.message : {};
        const includeGzipValue = message.includeGzip;
        let includeGzip = this.config.includeGzip !== false;
        if (typeof includeGzipValue === "boolean") {
            includeGzip = includeGzipValue;
        } else if (typeof includeGzipValue === "string") {
            if (includeGzipValue === "true") {
                includeGzip = true;
            } else if (includeGzipValue === "false") {
                includeGzip = false;
            }
        } else if (typeof includeGzipValue === "number") {
            if (includeGzipValue === 0) {
                includeGzip = false;
            } else if (includeGzipValue === 1) {
                includeGzip = true;
            }
        }

        const options = {
            logDirectory: typeof this.config.logDirectory === "string" ? this.config.logDirectory : "/opt/iobroker/log",
            searchText: String(message.searchText ?? ""),
            hours: Number(message.hours ?? this.config.defaultHours ?? 6),
            level: typeof message.level === "string" ? message.level : "all",
            maxRows: Number(message.maxRows ?? this.config.defaultMaxRows ?? 500),
            includeGzip,
            debugLog: message => this.log.debug(message),
        };

        try {
            const result = await searchLogs(options);
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, result, obj.callback);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log.error(`searchLogs failed: ${errorMessage}`);
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, { ok: false, error: errorMessage }, obj.callback);
            }
        }
    }

}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Logsearch(options);
} else {
    // otherwise start the instance directly
    new Logsearch();
}
