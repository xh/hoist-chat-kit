import {HoistModel, XH} from '@xh/hoist/core';
import {bindable} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';

// Checks the build and test toolchain, not product code: this repo's source compiles with Hoist's
// TC39 decorators, and the Hoist test kit boots an app against its fake hoist-core.

class ToolchainModel extends HoistModel {
    @bindable accessor text: string = null;
}

describe('toolchain', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    it('boots a Hoist test app', () => {
        expect(XH.appCode).toBe('chatKit');
        expect(XH.appIsRunning).toBe(true);
    });

    it('compiles TC39 decorators in package source', () => {
        const model = new ToolchainModel();
        model.text = 'hello';
        expect(model.text).toBe('hello');
        model.destroy();
    });
});
