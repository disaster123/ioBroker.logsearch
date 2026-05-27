import React from "react";
import { withStyles } from "@material-ui/core/styles";
import TextField from "@material-ui/core/TextField";
import Button from "@material-ui/core/Button";
import FormControl from "@material-ui/core/FormControl";
import Select from "@material-ui/core/Select";
import MenuItem from "@material-ui/core/MenuItem";
import FormControlLabel from "@material-ui/core/FormControlLabel";
import Checkbox from "@material-ui/core/Checkbox";
import FormHelperText from "@material-ui/core/FormHelperText";
import InputLabel from "@material-ui/core/InputLabel";
import Paper from "@material-ui/core/Paper";
import Typography from "@material-ui/core/Typography";
import CircularProgress from "@material-ui/core/CircularProgress";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";

const styles = (theme) => ({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing(2),
    },
    controlsGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: theme.spacing(2),
        alignItems: "end",
    },
    actions: {
        display: "flex",
        gap: theme.spacing(1),
        alignItems: "center",
    },
    tableCellMessage: {
        whiteSpace: "normal",
        wordBreak: "break-word",
    },
    levelError: { color: theme.palette.error.main, fontWeight: 600 },
    levelWarn: { color: "#c77700", fontWeight: 600 },
    levelInfo: { opacity: 0.9 },
    levelDebug: { opacity: 0.7 },
    levelSilly: { opacity: 0.6 },
    resultBox: {
        padding: theme.spacing(2),
    },
    errorText: {
        color: theme.palette.error.main,
    },
});

class Settings extends React.Component {
    constructor(props) {
        super(props);
        this.state = this.createInitialState(props.native);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.native !== this.props.native) {
            this.setState((prevState) => {
                if (prevState.hasSearched || prevState.loading) {
                    return null;
                }
                return this.createInitialState(this.props.native);
            });
        }
    }

    createInitialState(native) {
        return {
            searchText: "",
            hours: this.getNumberOrDefault(native?.defaultHours, 6),
            level: "all",
            maxRows: this.getNumberOrDefault(native?.defaultMaxRows, 500),
            includeGzip: typeof native?.includeGzip === "boolean" ? native.includeGzip : true,
            loading: false,
            error: "",
            rows: [],
            truncated: false,
            hasSearched: false,
        };
    }

    getNumberOrDefault(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    getLevelClass(level) {
        const { classes } = this.props;
        switch (level) {
            case "error": return classes.levelError;
            case "warn": return classes.levelWarn;
            case "debug": return classes.levelDebug;
            case "silly": return classes.levelSilly;
            case "info":
            default:
                return classes.levelInfo;
        }
    }

    async onSearch() {
        const { sendTo } = this.props;
        const payload = {
            searchText: this.state.searchText,
            hours: this.getNumberOrDefault(this.state.hours, 6),
            level: this.state.level,
            maxRows: this.getNumberOrDefault(this.state.maxRows, 500),
            includeGzip: !!this.state.includeGzip,
        };

        this.setState({ loading: true, error: "", hasSearched: true });
        try {
            const response = await sendTo("searchLogs", payload);
            if (!response || response.error) {
                throw new Error(response?.error || "Unknown error");
            }

            const rows = Array.isArray(response.rows) ? [...response.rows] : [];
            rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
            this.setState({
                rows,
                truncated: !!response.truncated,
                loading: false,
            });
        } catch (error) {
            this.setState({
                loading: false,
                rows: [],
                truncated: false,
                error: error?.message || "Search failed",
            });
        }
    }

    onClear() {
        this.setState({
            searchText: "",
            error: "",
            rows: [],
            truncated: false,
            hasSearched: false,
        });
    }

    render() {
        const { classes } = this.props;

        return (
            <div className={classes.root}>
                <div className={classes.controlsGrid}>
                    <TextField
                        label="Search text"
                        value={this.state.searchText}
                        onChange={(e) => this.setState({ searchText: e.target.value })}
                        fullWidth
                    />
                    <TextField
                        label="Hours"
                        type="number"
                        value={this.state.hours}
                        onChange={(e) => this.setState({ hours: e.target.value })}
                        fullWidth
                    />
                    <FormControl fullWidth>
                        <InputLabel>Level</InputLabel>
                        <Select
                            value={this.state.level}
                            onChange={(e) => this.setState({ level: e.target.value })}
                        >
                            {["all", "error", "warn", "info", "debug", "silly"].map(level => (
                                <MenuItem key={level} value={level}>{level}</MenuItem>
                            ))}
                        </Select>
                        <FormHelperText>Log level filter</FormHelperText>
                    </FormControl>
                    <TextField
                        label="Max rows"
                        type="number"
                        value={this.state.maxRows}
                        onChange={(e) => this.setState({ maxRows: e.target.value })}
                        fullWidth
                    />
                    <FormControlLabel
                        control={(
                            <Checkbox
                                checked={this.state.includeGzip}
                                onChange={() => this.setState({ includeGzip: !this.state.includeGzip })}
                                color="primary"
                            />
                        )}
                        label="Include gzip"
                    />
                </div>

                <div className={classes.actions}>
                    <Button variant="contained" color="primary" disabled={this.state.loading} onClick={() => this.onSearch()}>
                        Search
                    </Button>
                    <Button variant="outlined" disabled={this.state.loading} onClick={() => this.onClear()}>
                        Clear
                    </Button>
                    {this.state.loading ? <CircularProgress size={24} /> : null}
                </div>

                {this.state.error ? (
                    <Typography className={classes.errorText}>Error: {this.state.error}</Typography>
                ) : null}

                {this.state.hasSearched && !this.state.error ? (
                    <Paper className={classes.resultBox}>
                        <Typography>Hits: {this.state.rows.length}</Typography>
                        {this.state.truncated ? (
                            <Typography>Only the maximum number of results is shown.</Typography>
                        ) : null}
                    </Paper>
                ) : null}

                {this.state.rows.length ? (
                    <Paper>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Time</TableCell>
                                    <TableCell>Level</TableCell>
                                    <TableCell>Source</TableCell>
                                    <TableCell>Message</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {this.state.rows.map((row, index) => (
                                    <TableRow key={`${row.ts || "no-ts"}-${row.source || "src"}-${index}`}>
                                        <TableCell>{row.ts ? new Date(row.ts).toLocaleString() : ""}</TableCell>
                                        <TableCell className={this.getLevelClass(row.level)}>{row.level}</TableCell>
                                        <TableCell>{row.source}</TableCell>
                                        <TableCell className={classes.tableCellMessage}>{row.message}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Paper>
                ) : null}
            </div>
        );
    }
}

export default withStyles(styles)(Settings);
