import { spawn } from 'node:child_process';

/** Install the locked GUI dependencies and reject every failed or interrupted installation. */
export function installGuiDependencies(directory: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // npm is a .cmd script on Windows and needs a shell there. All command arguments are fixed.
        const child = spawn('npm', ['ci'], {
            cwd: directory,
            stdio: 'inherit',
            shell: process.platform === 'win32',
        });
        child.once('error', reject);
        child.once('close', (code, signal) => {
            if (code === 0) {
                resolve();
            } else {
                reject(
                    new Error(`npm ci failed in ${directory} (${signal ? `signal ${signal}` : `exit code ${code}`})`),
                );
            }
        });
    });
}
