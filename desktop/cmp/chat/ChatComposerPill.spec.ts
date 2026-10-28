import {fireEvent, render, screen} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
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

    it('marks a setting that is on', () => {
        render(chatComposerPill({text: 'Web search', active: true}));

        const pill = screen.getByRole('button', {name: 'Web search'});
        expect(pill.classList).toContain('xh-chat-composer-pill--active');
        expect(pill.getAttribute('aria-disabled')).toBeNull();
    });
});
