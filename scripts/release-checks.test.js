'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

describe('release safeguards', () => {
    let fixture;
    const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'pipe' });
    const write = (name, value) => fs.writeFileSync(path.join(fixture, name), value);
    const run = (script, ...args) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
        cwd: fixture,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_REF: '' },
    });

    beforeEach(() => {
        fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'logsearch-release-'));
        fs.mkdirSync(path.join(fixture, 'admin/build'), { recursive: true });
        write('admin/build/index.js', 'committed build\n');
        git('init');
        git('add', '.');
        git('-c', 'user.name=Release Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false',
            'commit', '-m', 'Fixture');
        write('package.json', JSON.stringify({ version: '1.2.3' }));
        write('io-package.json', JSON.stringify({ common: { version: '1.2.3' } }));
        write('package-lock.json', JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
    });

    afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));

    it('accepts a committed build', () => {
        assert.equal(run('check-admin-assets.js').status, 0);
    });

    it('rejects changed build output', () => {
        write('admin/build/index.js', 'new build\n');
        assert.equal(run('check-admin-assets.js').status, 1);
    });

    it('rejects staged build output that differs from HEAD', () => {
        write('admin/build/index.js', 'new build\n');
        git('add', 'admin/build/index.js');
        assert.equal(run('check-admin-assets.js').status, 1);
    });

    it('rejects deleted build output', () => {
        fs.unlinkSync(path.join(fixture, 'admin/build/index.js'));
        assert.equal(run('check-admin-assets.js').status, 1);
    });

    it('rejects new build output', () => {
        write('admin/build/chunk.js', 'new chunk\n');
        assert.equal(run('check-admin-assets.js').status, 1);
    });

    it('rejects ignored new build output', () => {
        write('.gitignore', 'admin/build/*.map\n');
        write('admin/build/index.js.map', '{}');
        assert.equal(run('check-admin-assets.js').status, 1);
    });

    it('rejects a build entry point that is not tracked', () => {
        git('rm', '--cached', 'admin/build/index.js');
        assert.equal(run('check-admin-assets.js').status, 1);
    });

    it('accepts a matching release tag', () => {
        assert.equal(run('check-release.js', 'refs/tags/v1.2.3').status, 0);
    });

    for (const ref of ['', 'refs/heads/main', 'refs/tags/v1.2.4']) {
        it(`rejects a missing, branch or mismatched ref: ${ref}`, () => {
            assert.equal(run('check-release.js', ref).status, 1);
        });
    }

    for (const file of ['io-package.json', 'package-lock.json']) {
        it(`rejects a mismatched version in ${file}`, () => {
            const data = JSON.parse(fs.readFileSync(path.join(fixture, file), 'utf8'));
            if (file === 'io-package.json') data.common.version = '1.2.2';
            else data.version = '1.2.2';
            write(file, JSON.stringify(data));
            assert.equal(run('check-release.js', 'refs/tags/v1.2.3').status, 1);
        });
    }

    it('rejects a mismatched lockfile root package version', () => {
        write('package-lock.json', JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.2' } } }));
        assert.equal(run('check-release.js', 'refs/tags/v1.2.3').status, 1);
    });

    it('accepts matching prerelease versions', () => {
        write('package.json', JSON.stringify({ version: '1.2.4-beta.1' }));
        write('io-package.json', JSON.stringify({ common: { version: '1.2.4-beta.1' } }));
        write('package-lock.json', JSON.stringify({ version: '1.2.4-beta.1', packages: { '': { version: '1.2.4-beta.1' } } }));
        assert.equal(run('check-release.js', 'refs/tags/v1.2.4-beta.1').status, 0);
    });
});
