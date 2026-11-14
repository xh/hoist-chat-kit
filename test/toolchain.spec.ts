import {HoistModel, XH} from '@xh/hoist/core';
import {bindable} from '@xh/hoist/mobx';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {createStreamingParser} from '@openuidev/lang-core';
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

    it('loads @openuidev/lang-core and parses a program against an empty library schema', () => {
        const parser = createStreamingParser(
            {
                $defs: {
                    Stack: {
                        type: 'object',
                        properties: {children: {type: 'array', items: {}}},
                        required: ['children']
                    }
                },
                properties: {Stack: {$ref: '#/$defs/Stack'}}
            },
            'Stack'
        );
        const result = parser.set('root = Stack([])', true);
        expect(result.root?.typeName).toBe('Stack');
    });
});
