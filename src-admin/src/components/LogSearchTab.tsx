import React from 'react';

import {
    Autocomplete,
    Box,
    Button,
    CircularProgress,
    FormControl,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
    alpha,
} from '@mui/material';

import { I18n, InfoBox, TabContainer, TabContent, TabHeader, type IobTheme } from '@iobroker/gui-components';

import { LEVEL_FILTERS, type LevelFilter, type LogInfoResponse, type LogRow, type SearchCursor } from '../types';

const DEBOUNCE_MS = 700;
const AUTO_UPDATE_MS = 5000;
const AUTO_UPDATE_RESUME_GAP_MS = 20000;
const RESUME_RESYNC_THROTTLE_MS = 1000;

/** Shared look of the two panels: subtle border instead of a hard-to-see elevation. */
const panel = (theme: IobTheme): Record<string, any> => ({
    background: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: '8px',
    boxShadow: theme.shadows[1],
});

const styles: Record<string, any> = {
    searchPanel: (theme: IobTheme) => ({
        ...panel(theme),
        padding: theme.spacing(1.25, 1.5),
        marginBottom: theme.spacing(1),
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing(0.75),
    }),
    controlsGrid: (theme: IobTheme) => ({
        display: 'grid',
        gridTemplateColumns: 'minmax(320px, 1fr) minmax(90px, 110px) minmax(120px, 140px) minmax(110px, 130px)',
        gap: theme.spacing(1),
        alignItems: 'center',
        [theme.breakpoints.down('md')]: {
            gridTemplateColumns: 'minmax(260px, 1fr) repeat(3, minmax(96px, 1fr))',
        },
        [theme.breakpoints.down('sm')]: {
            gridTemplateColumns: '1fr 1fr',
        },
    }),
    searchField: (theme: IobTheme) => ({
        [theme.breakpoints.down('sm')]: {
            gridColumn: '1 / -1',
        },
    }),
    actionsRow: (theme: IobTheme) => ({
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: theme.spacing(0.75),
        flexWrap: 'wrap',
    }),
    buttonGroup: (theme: IobTheme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: theme.spacing(0.75),
        flexWrap: 'wrap',
    }),
    statusBadges: (theme: IobTheme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: theme.spacing(0.75),
        flexWrap: 'wrap',
    }),
    statusBadge: (theme: IobTheme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 22,
        padding: theme.spacing(0.125, 0.75),
        borderRadius: 999,
        color: theme.palette.text.secondary,
        background: theme.palette.action.selected,
        border: `1px solid ${theme.palette.divider}`,
        fontSize: 12,
        lineHeight: 1.4,
    }),
    truncatedBadge: (theme: IobTheme) => ({
        color: theme.palette.warning.dark,
        background: theme.palette.warning.light,
        borderColor: theme.palette.warning.main,
    }),
    resultsPanel: (theme: IobTheme) => ({
        ...panel(theme),
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
    }),
    tableScroller: (theme: IobTheme) => ({
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'auto',
        [theme.breakpoints.down('sm')]: {
            maxHeight: '65vh',
        },
    }),
    resultTable: (theme: IobTheme) => ({
        tableLayout: 'fixed',
        minWidth: 920,
        borderCollapse: 'separate',
        borderSpacing: 0,
        '& th': {
            position: 'sticky',
            top: 0,
            zIndex: 3,
            background: theme.palette.background.paper,
            color: theme.palette.text.primary,
            fontWeight: 600,
            borderBottom: `2px solid ${theme.palette.divider}`,
            boxShadow: `0 2px 3px ${theme.palette.action.disabledBackground}`,
        },
        '& th, & td': {
            padding: theme.spacing(0.75, 1.25),
            verticalAlign: 'top',
            lineHeight: 1.35,
        },
        '& tbody tr:nth-of-type(even)': {
            background: theme.palette.action.selected,
        },
        '& tbody tr:hover': {
            background: theme.palette.action.hover,
        },
        '& tbody tr.rowWarn': {
            background: alpha(theme.palette.warning.main, 0.12),
        },
        '& tbody tr.rowWarn:hover': {
            background: alpha(theme.palette.warning.main, 0.18),
        },
        '& tbody tr.rowError': {
            background: alpha(theme.palette.error.main, 0.12),
        },
        '& tbody tr.rowError:hover': {
            background: alpha(theme.palette.error.main, 0.18),
        },
    }),
    cellTime: { whiteSpace: 'nowrap', width: 210 },
    cellLevel: { width: 88, whiteSpace: 'nowrap' },
    cellSource: { width: 180, wordBreak: 'break-word' },
    cellMessage: { whiteSpace: 'normal', wordBreak: 'break-word' },
    emptyState: (theme: IobTheme) => ({
        padding: theme.spacing(3, 2),
        color: theme.palette.text.secondary,
    }),
    levelError: (theme: IobTheme) => ({ color: theme.palette.error.main, fontWeight: 600 }),
    levelWarn: (theme: IobTheme) => ({ color: theme.palette.warning.dark, fontWeight: 600 }),
    levelInfo: { opacity: 0.9 },
    levelDebug: { opacity: 0.7 },
    levelSilly: { opacity: 0.6 },
    errorText: (theme: IobTheme) => ({ color: theme.palette.error.main }),
};

