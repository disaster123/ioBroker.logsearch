import React from "react";
import { withStyles } from "@material-ui/core/styles";
import GenericApp from "@iobroker/adapter-react/GenericApp";
import LogSearchTab from "./components/logSearchTab";

const styles = () => ({ root: {} });

class TabApp extends GenericApp {
    constructor(props) {
        const extendedProps = {
            ...props,
            encryptedFields: [],
            translations: {
                "en": require("./i18n/en.json"),
                "de": require("./i18n/de.json"),
                "ru": require("./i18n/ru.json"),
                "pt": require("./i18n/pt.json"),
                "nl": require("./i18n/nl.json"),
                "fr": require("./i18n/fr.json"),
                "it": require("./i18n/it.json"),
                "es": require("./i18n/es.json"),
                "pl": require("./i18n/pl.json"),
                "uk": require("./i18n/uk.json"),
                "zh-cn": require("./i18n/zh-cn.json"),
            },
        };
        super(props, extendedProps);
    }

    getInstanceFromUrl() {
        const query = new URLSearchParams(window.location.search);
        const instance = query.get("instance");
        const adapter = query.get("adapter");

        const normalize = value => {
            if (!value) {
                return null;
            }
            if (/^logsearch\.\d+$/.test(value)) {
                return value;
            }
            if (/^\d+$/.test(value)) {
                return `logsearch.${value}`;
            }
            return null;
        };

        return normalize(instance) || normalize(adapter) || "logsearch.0";
    }

    render() {
        if (!this.state.loaded) {
            return super.render();
        }
        const instance = this.getInstanceFromUrl();
        return (
            <div className="App">
                <LogSearchTab
                    defaultHours={this.state.native?.defaultHours}
                    defaultMaxRows={this.state.native?.defaultMaxRows}
                    includeGzip={this.state.native?.includeGzip}
                    sendTo={(command, message) => this.socket.sendTo(instance, command, message)}
                />
            </div>
        );
    }
}

export default withStyles(styles)(TabApp);
