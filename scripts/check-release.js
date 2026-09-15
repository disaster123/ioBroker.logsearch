'use strict';

const { readFileSync } = require('node:fs');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const io = JSON.parse(readFileSync('io-package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const ref = process.argv[2] || process.env.GITHUB_REF;
const expectedRef = `refs/tags/v${pkg.version}`;

if (ref !== expectedRef) {
    throw new Error(`Release ref ${ref || '(missing)'} does not match ${expectedRef}.`);
}

if (io.common.version !== pkg.version || lock.version !== pkg.version || lock.packages[''].version !== pkg.version) {
    throw new Error('Release versions in package.json, io-package.json and package-lock.json must match.');
}

console.log(`Release tag and package versions match: ${pkg.version}.`);
