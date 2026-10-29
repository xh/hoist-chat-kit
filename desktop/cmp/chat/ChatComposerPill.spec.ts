import {fireEvent, render, screen} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import {button} from '@xh/hoist/desktop/cmp/button';
import {chatComposerPill} from './ChatComposerPill';

/**
 * The composer's pills. Apps rely on a disabled pill keeping its tab stop and tooltip - the only
 * place it says why - while opening nothing, and on a pill showing its setting as on.
 */
describe('ChatComposerPill', () => {
    beforeAll(() => initTestAppAsync());

    const menuItems = [{text: 'Web search'}];

    it('opens its menu on a click', () => {
        render(chatComposerPill({text: 'Tools', menuItems}));

        const pill = screen.getByRole('button', {name: 'Tools'});
        fireEvent.click(pill);
        expect(pill.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('Web search')).toBeTruthy();
    });

    it('stays focusable when disabled, and opens nothing', () => {
        render(chatComposerPill({text: 'Tools', menuItems, disabled: true, tooltip: 'Locked'}));

        const pill = screen.getByRole('button', {name: 'Tools'});
        expect(pill.getAttribute('aria-disabled')).toBe('true');
        expect(pill.hasAttribute('disabled')).toBe(false);
        expect(pill.classList).toContain('xh-chat-composer-pill--disabled');

        fireEvent.click(pill);
        expect(pill.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('Web search')).toBeNull();
    });

    it('closes when disabled while open, and stays closed once enabled', () => {
        const {rerender} = render(chatComposerPill({text: 'Tools', menuItems}));
        const pill = () => screen.getByRole('button', {name: 'Tools'});
        fireEvent.click(pill());
        expect(pill().getAttribute('aria-expanded')).toBe('true');

        rerender(chatComposerPill({text: 'Tools', menuItems, disabled: true}));
        expect(pill().getAttribute('aria-expanded')).toBe('false');
        expect(pill().classList).not.toContain('xh-chat-composer-pill--open');

        rerender(chatComposerPill({text: 'Tools', menuItems}));
        expect(pill().getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('Web search')).toBeNull();
    });

    it("reports each open and close, and adds the app's class to its popover", () => {
        const onOpenChange = vi.fn(),
            {rerender} = render(
                chatComposerPill({
                    text: 'Tools',
                    menuItems,
                    onOpenChange,
                    popoverClassName: 'app-pop'
                })
            ),
            pill = () => screen.getByRole('button', {name: 'Tools'});

        fireEvent.click(pill());
        expect(onOpenChange).toHaveBeenLastCalledWith(true);
        const popover = document.querySelector('.xh-chat-composer-pill__popover');
        expect(popover.classList).toContain('app-pop');

        rerender(
            chatComposerPill({
                text: 'Tools',
                menuItems,
                onOpenChange,
                popoverClassName: 'app-pop',
                disabled: true
            })
        );
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        expect(onOpenChange).toHaveBeenCalledTimes(2);
    });

    it('reports a close once, however many calls close it before it renders', () => {
        const onOpenChange = vi.fn();
        render(
            chatComposerPill({
                text: 'Skills',
                onOpenChange,
                // As a menu item that closes the popover, which Blueprint then dismisses too.
                content: close =>
                    button({
                        text: 'Charts',
                        onClick: () => {
                            close();
                            close();
                        }
                    })
            })
        );

        fireEvent.click(screen.getByRole('button', {name: 'Skills'}));
        fireEvent.click(screen.getByRole('button', {name: 'Charts'}));
        expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    });

    it('closes, and stays closed, when its popup goes while open', () => {
        const onOpenChange = vi.fn(),
            {rerender} = render(chatComposerPill({text: 'Tools', menuItems, onOpenChange}));
        fireEvent.click(screen.getByRole('button', {name: 'Tools'}));

        rerender(chatComposerPill({text: 'Tools', onOpenChange}));
        rerender(chatComposerPill({text: 'Tools', menuItems, onOpenChange}));
        expect(screen.queryByText('Web search')).toBeNull();
        expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    });

    it('marks a setting that is on', () => {
        render(chatComposerPill({text: 'Web search', active: true}));

        const pill = screen.getByRole('button', {name: 'Web search'});
        expect(pill.classList).toContain('xh-chat-composer-pill--active');
        expect(pill.getAttribute('aria-disabled')).toBeNull();
    });
});
