/**
 * Vitest config, built on the `configureVitest()` preset from hoist-dev-utils. The preset compiles
 * specs with the same SWC settings and `XH` constants as an app build, and loads hoist-react's test
 * kit (`@xh/hoist/test-support`), which runs Hoist's real client services against a fake
 * hoist-core. See the "Unit Tests in an App" section of hoist-react's `docs/unit-testing.md`.
 */
import configureVitest from '@xh/hoist-dev-utils/configureVitest';
import {fileURLToPath} from 'node:url';
import {configDefaults, defineConfig, mergeConfig} from 'vitest/config';

// Blueprints branches only: the sibling hoist-react worktree, for `inlineHoist` below. The preset's
// default path assumes an app's `client-app` folder. Remove before merging to develop.
process.env.XH_HOIST_REACT_PATH ??= fileURLToPath(new URL('../hoist-react', import.meta.url));

export default defineConfig(
    mergeConfig(
        configureVitest({
            appCode: 'chatKit',
            appName: 'Hoist Chat Kit',
            appVersion: '1.0.0',
            appBuild: 'test',
            // Blueprints branches only: test against the sibling hoist-react worktree, as tsconfig
            // type-checks against it. Remove before merging to develop.
            inlineHoist: true,
            include: ['**/*.spec.{ts,tsx}']
        }),
        {
            test: {
                // Dot-directories are excluded so a run from the main checkout never collects specs
                // from worktrees under .claude/.
                exclude: [...configDefaults.exclude, 'build/**', '.*/**']
            }
        }
    )
);
