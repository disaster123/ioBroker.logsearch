import path from 'node:path';
import { tests } from '@iobroker/testing';

// Run integration tests - see https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'));
