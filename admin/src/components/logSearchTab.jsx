import React from "react";
import { withStyles } from "@mui/styles";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

const styles = (theme) => ({ root: { display: "flex", flexDirection: "column", gap: theme.spacing(2) }, controlsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: theme.spacing(2), alignItems: "end" }, actions: { display: "flex", gap: theme.spacing(1), alignItems: "center" }, tableCellMessage: { whiteSpace: "normal", wordBreak: "break-word" }, levelError: { color: theme.palette.error.main, fontWeight: 600 }, levelWarn: { color: "#c77700", fontWeight: 600 }, levelInfo: { opacity: 0.9 }, levelDebug: { opacity: 0.7 }, levelSilly: { opacity: 0.6 }, resultBox: { padding: theme.spacing(2) }, errorText: { color: theme.palette.error.main } });

class LogSearchTab extends React.Component {
    constructor(props) { super(props); this.state = { searchText: "", hours: props.defaultHours || 6, level: "all", maxRows: props.defaultMaxRows || 500, includeGzip: typeof props.includeGzip === "boolean" ? props.includeGzip : true, loading: false, error: "", rows: [], truncated: false, hasSearched: false }; }
    getNumberOrDefault(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
    getLevelClass(level) { const { classes } = this.props; if (level === "error") return classes.levelError; if (level === "warn") return classes.levelWarn; if (level === "debug") return classes.levelDebug; if (level === "silly") return classes.levelSilly; return classes.levelInfo; }
    async onSearch() { const payload = { searchText: this.state.searchText, hours: this.getNumberOrDefault(this.state.hours, 6), level: this.state.level, maxRows: this.getNumberOrDefault(this.state.maxRows, 500), includeGzip: !!this.state.includeGzip }; this.setState({ loading: true, error: "", hasSearched: true }); try { const response = await this.props.sendTo("searchLogs", payload); if (response?.ok === false) throw new Error(response.error || "Search failed"); this.setState({ rows: Array.isArray(response?.rows) ? response.rows : [], truncated: !!response?.truncated, loading: false }); } catch (error) { this.setState({ loading: false, rows: [], truncated: false, error: error?.message || "Search failed" }); } }
    onClear() { this.setState({ searchText: "", error: "", rows: [], truncated: false, hasSearched: false, loading: false }); }
    render() { const { classes } = this.props; return (<div className={classes.root}><div className={classes.controlsGrid}><TextField label="Search text" value={this.state.searchText} onChange={(e) => this.setState({ searchText: e.target.value })} fullWidth /><TextField label="Hours" type="number" value={this.state.hours} onChange={(e) => this.setState({ hours: e.target.value })} fullWidth /><FormControl fullWidth><InputLabel>Level</InputLabel><Select value={this.state.level} onChange={(e) => this.setState({ level: e.target.value })}>{["all", "error", "warn", "info", "debug", "silly"].map((level) => <MenuItem key={level} value={level}>{level}</MenuItem>)}</Select><FormHelperText>Log level filter</FormHelperText></FormControl><TextField label="Max rows" type="number" value={this.state.maxRows} onChange={(e) => this.setState({ maxRows: e.target.value })} fullWidth /><FormControlLabel control={<Checkbox checked={this.state.includeGzip} onChange={() => this.setState({ includeGzip: !this.state.includeGzip })} color="primary" />} label="Include gzip" /></div><div className={classes.actions}><Button variant="contained" color="primary" disabled={this.state.loading} onClick={() => this.onSearch()}>Search</Button><Button variant="outlined" disabled={this.state.loading} onClick={() => this.onClear()}>Clear</Button>{this.state.loading ? <CircularProgress size={24} /> : null}</div>{this.state.error ? <Typography className={classes.errorText}>Error: {this.state.error}</Typography> : null}{this.state.hasSearched && !this.state.error ? <Paper className={classes.resultBox}><Typography>Hits: {this.state.rows.length}</Typography>{this.state.truncated ? <Typography>Only the first {this.state.rows.length} results are shown. Increase max rows or narrow the search.</Typography> : null}</Paper> : null}{this.state.rows.length ? <Paper><Table size="small"><TableHead><TableRow><TableCell>Time</TableCell><TableCell>Level</TableCell><TableCell>Source</TableCell><TableCell>Message</TableCell></TableRow></TableHead><TableBody>{this.state.rows.map((row, index) => <TableRow key={`${row.ts || "no-ts"}-${row.source || "src"}-${index}`}><TableCell>{row.ts || ""}</TableCell><TableCell className={this.getLevelClass(row.level)}>{row.level}</TableCell><TableCell>{row.source}</TableCell><TableCell className={classes.tableCellMessage}>{row.message}</TableCell></TableRow>)}</TableBody></Table></Paper> : null}</div>); }
}

export default withStyles(styles)(LogSearchTab);
