import React from "react";
import { withStyles } from "@mui/styles";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import InputLabel from "@mui/material/InputLabel";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

const DEBOUNCE_MS = 700;
const AUTO_UPDATE_MS = 5000;

const styles = (theme) => ({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing(1.25),
        height: "100vh",
        minHeight: 0,
        boxSizing: "border-box",
        padding: theme.spacing(3, 2, 2),
        overflow: "hidden",
        background: theme.palette.background.default,
        [theme.breakpoints.down("sm")]: {
            height: "auto",
            minHeight: "100vh",
            overflow: "visible",
            padding: theme.spacing(3, 1.5, 1.5),
        },
    },
    panel: {
        background: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 8,
        boxShadow: theme.shadows[1],
    },
    searchPanel: {
        padding: theme.spacing(1.25, 1.5),
        flex: "0 0 auto",
        position: "sticky",
        top: 0,
        zIndex: 2,
    },
    controlsGrid: {
        display: "grid",
        gridTemplateColumns: "minmax(320px, 1fr) minmax(90px, 110px) minmax(120px, 140px) minmax(110px, 130px)",
        gap: theme.spacing(1),
        alignItems: "center",
        [theme.breakpoints.down("md")]: {
            gridTemplateColumns: "minmax(260px, 1fr) repeat(3, minmax(96px, 1fr))",
        },
        [theme.breakpoints.down("sm")]: {
            gridTemplateColumns: "1fr 1fr",
        },
    },
    searchField: {
        [theme.breakpoints.down("sm")]: {
            gridColumn: "1 / -1",
        },
    },
    actionsRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: theme.spacing(0.75),
        flexWrap: "wrap",
        marginTop: theme.spacing(0.75),
    },
    buttonGroup: {
        display: "inline-flex",
        alignItems: "center",
        gap: theme.spacing(0.75),
        flexWrap: "wrap",
    },
    statusBadges: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: theme.spacing(0.75),
        flexWrap: "wrap",
    },
    statusBadge: {
        display: "inline-flex",
        alignItems: "center",
        minHeight: 22,
        padding: theme.spacing(0.125, 0.75),
        borderRadius: 999,
        color: theme.palette.text.secondary,
        background: theme.palette.action.selected,
        border: `1px solid ${theme.palette.divider}`,
        fontSize: 12,
        lineHeight: 1.4,
    },
    truncatedBadge: {
        color: theme.palette.warning.dark,
        background: theme.palette.warning.light,
        borderColor: theme.palette.warning.main,
    },
    resultsPanel: {
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        flex: "1 1 auto",
        overflow: "hidden",
    },
    tableScroller: {
        flex: "1 1 auto",
        minHeight: 0,
        overflow: "auto",
        [theme.breakpoints.down("sm")]: {
            maxHeight: "65vh",
        },
    },
    resultTable: {
        tableLayout: "fixed",
        minWidth: 920,
        borderCollapse: "separate",
        borderSpacing: 0,
        "& th": {
            position: "sticky",
            top: 0,
            zIndex: 3,
            background: theme.palette.background.paper,
            color: theme.palette.text.primary,
            fontWeight: 600,
            borderBottom: `2px solid ${theme.palette.divider}`,
            boxShadow: `0 2px 3px ${theme.palette.action.disabledBackground}`,
        },
        "& th, & td": {
            padding: theme.spacing(0.75, 1.25),
            verticalAlign: "top",
            lineHeight: 1.35,
        },
        "& tbody tr:nth-of-type(even)": {
            background: theme.palette.action.selected,
        },
        "& tbody tr:hover": {
            background: theme.palette.action.hover,
        },
    },
    tableCellTime: {
        whiteSpace: "nowrap",
        width: 210,
    },
    tableCellLevel: {
        width: 88,
        whiteSpace: "nowrap",
    },
    tableCellSource: {
        width: 180,
        wordBreak: "break-word",
    },
    tableCellMessage: { whiteSpace: "normal", wordBreak: "break-word" },
    emptyState: {
        padding: theme.spacing(3, 2),
        color: theme.palette.text.secondary,
    },
    levelError: { color: theme.palette.error.main, fontWeight: 600 },
    levelWarn: { color: theme.palette.warning.dark, fontWeight: 600 },
    levelInfo: { opacity: 0.9 },
    levelDebug: { opacity: 0.7 },
    levelSilly: { opacity: 0.6 },
    errorText: { color: theme.palette.error.main, marginTop: theme.spacing(1.5) },
});

