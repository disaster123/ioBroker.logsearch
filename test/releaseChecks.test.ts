import { expect } from 'chai';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHECK_RELEASE = path.join(__dirname, '..', 'scripts', 'check-release.js');

describe('release safeguards', () => {
    let fixture: string;

    const write = (name: string, value: unknown): void =>
        fs.writeFileSync(path.join(fixture, name), typeof value === 'string' ? value : JSON.stringify(value));
    const run = (...args: string[]): number | null =>
        spawnSync(process.execPath, [CHECK_RELEASE, ...args], {
            cwd: fixture,
            encoding: 'utf8',
            env: { ...process.env, GITHUB_REF: '' },
        }).status;

    beforeEach(() => {
        fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'logsearch-release-'));
        write('package.json', { version: '1.2.3' });
        write('io-package.json', { common: { version: '1.2.3' } });
        write('package-lock.json', { version: '1.2.3', packages: { '': { version: '1.2.3' } } });
    });

    afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));

    it('accepts a matching release tag', () => {
        expect(run('refs/tags/v1.2.3')).to.equal(0);
    });

    for (const ref of ['', 'refs/heads/main', 'refs/tags/v1.2.4']) {
        it(`rejects a missing, branch or mismatched ref: ${ref}`, () => {
            expect(run(ref)).to.equal(1);
        });
    }

    for (const file of ['io-package.json', 'package-lock.json']) {
        it(`rejects a mismatched version in ${file}`, () => {
            const data = JSON.parse(fs.readFileSync(path.join(fixture, file), 'utf8'));
            if (file === 'io-package.json') {
                data.common.version = '1.2.2';
            } else {
                data.version = '1.2.2';
            }
            write(file, data);
            expect(run('refs/tags/v1.2.3')).to.equal(1);
        });
    }

    it('rejects a mismatched lockfile root package version', () => {
        write('package-lock.json', { version: '1.2.3', packages: { '': { version: '1.2.2' } } });
        expect(run('refs/tags/v1.2.3')).to.equal(1);
    });

    it('accepts matching prerelease versions', () => {
        write('package.json', { version: '1.2.4-beta.1' });
        write('io-package.json', { common: { version: '1.2.4-beta.1' } });
        write('package-lock.json', { version: '1.2.4-beta.1', packages: { '': { version: '1.2.4-beta.1' } } });
        expect(run('refs/tags/v1.2.4-beta.1')).to.equal(0);
    });
});
