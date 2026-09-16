import React from 'react';
import { createRoot } from 'react-dom/client';

import pack from '../package.json';
import App from './App';
import './index.css';

window.adapterName = 'logsearch';

console.log(`iobroker.${window.adapterName}@${pack.version}`);

const container = window.document.getElementById('root');

if (container) {
    createRoot(container).render(<App />);
}
