import {XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {showDesignKeys} from './designHotkeys';

/** The design keys' own list, as "?" shows it. */
describe('showDesignKeys', () => {
    beforeAll(() => initTestAppAsync());

    it('shows the keys in a dialog that Esc closes', () => {
        const alert = vi.spyOn(XH, 'alert').mockReturnValue(null);
        onTestFinished(() => alert.mockRestore());
        showDesignKeys();
        expect(alert).toHaveBeenCalledWith(
            expect.objectContaining({title: 'Keyboard shortcuts', dismissable: true})
        );
    });
});
