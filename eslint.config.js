const {defineConfig, globalIgnores} = require('eslint/config'),
    xhEslintConfig = require('@xh/eslint-config'),
    prettier = require('eslint-config-prettier'),
    globals = require('globals');

module.exports = defineConfig([
    {
        extends: [xhEslintConfig, prettier]
    },

    // Type-only imports must be explicit, as in Toolbox. Apps transpile the kit per file with SWC,
    // which cannot tell a type-only import apart. Marking it guarantees the build erases it, so
    // type-only references cannot form runtime import cycles.
    {
        files: ['**/*.ts', '**/*.tsx'],
        rules: {
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {
                    prefer: 'type-imports',
                    fixStyle: 'separate-type-imports',
                    disallowTypeAnnotations: true
                }
            ],
            '@typescript-eslint/consistent-type-exports': 'error',
            '@typescript-eslint/no-import-type-side-effects': 'error'
        }
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
