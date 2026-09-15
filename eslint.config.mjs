import config, { reactConfig } from '@iobroker/eslint-config';

const adminReactConfig = reactConfig.map(entry => ({
    ...entry,
    files: ['admin/src/**/*.{js,jsx}'],
}));

export default [
    ...config,
    {
        files: ['**/*.js'],
        rules: {
            'jsdoc/check-tag-names': 'off',
        },
    },
    ...adminReactConfig,
    {
        files: ['admin/src/**/*.{js,jsx}'],
        languageOptions: {
            globals: {
                document: 'readonly',
                window: 'readonly',
            },
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
        },
    },
    {
        ignores: [
            '.dev-server/',
            '.vscode/',
            '**/*.test.js',
            'test/**/*.js',
            '*.config.mjs',
            'build',
            'dist',
            'admin/build',
            'admin/words.js',
            '**/*.d.ts',
            '**/adapter-config.d.ts',
        ],
    },
];
