import React from "react";
import ReactDOM from "react-dom";
import { MuiThemeProvider } from "@material-ui/core/styles";
import theme from "@iobroker/adapter-react/Theme";
import Utils from "@iobroker/adapter-react/Components/Utils";
import App from "./app";
import TabApp from "./tabApp";

let themeName = Utils.getThemeName();

function build() {
    ReactDOM.render(
        <MuiThemeProvider theme={theme(themeName)}>
            {window.location.pathname.endsWith("/tab_m.html") ? (
                <TabApp
                    adapterName="logsearch"
                    onThemeChange={(_theme) => {
                        themeName = _theme;
                        build();
                    }}
                />
            ) : (
                <App
                    adapterName="logsearch"
                    onThemeChange={(_theme) => {
                        themeName = _theme;
                        build();
                    }}
                />
            )}
        </MuiThemeProvider>,
        document.getElementById("root"),
    );
}

build();
