/**
 * Vitest config, built on the `configureVitest()` preset from hoist-dev-utils. The preset compiles
 * specs with the same SWC settings and `XH` constants as an app build, and loads hoist-react's test
 * kit (`@xh/hoist/test-support`), which runs Hoist's real client services against a fake
 * hoist-core. See the "Unit Tests in an App" section of hoist-react's `docs/unit-testing.md`.
 */
import configureVitest from '@xh/hoist-dev-utils/configureVitest';
import {configDefaults, defineConfig, mergeConfig} from 'vitest/config';

export default defineConfig(
    mergeConfig(
        configureVitest({
            appCode: 'chatKit',
            appName: 'Hoist Chat Kit',
            appVersion: '1.0.0',
            appBuild: 'test',
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