class LogSearchTab extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            searchText: "",
            hours: props.defaultHours || 72,
            level: "all",
            maxRows: props.defaultMaxRows || 500,
            loading: false,
            error: "",
            rows: [],
            truncated: false,
            hasSearched: false,
            cursor: null,
            autoUpdateActive: false,
        };
        this.searchDebounceTimer = null;
        this.pendingSearch = false;
        this.searchInFlight = false;
        this.searchGeneration = 0;
        this.autoUpdateTimer = null;
        this.autoUpdateInFlight = false;
        this.unmounted = false;
    }

    componentWillUnmount() {
        this.unmounted = true;
        this.clearSearchDebounce();
        this.stopAutoUpdate();
        this.pendingSearch = false;
        this.searchGeneration += 1;
    }

    clearSearchDebounce() {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = null;
        }
    }
    stopAutoUpdate() {
        if (this.autoUpdateTimer) {
            clearInterval(this.autoUpdateTimer);
            this.autoUpdateTimer = null;
        }
        this.autoUpdateInFlight = false;
        if (!this.unmounted && this.state.autoUpdateActive) {
            this.setState({ autoUpdateActive: false });
        }
    }

    startAutoUpdate() {
        this.stopAutoUpdate();
        if (this.unmounted || !this.state.cursor) {
            return;
        }
        this.autoUpdateTimer = setInterval(() => this.runAutoUpdate(), AUTO_UPDATE_MS);
        this.setState({ autoUpdateActive: true });
    }

    getRowKey(row) {
        return row?.rawPlain || row?.raw || `${row?.ts || ""}|${row?.level || ""}|${row?.source || ""}|${row?.message || ""}`;
    }

    mergeAutoUpdateRows(existingRows, newRows, maxRows) {
        const seen = new Set();
        const merged = [];
        for (const row of [...newRows, ...existingRows]) {
            const key = this.getRowKey(row);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(row);
            if (merged.length >= maxRows) {
                break;
            }
        }
        return merged;
    }

    runAutoUpdate = async () => {
        if (this.unmounted || this.searchInFlight || this.pendingSearch || this.autoUpdateInFlight || !this.state.cursor) {
            return;
        }

        this.autoUpdateInFlight = true;
        const currentGeneration = this.searchGeneration;
        const maxRows = this.getNumberOrDefault(this.state.maxRows, 500);
        const payload = {
            searchText: this.state.searchText,
            hours: this.getNumberOrDefault(this.state.hours, 72),
            level: this.state.level,
            maxRows,
            activeOnly: true,
            cursor: this.state.cursor,
        };

        try {
            const response = await this.props.sendTo("searchLogs", payload);
            if (response?.ok === false) {
                throw new Error(response.error || "Auto update failed");
            }
            if (!this.unmounted && currentGeneration === this.searchGeneration) {
                const responseRows = Array.isArray(response?.rows) ? response.rows : [];
                this.setState((state) => ({
                    rows: this.mergeAutoUpdateRows(state.rows, responseRows, maxRows),
                    truncated: state.truncated || !!response?.truncated,
                    cursor: response?.cursor || state.cursor,
                    autoUpdateActive: true,
                }));
            }
        } catch {
            // Auto update is best-effort; keep the existing search result visible.
        } finally {
            this.autoUpdateInFlight = false;
        }
    };


    getNumberOrDefault(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    getLevelClass(level) {
        const { classes } = this.props;
        if (level === "error") return classes.levelError;
        if (level === "warn") return classes.levelWarn;
        if (level === "debug") return classes.levelDebug;
        if (level === "silly") return classes.levelSilly;
        return classes.levelInfo;
    }

    queueDebouncedSearch() {
        this.clearSearchDebounce();
        this.searchDebounceTimer = setTimeout(() => {
            this.searchDebounceTimer = null;
            this.pendingSearch = true;
            this.runSearch();
        }, DEBOUNCE_MS);
    }

    runSearch = async () => {
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
        this.stopAutoUpdate();
        this.searchInFlight = true;
        const currentGeneration = ++this.searchGeneration;
        const payload = {
            searchText: this.state.searchText,
            hours: this.getNumberOrDefault(this.state.hours, 72),
            level: this.state.level,
            maxRows: this.getNumberOrDefault(this.state.maxRows, 500),
        };

        this.setState({ loading: true, error: "", hasSearched: true, cursor: null, autoUpdateActive: false });
        try {
            const response = await this.props.sendTo("searchLogs", payload);
            if (response?.ok === false) {
                throw new Error(response.error || "Search failed");
            }
            if (!this.unmounted && currentGeneration === this.searchGeneration) {
                this.setState({
                    rows: Array.isArray(response?.rows) ? response.rows : [],
                    truncated: !!response?.truncated,
                    loading: false,
                    cursor: response?.cursor || null,
                }, () => this.startAutoUpdate());
            }
        } catch (error) {
            if (!this.unmounted && currentGeneration === this.searchGeneration) {
                this.setState({
                    loading: false,
                    rows: [],
                    truncated: false,
                    cursor: null,
                    autoUpdateActive: false,
                    error: error?.message || "Search failed",
                });
            }
        } finally {
            this.searchInFlight = false;
            if (!this.unmounted) {
                if (currentGeneration !== this.searchGeneration && this.state.loading) {
                    this.setState({ loading: false });
                }
                if (this.pendingSearch) {
                    this.runSearch();
                }
            }
        }
    };

    onSearch() {
        this.clearSearchDebounce();
        this.pendingSearch = true;
        this.runSearch();
    }

    onClear() {
        this.clearSearchDebounce();
        this.stopAutoUpdate();
        this.pendingSearch = false;
        this.searchGeneration += 1;
        this.setState({
            searchText: "",
            error: "",
            rows: [],
            truncated: false,
            hasSearched: false,
            loading: false,
            cursor: null,
            autoUpdateActive: false,
        });
    }

    onFieldChange = (field, value) => {
        this.stopAutoUpdate();
        if (this.searchInFlight) {
            this.searchGeneration += 1;
        }
        this.setState({ [field]: value }, () => this.queueDebouncedSearch());
    };

    render() {
        const { classes } = this.props;

        return (
            <div className={classes.root}>
                <Paper className={`${classes.panel} ${classes.searchPanel}`}>
                    <div className={classes.controlsGrid}>
                        <TextField
                            className={classes.searchField}
                            label="Search text"
                            value={this.state.searchText}
                            onChange={(e) => this.onFieldChange("searchText", e.target.value)}
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="Hours"
                            type="number"
                            value={this.state.hours}
                            onChange={(e) => this.onFieldChange("hours", e.target.value)}
                            size="small"
                            fullWidth
                        />
                        <FormControl fullWidth size="small">
                            <InputLabel>Level</InputLabel>
                            <Select
                                value={this.state.level}
                                label="Level"
                                onChange={(e) => this.onFieldChange("level", e.target.value)}
                            >
                                {["all", "error", "warn", "info", "debug", "silly"].map((level) => (
                                    <MenuItem key={level} value={level}>
                                        {level}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Max rows"
                            type="number"
                            value={this.state.maxRows}
                            onChange={(e) => this.onFieldChange("maxRows", e.target.value)}
                            size="small"
                            fullWidth
                        />
                    </div>

                    <div className={classes.actionsRow}>
                        <div className={classes.buttonGroup}>
                            <Button
                                variant="contained"
                                color="primary"
                                disabled={this.state.loading}
                                onClick={() => this.onSearch()}
                                size="small"
                            >
                                Search
                            </Button>
                            <Button variant="outlined" disabled={this.state.loading} onClick={() => this.onClear()} size="small">
                                Clear
                            </Button>
                            {this.state.loading ? <CircularProgress size={20} /> : null}
                        </div>
                        <div className={classes.statusBadges}>
                            {this.state.autoUpdateActive ? (
                                <Typography component="span" variant="caption" className={classes.statusBadge}>
                                    Auto update active
                                </Typography>
                            ) : null}
                            {this.state.hasSearched && !this.state.error ? (
                                <Typography component="span" variant="caption" className={classes.statusBadge}>
                                    Hits: {this.state.rows.length}
                                </Typography>
                            ) : null}
                            {this.state.truncated ? (
                                <Typography
                                    component="span"
                                    variant="caption"
                                    className={`${classes.statusBadge} ${classes.truncatedBadge}`}
                                >
                                    Truncated
                                </Typography>
                            ) : null}
                        </div>
                    </div>

                    {this.state.error ? <Typography className={classes.errorText}>Error: {this.state.error}</Typography> : null}
                </Paper>

                {this.state.hasSearched && !this.state.error ? (
                    <Paper className={`${classes.panel} ${classes.resultsPanel}`}>
                        {this.state.rows.length ? (
                            <div className={classes.tableScroller}>
                                <Table size="small" className={classes.resultTable}>
                                    <colgroup>
                                        <col style={{ width: 210 }} />
                                        <col style={{ width: 88 }} />
                                        <col style={{ width: 180 }} />
                                        <col />
                                    </colgroup>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell className={classes.tableCellTime}>Time</TableCell>
                                            <TableCell className={classes.tableCellLevel}>Level</TableCell>
                                            <TableCell className={classes.tableCellSource}>Source</TableCell>
                                            <TableCell>Message</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {this.state.rows.map((row) => (
                                            <TableRow key={this.getRowKey(row)}>
                                                <TableCell className={classes.tableCellTime}>{row.ts || ""}</TableCell>
                                                <TableCell className={`${classes.tableCellLevel} ${this.getLevelClass(row.level)}`}>
                                                    {row.level}
                                                </TableCell>
                                                <TableCell className={classes.tableCellSource}>{row.source}</TableCell>
                                                <TableCell className={classes.tableCellMessage}>{row.message}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        ) : (
                            <Typography className={classes.emptyState}>No results found.</Typography>
                        )}
                    </Paper>
                ) : null}
            </div>
        );
    }
}

export default withStyles(styles)(LogSearchTab);
