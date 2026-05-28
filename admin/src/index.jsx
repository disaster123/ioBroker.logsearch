import React from "react";
import ReactDOM from "react-dom";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { Theme } from "@iobroker/adapter-react-v5";
import { Utils } from "@iobroker/adapter-react-v5";
import App from "./app";
import TabApp from "./tabApp";

let themeName = Utils.getThemeName();

function build() {
    ReactDOM.render(
        <MuiThemeProvider theme={Theme(themeName)}>
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
