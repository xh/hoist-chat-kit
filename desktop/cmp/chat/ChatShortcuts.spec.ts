import {fireEvent, render, screen} from '@testing-library/react';
import {button} from '@xh/hoist/desktop/cmp/button';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatKit} from '../../../core';
import {getChatHotkeys} from './index';

/**
 * The kit's shortcuts in a frame of the app's own. An app that shows its threads outside a
 * workspace relies on binding the same New Chat key, remapped or dropped as it sets them.
 */
describe('getChatHotkeys', () => {
    beforeAll(() => initTestAppAsync());

    it('binds New Chat on a panel, from the combo in ChatKit.defaults', () => {
        const newChat = vi.fn();
        renderFrame(newChat);

        fireEvent.keyDown(screen.getByRole('button', {name: 'Inside'}), {
            key: 'O',
            ctrlKey: true,
            shiftKey: true
        });
        expect(newChat).toHaveBeenCalledOnce();
    });

    it('binds nothing for an action set to null', () => {
        const combo = ChatKit.defaults.shortcuts.newChat;
        ChatKit.defaults.shortcuts.newChat = null;
        onTestFinished(() => {
            ChatKit.defaults.shortcuts.newChat = combo;
        });

        expect(getChatHotkeys({newChat: vi.fn()})).toEqual([]);
    });
});

function renderFrame(newChat: () => void) {
    return render(
        panel({
            hotkeys: getChatHotkeys({newChat}),
            item: button({text: 'Inside'})
        })
    );
}
