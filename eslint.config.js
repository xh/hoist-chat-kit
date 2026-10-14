const {defineConfig, globalIgnores} = require('eslint/config'),
    xhEslintConfig = require('@xh/eslint-config'),
    prettier = require('eslint-config-prettier'),
    globals = require('globals');

module.exports = defineConfig([
    {
        extends: [xhEslintConfig, prettier]
    },

    // Repo automation scripts run under Node, not in the browser.
    {
        files: ['scripts/**/*', '.claude/**/*.{js,mjs}'],
        languageOptions: {
            globals: globals.node
        }
    },
    globalIgnores(['.tmp/**/*', '.vitest/**/*', 'build/**/*', 'node_modules/**/*'])
]);
