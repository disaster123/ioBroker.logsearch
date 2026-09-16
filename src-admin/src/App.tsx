import React from 'react';

import { CssBaseline } from '@mui/material';
import { StyledEngineProvider, ThemeProvider } from '@mui/material/styles';

import {
    AdminConnection,
    GenericApp,
    I18n,
    Loader,
    ScrollbarStyles,
    type GenericAppProps,
    type GenericAppState,
} from '@iobroker/gui-components';

import LogSearchTab from './components/LogSearchTab';
import Settings from './components/Settings';
import type { LogInfoResponse } from './types';

import deLang from './i18n/de.json';
import enLang from './i18n/en.json';
import esLang from './i18n/es.json';
import frLang from './i18n/fr.json';
import itLang from './i18n/it.json';
import nlLang from './i18n/nl.json';
import plLang from './i18n/pl.json';
import ptLang from './i18n/pt.json';
import ruLang from './i18n/ru.json';
import ukLang from './i18n/uk.json';
import zhCnLang from './i18n/zh-cn.json';

const ADAPTER_NAME = 'logsearch';

interface AppState extends GenericAppState {
    /** Whether the instance is running - `sendTo` only works then. */
    alive: boolean;
    /** What the adapter reported about the log location it uses. */
    logInfo: LogInfoResponse | null;
}

export default class App extends GenericApp<GenericAppProps, AppState> {
    /** The same bundle serves the configuration dialog and the admin tab. */
    private readonly isTab: boolean =
        window.location.pathname.includes('tab_m.html') || window.location.search.includes('tab=');

    public constructor(props: GenericAppProps) {
        const extendedProps: GenericAppProps = { ...props };
        extendedProps.adapterName = ADAPTER_NAME;
        // @ts-expect-error the type expects an instance, but the class is required here
        extendedProps.Connection = AdminConnection;
        extendedProps.encryptedFields = [];
        extendedProps.translations = {
            en: enLang,
            de: deLang,
            ru: ruLang,
            pt: ptLang,
            nl: nlLang,
            fr: frLang,
            it: itLang,
            es: esLang,
            pl: plLang,
            uk: ukLang,
            'zh-cn': zhCnLang,
        };
        // the tab does not edit the configuration, so it needs no save/close bar
        extendedProps.bottomButtons = !(
            window.location.pathname.includes('tab_m.html') || window.location.search.includes('tab=')
        );

        super(props, extendedProps);

        Object.assign(this.state, { alive: false, logInfo: null } satisfies Partial<AppState>);
    }

    private get aliveId(): string {
        return `system.adapter.${ADAPTER_NAME}.${this.instance}.alive`;
    }

    private onAlive = (_id: string, state: ioBroker.State | null | undefined): void => {
        const alive = !!state?.val;
        if (alive !== this.state.alive) {
            this.setState({ alive }, () => {
                if (alive) {
                    void this.requestLogInfo();
                }
            });
        }
    };

    /** Ask the adapter which log directory it actually uses. */
    private async requestLogInfo(): Promise<void> {
        try {
            const logInfo: LogInfoResponse = await this.socket.sendTo(
                `${ADAPTER_NAME}.${this.instance}`,
                'getLogInfo',
                null,
            );
            if (logInfo?.ok) {
                this.setState({ logInfo });
            }
        } catch {
            // the instance may have stopped in between - the alive handler will retry
        }
    }

    public onConnectionReady(): void {
        this.socket
            .subscribeState(this.aliveId, this.onAlive)
            .catch((e: unknown) => this.showError(`Cannot subscribe to ${this.aliveId}: ${e as string}`));

        this.socket
            .getState(this.aliveId)
            .then(state => {
                const alive = !!state?.val;
                this.setState({ alive }, () => alive && void this.requestLogInfo());
            })
            .catch(() => this.setState({ alive: false }));
    }

    public componentWillUnmount(): void {
        this.socket?.unsubscribeState(this.aliveId, this.onAlive);
        super.componentWillUnmount();
    }

    private sendTo = (command: string, message: unknown): Promise<any> => {
        if (!this.state.connected) {
            return Promise.reject(new Error(I18n.t('Not connected to ioBroker')));
        }
        if (!this.state.alive) {
            return Promise.reject(new Error(I18n.t('The logsearch instance is not running')));
        }
        return Promise.resolve(this.socket.sendTo(`${ADAPTER_NAME}.${this.instance}`, command, message));
    };

    private renderContent(): React.JSX.Element {
        if (this.isTab) {
            return (
                <LogSearchTab
                    defaultHours={Number(this.state.native.defaultHours) || 72}
                    defaultMaxRows={Number(this.state.native.defaultMaxRows) || 500}
                    socketReady={this.state.connected && this.state.alive}
                    alive={this.state.alive}
                    sendTo={this.sendTo}
                    logInfo={this.state.logInfo}
                />
            );
        }

        return (
            <Settings
                native={this.state.native}
                onChange={(attr, value) => this.updateNativeValue(attr, value)}
                logInfo={this.state.logInfo}
            />
        );
    }

    public render(): React.JSX.Element {
        if (!this.state.loaded) {
            return (
                <StyledEngineProvider injectFirst>
                    <ThemeProvider theme={this.state.theme}>
                        <CssBaseline />
                        <Loader themeType={this.state.themeType} />
                    </ThemeProvider>
                </StyledEngineProvider>
            );
        }

        return (
            <StyledEngineProvider injectFirst>
                <ThemeProvider theme={this.state.theme}>
                    <CssBaseline />
                    <ScrollbarStyles theme={this.state.theme} />
                    <div className="App">
                        {this.renderContent()}
                        {this.renderError()}
                        {this.renderToast()}
                        {this.renderSaveCloseButtons()}
                        {this.renderAlertSnackbar()}
                    </div>
                </ThemeProvider>
            </StyledEngineProvider>
        );
    }
}
