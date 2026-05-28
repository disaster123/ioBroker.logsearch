import React from "react";
import { withStyles } from "@mui/styles";
import TextField from "@mui/material/TextField";

const styles = () => ({
    root: {
        display: "flex",
        flexDirection: "column",
        paddingTop: 16,
    },
    input: {
        marginTop: 0,
        minWidth: 320,
        marginBottom: 8,
    },
});

class Settings extends React.Component {
    render() {
        const { native, onChange, classes } = this.props;

        return (
            <form className={classes.root}>
                <TextField
                    label="Log directory"
                    className={classes.input}
                    value={native.logDirectory || ""}
                    onChange={(e) => onChange("logDirectory", e.target.value)}
                    margin="normal"
                />
                <TextField
                    label="Default hours"
                    className={classes.input}
                    type="number"
                    value={native.defaultHours ?? 72}
                    onChange={(e) => onChange("defaultHours", parseInt(e.target.value, 10) || 0)}
                    margin="normal"
                />
                <TextField
                    label="Default max rows"
                    className={classes.input}
                    type="number"
                    value={native.defaultMaxRows}
                    onChange={(e) => onChange("defaultMaxRows", parseInt(e.target.value, 10) || 0)}
                    margin="normal"
                />
            </form>
        );
    }
}

export default withStyles(styles)(Settings);
