import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { buildReact, copyFiles, deleteFoldersRecursive, npmInstall, patchHtmlFile } from '@iobroker/build-tools';

// ts-node appends its own bootstrap arguments (including the relative "--project tsconfig.tasks.json")
// to process.execArgv, and child_process.fork() inherits them. The children started by
// @iobroker/build-tools run with cwd=src-admin, where that relative tsconfig does not exist.
// They are plain JS (vite) and do not need ts-node at all.
process.execArgv = [];

const SRC = `${__dirname}/src-admin`;

function clean(): void {
    // keep the adapter icon, everything else in admin/ is generated
    deleteFoldersRecursive(`${__dirname}/admin`, ['logsearch.png']);
    deleteFoldersRecursive(`${SRC}/build`);
}

function copyAllFiles(): void {
    // index.html is handled by patch(), as it becomes index_m.html and tab_m.html
    copyFiles(['src-admin/build/**/*', '!src-admin/build/index.html', '!src-admin/build/**/*.map'], 'admin/');
}

async function patch(): Promise<void> {
    const source = `${SRC}/build/index.html`;
    if (!existsSync(source)) {
        console.error(`${source} not found!`);
        process.exit(2);
    }
    // replace the development socket.io loader with the production script tag
    await patchHtmlFile(source, '../..');
    if (!readFileSync(source, 'utf8').includes('../../lib/js/socket.io.js')) {
        console.error(`${source} does not load socket.io from the admin instance - check the loader in index.html`);
        process.exit(2);
    }
    // the same bundle serves the config dialog and the admin tab
    copyFileSync(source, `${__dirname}/admin/index_m.html`);
    copyFileSync(source, `${__dirname}/admin/tab_m.html`);
}

function install(): Promise<void> {
    if (existsSync(`${SRC}/node_modules`)) {
        return Promise.resolve();
    }
    return npmInstall(SRC);
}

function build(): Promise<void> {
    return buildReact(`${SRC}/`, { rootDir: __dirname, vite: true });
}

function fail(e: unknown): never {
    console.error(`Cannot build the admin GUI: ${e as string}`);
    process.exit(1);
}

if (process.argv.includes('--0-clean')) {
    clean();
} else if (process.argv.includes('--1-npm')) {
    install().catch(fail);
} else if (process.argv.includes('--2-build')) {
    build().catch(fail);
} else if (process.argv.includes('--3-copy')) {
    copyAllFiles();
} else if (process.argv.includes('--4-patch')) {
    patch().catch(fail);
} else {
    clean();
    install()
        .then(() => build())
        .then(() => copyAllFiles())
        .then(() => patch())
        .catch(fail);
}