/** Identify a row by its content, so that auto-update results can be de-duplicated. */
function getRowIdentity(row: LogRow): string {
    return (
        row?.rowId ||
        row?.rawPlain ||
        row?.raw ||
        `${row?.ts || ''}|${row?.level || ''}|${row?.source || ''}|${row?.message || ''}`
    );
}

function getRenderKey(row: LogRow, index: number): string {
    return row?.rowId || `${getRowIdentity(row)}|${index}`;
}

function getRowTimestamp(row: LogRow): number {
    const timestamp = new Date(String(row?.ts || '').replace(' ', 'T')).getTime();
    return Number.isFinite(timestamp) ? timestamp : -Infinity;
}

/** Merge newly appended rows into the existing result, newest first and limited to maxRows. */
function mergeAutoUpdateRows(existingRows: LogRow[], newRows: LogRow[], maxRows: number): LogRow[] {
    const seen = new Set<string>();
    const merged: LogRow[] = [];
    for (const row of [...newRows, ...existingRows]) {
        const key = getRowIdentity(row);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        merged.push(row);
    }
    return merged.sort((a, b) => getRowTimestamp(b) - getRowTimestamp(a)).slice(0, maxRows);
}

function getNumberOrDefault(value: number | string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getLevelStyle(level: string): any {
    if (level === 'error') {
        return styles.levelError;
    }
    if (level === 'warn') {
        return styles.levelWarn;
    }
    if (level === 'debug') {
        return styles.levelDebug;
    }
    if (level === 'silly') {
        return styles.levelSilly;
    }
    return styles.levelInfo;
}

function getRowClass(level: string): string {
    if (level === 'error') {
        return 'rowError';
    }
    if (level === 'warn') {
        return 'rowWarn';
    }
    return '';
}

export interface LogSearchTabProps {
    defaultHours: number;
    defaultMaxRows: number;
    /** False while the socket is disconnected or the instance is not running. */
    socketReady: boolean;
    /** True when the instance is alive. */
    alive: boolean;
    sendTo: (command: string, message: unknown) => Promise<any>;
    logInfo: LogInfoResponse | null;
}

interface LogSearchTabState {
    searchHistory: string[];
    searchText: string;
    hours: number | string;
    level: LevelFilter;
    maxRows: number | string;
    loading: boolean;
    error: string;
    rows: LogRow[];
    truncated: boolean;
    hasSearched: boolean;
    cursor: SearchCursor | null;
    autoUpdateActive: boolean;
    /** "From now" is active. */
    onlyNew: boolean;
    /** Server time the "From now" boundary was set to, null until the adapter answered. */
    since: number | null;
}

export default class LogSearchTab extends React.Component<LogSearchTabProps, LogSearchTabState> {
    private historyRequestToken = 0;
    private searchTextEdited = false;
    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingSearch = false;
    private searchInFlight = false;
    private searchRequestToken = 0;
    private searchGeneration = 0;
    private autoUpdateTimer: ReturnType<typeof setInterval> | null = null;
    private autoUpdateInFlight = false;
    private autoUpdateRequestToken = 0;
    private lastAutoUpdateTickAt: number | null = null;
    private lastResumeResyncAt = 0;
    private resumeResyncPending = false;
    private unmounted = false;

    constructor(props: LogSearchTabProps) {
        super(props);
        this.state = {
            searchHistory: [],
            searchText: '',
            hours: props.defaultHours || 72,
            level: 'all',
            maxRows: props.defaultMaxRows || 500,
            loading: false,
            error: '',
            rows: [],
            truncated: false,
            hasSearched: false,
            cursor: null,
            autoUpdateActive: false,
            onlyNew: false,
            since: null,
        };
    }

    componentDidMount(): void {
        document.addEventListener('visibilitychange', this.handleResumeEvent);
        window.addEventListener('focus', this.handleResumeEvent);
        window.addEventListener('pageshow', this.handleResumeEvent);
        window.addEventListener('online', this.handleResumeEvent);
        // searching before the socket and the instance are up would only produce an error
        if (this.props.socketReady) {
            this.onSearch();
        }
    }

    componentDidUpdate(prevProps: LogSearchTabProps): void {
        if (prevProps.socketReady === true && this.props.socketReady === false) {
            this.resumeResyncPending = true;
            this.stopAutoUpdate(true);
            this.invalidateSearchRequest();
            return;
        }

        if (prevProps.socketReady === false && this.props.socketReady === true) {
            if (!this.state.hasSearched) {
                // the connection became usable - run the initial search now
                this.onSearch();
                return;
            }
            if (this.resumeResyncPending || this.isAutoUpdateStale()) {
                this.resumeResyncPending = false;
                this.resyncAfterResume();
            }
        }
    }

    componentWillUnmount(): void {
        this.unmounted = true;
        document.removeEventListener('visibilitychange', this.handleResumeEvent);
        window.removeEventListener('focus', this.handleResumeEvent);
        window.removeEventListener('pageshow', this.handleResumeEvent);
        window.removeEventListener('online', this.handleResumeEvent);
        this.clearSearchDebounce();
        this.stopAutoUpdate(true);
        this.resumeResyncPending = false;
        this.invalidateSearchRequest();
    }

    clearSearchDebounce(): void {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = null;
        }
    }

    invalidateAutoUpdateRequest(): void {
        this.autoUpdateRequestToken += 1;
        this.autoUpdateInFlight = false;
    }

    invalidateSearchRequest(): void {
        this.searchRequestToken += 1;
        this.searchGeneration += 1;
        this.searchInFlight = false;
        this.pendingSearch = false;
        if (!this.unmounted && this.state.loading) {
            this.setState({ loading: false });
        }
    }

    stopAutoUpdate(invalidateInFlight = false): void {
        if (this.autoUpdateTimer) {
            clearInterval(this.autoUpdateTimer);
            this.autoUpdateTimer = null;
        }
        this.lastAutoUpdateTickAt = null;
        if (invalidateInFlight) {
            this.invalidateAutoUpdateRequest();
        }
        if (!this.unmounted && this.state.autoUpdateActive) {
            this.setState({ autoUpdateActive: false });
        }
    }

    startAutoUpdate(): void {
        this.stopAutoUpdate();
        if (this.unmounted || !this.state.cursor) {
            return;
        }
        this.lastAutoUpdateTickAt = Date.now();
        this.autoUpdateTimer = setInterval(() => this.handleAutoUpdateTick(), AUTO_UPDATE_MS);
        this.setState({ autoUpdateActive: true });
    }

    handleAutoUpdateTick = (): void => {
        const now = Date.now();
        const lastTickAt = this.lastAutoUpdateTickAt;
        this.lastAutoUpdateTickAt = now;
        if (lastTickAt && now - lastTickAt > AUTO_UPDATE_RESUME_GAP_MS) {
            this.resyncAfterResume();
            return;
        }
        void this.runAutoUpdate();
    };

    isSocketReady(): boolean {
        return this.props.socketReady !== false;
    }

    isAutoUpdateStale(now = Date.now()): boolean {
        return !!this.lastAutoUpdateTickAt && now - this.lastAutoUpdateTickAt > AUTO_UPDATE_RESUME_GAP_MS;
    }

    handleResumeEvent = (event?: Event): void => {
        if (this.unmounted || !this.state.hasSearched) {
            return;
        }
        if (document.visibilityState === 'hidden') {
            return;
        }
        if (!this.isSocketReady()) {
            this.resumeResyncPending = true;
            return;
        }

        const now = Date.now();
        const autoUpdateStale = this.isAutoUpdateStale(now);
        if (event?.type === 'online' && autoUpdateStale) {
            this.resumeResyncPending = true;
        }
        if (!autoUpdateStale) {
            return;
        }
        if (now - this.lastResumeResyncAt < RESUME_RESYNC_THROTTLE_MS) {
            return;
        }
        this.lastResumeResyncAt = now;
        this.resyncAfterResume();
    };

    resyncAfterResume(): void {
        if (this.unmounted || !this.state.hasSearched) {
            return;
        }
        if (!this.isSocketReady()) {
            this.resumeResyncPending = true;
            return;
        }
        if (this.searchInFlight) {
            this.invalidateSearchRequest();
        }
        this.resumeResyncPending = true;
        this.clearSearchDebounce();
        this.stopAutoUpdate(true);
        this.pendingSearch = true;
        void this.runSearch();
    }

    runAutoUpdate = async (): Promise<void> => {
        if (
            this.unmounted ||
            this.searchInFlight ||
            this.pendingSearch ||
            this.autoUpdateInFlight ||
            !this.state.cursor
        ) {
            return;
        }

        const requestToken = ++this.autoUpdateRequestToken;
        this.autoUpdateInFlight = true;
        const currentGeneration = this.searchGeneration;
        const maxRows = getNumberOrDefault(this.state.maxRows, 500);
        const payload = {
            searchText: this.state.searchText,
            hours: getNumberOrDefault(this.state.hours, 72),
            level: this.state.level,
            maxRows,
            activeOnly: true,
            cursor: this.state.cursor,
            since: this.state.since,
        };

        try {
            const response = await this.props.sendTo('searchLogs', payload);
            if (response?.ok === false) {
                throw new Error(response.error || I18n.t('Auto update failed'));
            }
            if (
                !this.unmounted &&
                requestToken === this.autoUpdateRequestToken &&
                currentGeneration === this.searchGeneration
            ) {
                const responseRows: LogRow[] = Array.isArray(response?.rows) ? response.rows : [];
                this.setState(state => ({
                    rows: mergeAutoUpdateRows(state.rows, responseRows, maxRows),
                    truncated: state.truncated || !!response?.truncated,
                    cursor: response?.cursor || state.cursor,
                    autoUpdateActive: true,
                }));
            }
        } catch {
            // Auto update is best-effort; keep the existing search result visible.
        } finally {
            if (requestToken === this.autoUpdateRequestToken) {
                this.autoUpdateInFlight = false;
            }
        }
    };

    queueDebouncedSearch(): void {
        this.clearSearchDebounce();
        this.searchDebounceTimer = setTimeout(() => {
            this.searchDebounceTimer = null;
            this.pendingSearch = true;
            void this.runSearch();
        }, DEBOUNCE_MS);
    }

    runSearch = async (): Promise<void> => {
        if (this.unmounted) {
            return;
        }
        if (this.searchInFlight) {
            this.pendingSearch = true;
            return;
        }
        if (!this.pendingSearch) {
            return;
        }

        this.pendingSearch = false;
        this.stopAutoUpdate(true);
        this.searchInFlight = true;
        const requestToken = ++this.searchRequestToken;
        const currentGeneration = ++this.searchGeneration;
        const payload = {
            searchText: this.state.searchText,
            hours: getNumberOrDefault(this.state.hours, 72),
            level: this.state.level,
            maxRows: getNumberOrDefault(this.state.maxRows, 500),
            // the first search in "From now" mode only asks the adapter for the boundary
            startNow: this.state.onlyNew && this.state.since === null,
            since: this.state.since,
        };

        this.setState({ loading: true, error: '', hasSearched: true, cursor: null, autoUpdateActive: false });
        try {
            const response = await this.props.sendTo('searchLogs', payload);
            if (response?.ok === false) {
                throw new Error(response.error || I18n.t('Search failed'));
            }
            if (payload.startNow && !Number.isFinite(response?.since)) {
                throw new Error(
                    I18n.t('Starting from now requires an updated logsearch adapter. Please restart the adapter.'),
                );
            }
            if (
                !this.unmounted &&
                requestToken === this.searchRequestToken &&
                currentGeneration === this.searchGeneration
            ) {
                if (!this.pendingSearch) {
                    this.resumeResyncPending = false;
                }
                this.setState(
                    {
                        rows: Array.isArray(response?.rows) ? response.rows : [],
                        truncated: !!response?.truncated,
                        loading: false,
                        cursor: response?.cursor || null,
                        since: payload.startNow ? response.since : this.state.since,
                    },
                    () => this.startAutoUpdate(),
                );
            }
        } catch (error: any) {
            if (
                !this.unmounted &&
                requestToken === this.searchRequestToken &&
                currentGeneration === this.searchGeneration
            ) {
                this.setState({
                    loading: false,
                    rows: [],
                    truncated: false,
                    cursor: null,
                    autoUpdateActive: false,
                    error: error?.message || I18n.t('Search failed'),
                });
            }
        } finally {
            if (requestToken === this.searchRequestToken) {
                this.searchInFlight = false;
                if (!this.unmounted) {
                    if (currentGeneration !== this.searchGeneration && this.state.loading) {
                        this.setState({ loading: false });
                    }
                    if (this.pendingSearch) {
                        void this.runSearch();
                    }
                }
            }
        }
    };

    /** Refresh on opening the dropdown, including searches made in another browser. */
    loadSearchHistory = async (): Promise<void> => {
        await this.requestSearchHistory('getSearchHistory', {});
    };

    private async requestSearchHistory(command: string, message: unknown): Promise<void> {
        if (this.unmounted || !this.isSocketReady()) {
            return;
        }
        const token = ++this.historyRequestToken;
        try {
            const response = await this.props.sendTo(command, message);
            if (
                !this.unmounted &&
                token === this.historyRequestToken &&
                response?.ok &&
                Array.isArray(response.entries)
            ) {
                this.setState({
                    searchHistory: response.entries.filter((entry: unknown) => typeof entry === 'string').slice(0, 10),
                });
            }
        } catch {
            // Keep searches usable if history storage or the connection is temporarily unavailable.
        }
    }

    rememberCurrentSearch(onlyIfEdited = false): void {
        if (onlyIfEdited && !this.searchTextEdited) {
            return;
        }
        this.searchTextEdited = false;
        if (this.state.searchText.trim()) {
            void this.requestSearchHistory('rememberSearch', { searchText: this.state.searchText });
        }
    }

    selectSearch(searchText: string): void {
        this.clearSearchDebounce();
        this.stopAutoUpdate(true);
        this.invalidateSearchRequest();
        this.setState({ searchText }, () => this.onSubmitSearch());
    }

    onSubmitSearch(): void {
        this.rememberCurrentSearch();
        this.onSearch();
    }

    onSearch(): void {
        this.clearSearchDebounce();
        this.pendingSearch = true;
        void this.runSearch();
    }

    /** Toggle between the history and "From now", which hides everything logged before the click. */
    onToggleNewLogs(): void {
        const onlyNew = !this.state.onlyNew;
        this.clearSearchDebounce();
        this.stopAutoUpdate(true);
        this.invalidateSearchRequest();
        this.resumeResyncPending = false;
        this.setState({ onlyNew, since: null, rows: [], truncated: false, cursor: null, error: '' }, () =>
            this.onSearch(),
        );
    }

    /** Download the displayed rows, newest first and without ANSI colors, as a text file. */
    onExport(): void {
        if (!this.state.rows.length) {
            return;
        }
        const text = this.state.rows
            .map(
                row => row.rawPlain || `${row.ts || ''} - ${row.level || ''}: ${row.source || ''} ${row.message || ''}`,
            )
            .join('\n');
        const blob = new window.Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `logsearch-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(link);
        try {
            link.click();
        } finally {
            link.remove();
            // Give the browser time to start the download before releasing the object URL.
            setTimeout(() => window.URL.revokeObjectURL(url), 1000);
        }
    }

    onClear(): void {
        this.searchTextEdited = false;
        this.clearSearchDebounce();
        this.stopAutoUpdate(true);
        this.resumeResyncPending = false;
        if (this.searchInFlight) {
            this.invalidateSearchRequest();
        } else {
            this.pendingSearch = false;
            this.searchGeneration += 1;
        }
        this.setState(
            {
                searchText: '',
                error: '',
                loading: false,
                cursor: null,
                autoUpdateActive: false,
            },
            () => this.onSearch(),
        );
    }

    onFieldChange = (field: 'searchText' | 'hours' | 'level' | 'maxRows', value: string): void => {
        if (field === 'searchText') {
            this.searchTextEdited = true;
        }
        this.stopAutoUpdate(true);
        this.resumeResyncPending = false;
        if (this.searchInFlight) {
            this.invalidateSearchRequest();
        } else {
            this.searchGeneration += 1;
        }
        this.setState({ [field]: value } as unknown as LogSearchTabState, () => this.queueDebouncedSearch());
    };

    renderFilters(): React.JSX.Element {
        return (
            <Paper sx={styles.searchPanel}>
                <Box sx={styles.controlsGrid}>
                    <Autocomplete
                        freeSolo
                        openOnFocus
                        clearOnBlur={false}
                        value={null}
                        inputValue={this.state.searchText}
                        options={this.state.searchHistory}
                        filterOptions={options => options}
                        sx={styles.searchField}
                        onOpen={() => void this.loadSearchHistory()}
                        onInputChange={(_event, value, reason) => {
                            if (reason === 'input' || reason === 'clear') {
                                this.onFieldChange('searchText', value);
                            }
                        }}
                        onChange={(_event, value) => {
                            if (typeof value === 'string') {
                                this.selectSearch(value);
                            }
                        }}
                        onBlur={() => this.rememberCurrentSearch(true)}
                        renderInput={params => (
                            <TextField
                                {...params}
                                variant="standard"
                                label={I18n.t('Search text')}
                                fullWidth
                            />
                        )}
                        size="small"
                        fullWidth
                    />
                    <TextField
                        variant="standard"
                        label={I18n.t('Hours')}
                        type="number"
                        value={this.state.hours}
                        onChange={e => this.onFieldChange('hours', e.target.value)}
                        size="small"
                        fullWidth
                    />
                    <FormControl
                        variant="standard"
                        fullWidth
                        size="small"
                    >
                        <InputLabel>{I18n.t('Level')}</InputLabel>
                        <Select
                            variant="standard"
                            value={this.state.level}
                            label={I18n.t('Level')}
                            onChange={e => this.onFieldChange('level', e.target.value)}
                        >
                            {LEVEL_FILTERS.map(level => (
                                <MenuItem
                                    key={level}
                                    value={level}
                                >
                                    {level}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <TextField
                        variant="standard"
                        label={I18n.t('Max rows')}
                        type="number"
                        value={this.state.maxRows}
                        onChange={e => this.onFieldChange('maxRows', e.target.value)}
                        size="small"
                        fullWidth
                    />
                </Box>

                <Box sx={styles.actionsRow}>
                    <Box sx={styles.buttonGroup}>
                        <Button
                            variant="contained"
                            color="primary"
                            disabled={this.state.loading || !this.props.socketReady}
                            onClick={() => this.onSubmitSearch()}
                            size="small"
                        >
                            {I18n.t('Search')}
                        </Button>
                        <Button
                            variant="outlined"
                            disabled={this.state.loading || !this.props.socketReady}
                            onClick={() => this.onClear()}
                            size="small"
                        >
                            {I18n.t('Clear filter')}
                        </Button>
                        <Button
                            variant={this.state.onlyNew ? 'contained' : 'outlined'}
                            disabled={!this.props.socketReady}
                            onClick={() => this.onToggleNewLogs()}
                            size="small"
                            aria-pressed={this.state.onlyNew}
                            title={
                                this.state.onlyNew
                                    ? I18n.t('Show log history again.')
                                    : I18n.t('Clear the table and show only new log entries. Log files are kept.')
                            }
                        >
                            {I18n.t('From now')}
                        </Button>
                        <Button
                            variant="outlined"
                            disabled={this.state.loading || !this.state.rows.length}
                            onClick={() => this.onExport()}
                            size="small"
                            title={I18n.t('Download the displayed log rows as a text file')}
                        >
                            {I18n.t('Export .txt')}
                        </Button>
                        {this.state.loading ? <CircularProgress size={20} /> : null}
                    </Box>
                    <Box sx={styles.statusBadges}>
                        {this.state.onlyNew ? (
                            <Typography
                                component="span"
                                variant="caption"
                                sx={styles.statusBadge}
                            >
                                {I18n.t('Only new entries')}
                            </Typography>
                        ) : null}
                        {this.state.autoUpdateActive ? (
                            <Typography
                                component="span"
                                variant="caption"
                                sx={styles.statusBadge}
                            >
                                {I18n.t('Auto update active')}
                            </Typography>
                        ) : null}
                        {this.state.hasSearched && !this.state.error ? (
                            <Typography
                                component="span"
                                variant="caption"
                                sx={styles.statusBadge}
                            >
                                {I18n.t('Hits: %s', this.state.rows.length)}
                            </Typography>
                        ) : null}
                        {this.state.truncated ? (
                            <Typography
                                component="span"
                                variant="caption"
                                sx={[styles.statusBadge, styles.truncatedBadge]}
                            >
                                {I18n.t('Truncated')}
                            </Typography>
                        ) : null}
                    </Box>
                </Box>

                {this.state.error ? (
                    <Typography sx={styles.errorText}>{I18n.t('Error: %s', this.state.error)}</Typography>
                ) : null}
            </Paper>
        );
    }

    renderResults(): React.JSX.Element | null {
        if (!this.state.hasSearched || this.state.error) {
            return null;
        }

        if (!this.state.rows.length) {
            return (
                <Paper sx={styles.resultsPanel}>
                    <Typography sx={styles.emptyState}>{I18n.t('No results found.')}</Typography>
                </Paper>
            );
        }

        return (
            <Paper sx={styles.resultsPanel}>
                <Box sx={styles.tableScroller}>
                    <Table
                        size="small"
                        sx={styles.resultTable}
                    >
                        <colgroup>
                            <col style={{ width: 210 }} />
                            <col style={{ width: 88 }} />
                            <col style={{ width: 180 }} />
                            <col />
                        </colgroup>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={styles.cellTime}>{I18n.t('Time')}</TableCell>
                                <TableCell sx={styles.cellLevel}>{I18n.t('Level')}</TableCell>
                                <TableCell sx={styles.cellSource}>{I18n.t('Source')}</TableCell>
                                <TableCell>{I18n.t('Message')}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {this.state.rows.map((row, index) => (
                                <TableRow
                                    key={getRenderKey(row, index)}
                                    className={getRowClass(row.level)}
                                >
                                    <TableCell sx={styles.cellTime}>{row.ts || ''}</TableCell>
                                    <TableCell sx={[styles.cellLevel, getLevelStyle(row.level)]}>{row.level}</TableCell>
                                    <TableCell sx={styles.cellSource}>{row.source}</TableCell>
                                    <TableCell sx={styles.cellMessage}>{row.message}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Box>
            </Paper>
        );
    }

    renderHint(): React.JSX.Element | null {
        const { alive, socketReady } = this.props;
        if (!alive) {
            return (
                <InfoBox type="warning">
                    {I18n.t('The logsearch instance is not running. Start it to search the log files.')}
                </InfoBox>
            );
        }
        if (!socketReady) {
            return <InfoBox type="warning">{I18n.t('Not connected to ioBroker')}</InfoBox>;
        }
        return null;
    }

    render(): React.JSX.Element {
        const { logInfo } = this.props;

        return (
            <TabContainer styles={{ root: { padding: 8 } }}>
                <TabHeader>{this.renderFilters()}</TabHeader>
                <TabContent overflow="auto">
                    {this.renderHint()}
                    {logInfo && !logInfo.readable ? (
                        <InfoBox type="error">{I18n.t('Cannot read the log directory %s', logInfo.directory)}</InfoBox>
                    ) : null}
                    {this.renderResults()}
                </TabContent>
            </TabContainer>
        );
    }
}
