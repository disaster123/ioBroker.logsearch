import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => ({
    build: {
        outDir: 'build',
    },
    plugins: [react()],
    // the GUI is served from /adapter/logsearch/, so all asset URLs must be relative
    base: './',
    server: {
        port: 3000,
        proxy: {
            // during development socket.io and the adapter files come from a running admin instance
            '/adapter': {
                target: 'http://localhost:8081',
                changeOrigin: true,
                secure: false,
            },
            '/files': {
                target: 'http://localhost:8081',
                changeOrigin: true,
                secure: false,
            },
        },
    },
}));
