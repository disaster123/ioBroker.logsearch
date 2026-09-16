import { expect } from 'chai';
import childProcess, { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as sinon from 'sinon';

import { installGuiDependencies } from '../scripts/install-gui-dependencies';

describe('locked GUI dependency installation', () => {
    let child: ChildProcess;
    let spawn: sinon.SinonStub;

    beforeEach(() => {
        child = new EventEmitter() as ChildProcess;
        spawn = sinon.stub(childProcess, 'spawn').returns(child);
    });

    afterEach(() => sinon.restore());

    it('runs npm ci without force and waits for successful process completion', async () => {
        let completed = false;
        const result = installGuiDependencies('/project with spaces/src-admin').then(() => {
            completed = true;
        });

        sinon.assert.calledOnceWithExactly(spawn, 'npm', ['ci'], {
            cwd: '/project with spaces/src-admin',
            stdio: 'inherit',
            shell: process.platform === 'win32',
        });
        await Promise.resolve();
        expect(completed).to.equal(false);
        child.emit('close', 0, null);
        await result;
        expect(completed).to.equal(true);
    });

    for (const code of [1, 2]) {
        it(`rejects npm exit code ${code}`, async () => {
            const result = installGuiDependencies('/project/src-admin').catch((error: Error) => error);
            child.emit('close', code, null);
            const error = await result;

            expect(error).to.be.instanceOf(Error);
            expect((error as Error).message).to.include(`exit code ${code}`);
        });
    }

    it('rejects an installation terminated by a signal', async () => {
        const result = installGuiDependencies('/project/src-admin').catch((error: Error) => error);
        child.emit('close', null, 'SIGTERM');
        const error = await result;

        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('signal SIGTERM');
    });

    it('preserves an error when npm cannot be started', async () => {
        const error = new Error('spawn npm ENOENT');
        const result = installGuiDependencies('/project/src-admin').catch((failure: Error) => failure);
        child.emit('error', error);
        child.emit('close', -2, null);

        expect(await result).to.equal(error);
    });

    it('rejects a synchronous process creation failure', async () => {
        const error = new Error('invalid process options');
        spawn.throws(error);

        expect(await installGuiDependencies('/project/src-admin').catch((failure: Error) => failure)).to.equal(error);
    });

    it('installs again on a subsequent build instead of trusting existing dependencies', async () => {
        const first = installGuiDependencies('/project/src-admin');
        child.emit('close', 0, null);
        await first;
        const second = installGuiDependencies('/project/src-admin');
        child.emit('close', 0, null);
        await second;

        sinon.assert.calledTwice(spawn);
    });
});
