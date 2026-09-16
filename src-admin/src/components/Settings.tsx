import React from 'react';

import { TextField, Tooltip } from '@mui/material';

import { I18n, InfoBox } from '@iobroker/gui-components';

import type { LogInfoResponse } from '../types';

const styles: Record<string, React.CSSProperties> = {
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 16,
        maxWidth: 560,
    },
    input: {
        minWidth: 320,
    },
};

interface SettingsProps {
    native: Record<string, any>;
    onChange: (attr: string, value: unknown) => void;
    /** What the adapter reported about the detected location, or null while it is not running. */
    logInfo: LogInfoResponse | null;
}

/** Render the hint about the log location the adapter actually uses. */
function renderDetected(logInfo: LogInfoResponse | null): React.JSX.Element | null {
    if (!logInfo) {
        return null;
    }
    const pattern = `${logInfo.prefix}.<date>${logInfo.extension}`;

    if (!logInfo.readable) {
        return <InfoBox type="error">{I18n.t('Cannot read the log directory %s', logInfo.directory)}</InfoBox>;
    }
    if (!logInfo.files) {
        return <InfoBox type="warning">{I18n.t('No %s files found in %s', pattern, logInfo.directory)}</InfoBox>;
    }
    return <InfoBox type="info">{I18n.t('Found %s log files in %s', logInfo.files, logInfo.directory)}</InfoBox>;
}

export default function Settings(props: SettingsProps): React.JSX.Element {
    const { native, onChange, logInfo } = props;

    return (
        <form style={styles.form}>
            {renderDetected(logInfo)}
            <Tooltip title={I18n.t('Leave empty to detect the log directory automatically')}>
                <TextField
                    variant="standard"
                    label={I18n.t('Log directory')}
                    style={styles.input}
                    value={native.logDirectory || ''}
                    placeholder={logInfo?.directory || I18n.t('Detected automatically')}
                    helperText={I18n.t('Leave empty to detect the log directory automatically')}
                    onChange={e => onChange('logDirectory', e.target.value)}
                />
            </Tooltip>
            <TextField
                variant="standard"
                label={I18n.t('Default hours')}
                style={styles.input}
                type="number"
                value={native.defaultHours ?? 72}
                onChange={e => onChange('defaultHours', parseInt(e.target.value, 10) || 0)}
            />
            <TextField
                variant="standard"
                label={I18n.t('Default max rows')}
                style={styles.input}
                type="number"
                value={native.defaultMaxRows ?? 500}
                onChange={e => onChange('defaultMaxRows', parseInt(e.target.value, 10) || 0)}
            />
        </form>
    );
}
