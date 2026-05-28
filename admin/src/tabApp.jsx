import React from "react";
import { withStyles } from "@material-ui/core/styles";
import Connection from "@iobroker/adapter-react/Connection";
import LogSearchTab from "./components/logSearchTab";

const styles = () => ({ root: {} });

class TabApp extends React.Component {
    constructor(props) {
        super(props);
        this.socket = new Connection(props);
        this.state = {
            socketReady: false,
        };

        this.onConnectionChange = connected => {
            this.setState({ socketReady: connected });
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
                <LogSearchTab
                    defaultHours={6}
                    defaultMaxRows={500}
                    includeGzip={true}
                    sendTo={this.sendTo}
                />
            </div>
        );
    }
}

export default withStyles(styles)(TabApp);
