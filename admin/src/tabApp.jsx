import React from "react";
import { withStyles } from "@mui/styles";
import { AdminConnection } from "@iobroker/adapter-react-v5";
import LogSearchTab from "./components/logSearchTab";

const styles = () => ({ root: {} });

class TabApp extends React.Component {
    constructor(props) {
        super(props);
        this.socket = new AdminConnection(props);
        this.state = {
            socketReady: false,
            defaultHours: 72,
            defaultMaxRows: 500,
            defaultsLoaded: false,
        };
        this.defaultsLoading = false;

        this.onConnectionChange = connected => {
            this.setState({ socketReady: connected });
            if (connected) {
                this.loadInstanceDefaults();
            }
        };

        this.socket.registerConnectionHandler(this.onConnectionChange);
    }

    componentWillUnmount() {
        if (this.socket && this.onConnectionChange) {
            this.socket.unregisterConnectionHandler(this.onConnectionChange);
        }
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



    async loadInstanceDefaults() {
        if (this.defaultsLoading || this.state.defaultsLoaded) {
            return;
        }
        this.defaultsLoading = true;
        const instance = this.getInstanceFromUrl();
        const objectId = `system.adapter.${instance}`;

        try {
            const instanceObject = await this.socket.getObject(objectId);
            const defaultHours = Number(instanceObject?.native?.defaultHours);
            const defaultMaxRows = Number(instanceObject?.native?.defaultMaxRows);

            this.setState({
                defaultHours: Number.isFinite(defaultHours) && defaultHours > 0 ? defaultHours : 72,
                defaultMaxRows: Number.isFinite(defaultMaxRows) && defaultMaxRows > 0 ? defaultMaxRows : 500,
                defaultsLoaded: true,
            });
        } catch {
            this.setState({ defaultHours: 72, defaultMaxRows: 500, defaultsLoaded: true });
        } finally {
            this.defaultsLoading = false;
        }
    }
    sendTo = (command, message) => {
        if (!this.socket || !this.state.socketReady) {
            return Promise.reject(new Error("Socket connection is not ready"));
        }
        const instance = this.getInstanceFromUrl();
        return Promise.resolve(this.socket.sendTo(instance, command, message));
    };

    render() {
        return (
            <div className="App">
                {!this.state.socketReady ? <div>Connecting to ioBroker...</div> : null}
                {this.state.socketReady && !this.state.defaultsLoaded ? <div>Loading defaults...</div> : null}
                {this.state.defaultsLoaded ? (
                    <LogSearchTab
                        defaultHours={this.state.defaultHours}
                        defaultMaxRows={this.state.defaultMaxRows}
                        sendTo={this.sendTo}
                    />
                ) : null}
            </div>
        );
    }
}

export default withStyles(styles)(TabApp);
