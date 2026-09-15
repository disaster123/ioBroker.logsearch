'use strict';

const { execFileSync } = require('node:child_process');

// Compare with HEAD so staged changes cannot hide an outdated build.
execFileSync('git', ['ls-files', '--error-unmatch', 'admin/build/index.js'], { stdio: 'pipe' });
const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'admin/build'], { encoding: 'utf8' });
// Include ignored files as well: new build outputs must be committed, too.
const untracked = execFileSync('git', ['ls-files', '--others', '--', 'admin/build'], { encoding: 'utf8' });

if (changed.trim() || untracked.trim()) {
    throw new Error(
        `Admin assets differ from the committed build:\n${changed}${untracked}` +
            'Run npm run build and commit all changes in admin/build before tagging a release.',
    );
}

console.log('Admin assets match the committed build.');
