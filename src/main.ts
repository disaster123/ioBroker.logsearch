/*
 * Created with @iobroker/create-adapter v2.6.5
 */
import { Adapter, controllerDir, getAbsoluteDefaultDataDir, type AdapterOptions } from '@iobroker/adapter-core';

import { describeLogLocation, detectLogLocation } from './lib/logDirectory';
import { handleMessage } from './lib/messages';
import type { LogLocation } from './lib/types';

export class Logsearch extends Adapter {
    /** Detected once on start-up: changing the log configuration requires a controller restart anyway. */
    #location: LogLocation | null = null;

    public constructor(options?: Partial<AdapterOptions>) {
        super({
            ...options,
            name: 'logsearch',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /** Where the ioBroker log files are and how they are named. */
    public getLogLocation(): LogLocation {
        if (!this.#location) {
            let dataDir: string | undefined;
            try {
                dataDir = getAbsoluteDefaultDataDir();
            } catch {
                dataDir = undefined;
            }

            this.#location = detectLogLocation({
                configuredDirectory: this.config.logDirectory,
                controllerDir,
                dataDir,
            });

            if (this.config.logDirectory && this.#location.source !== 'manual') {
                this.log.warn(
                    `The configured log directory "${this.config.logDirectory}" does not exist. Falling back to the automatic detection.`,
                );
            }
        }
        return this.#location;
    }

    /** Is called when databases are connected and the adapter received its configuration. */
    private async onReady(): Promise<void> {
        const location = this.getLogLocation();
        this.log.info(
            `Searching ${location.prefix}.<date>${location.extension} in ${location.directory} (detected via ${location.source})`,
        );

        const info = describeLogLocation(location);
        if (!info.readable) {
            this.log.error(`Cannot read the log directory ${location.directory}`);
        } else if (!info.files) {
            this.log.warn(`No log files found in ${location.directory}`);
        } else {
            this.log.debug(`Found ${info.files} log file(s) in ${location.directory}`);
        }

        return Promise.resolve();
    }

    /**
     * Some message was sent to this instance over the message box.
     *
     * @param obj Received ioBroker message.
     */
    private async onMessage(obj: ioBroker.Message): Promise<void> {
        await handleMessage(this, obj, { getLocation: () => this.getLogLocation() });
    }

    /**
     * Is called when the adapter shuts down - the callback has to be called under any circumstances.
     *
     * @param callback Completion callback.
     */
    private onUnload(callback: () => void): void {
        try {
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new Logsearch(options);
} else {
    // otherwise start the instance directly
    (() => new Logsearch())();
}
