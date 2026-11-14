import {fireEvent, render, screen} from '@testing-library/react';
import {div} from '@xh/hoist/cmp/layout';
import {TabContainerModel} from '@xh/hoist/cmp/tab';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatUiCatalog} from '../../../genui';
import {chatUiStackSpec} from './ChatUiStack';
import {chatUiTabs, chatUiTabsSpec} from './ChatUiTabs';

/**
 * The tabs spec shows the children of a nested answer one at a time, in Hoist's TabContainer.
 * Apps rely on a tab per child, named by position, on one TabContainerModel for the life of the
 * component as children stream in, and on a tab that builds its child only when first shown.
 */
describe('chatUiTabsSpec', () => {
    beforeAll(() => initTestAppAsync());

    const child = (text: string) => div({key: text, className: 'test-child', item: text}),
        shownChildren = (container: HTMLElement) =>
            [...container.querySelectorAll('.test-child')].map(it => it.textContent);

    it('renders a Hoist TabContainer with a tab per child, and shows the first', () => {
        const {container} = render(
            chatUiTabs({titles: ['Chart', 'Data'], items: [child('A chart'), child('A table')]})
        );

        expect(container.querySelector('.xh-tab-container.xh-chat-ui-tabs')).toBeTruthy();
        expect(screen.getAllByRole('tab').map(it => it.textContent)).toEqual(['Chart', 'Data']);
        expect(screen.getByRole('tab', {name: 'Chart'}).getAttribute('aria-selected')).toBe('true');
        // A tab builds its child when first shown.
        expect(shownChildren(container)).toEqual(['A chart']);
    });

    it('shows the child of a tab the user clicks, and keeps the one it leaves', () => {
        const {container} = render(
            chatUiTabs({titles: ['Chart', 'Data'], items: [child('A chart'), child('A table')]})
        );

        fireEvent.click(screen.getByRole('tab', {name: 'Data'}));

        expect(screen.getByRole('tab', {name: 'Data'}).getAttribute('aria-selected')).toBe('true');
        expect(shownChildren(container)).toEqual(['A chart', 'A table']);
    });

    it('keeps one TabContainerModel and the active tab as children and titles stream in', () => {
        const destroy = vi.spyOn(TabContainerModel.prototype, 'destroy');
        onTestFinished(() => destroy.mockRestore());

        const {container, rerender, unmount} = render(
            chatUiTabs({titles: ['Ch'], isPartial: true, items: [child('First')]})
        );
        expect(screen.getAllByRole('tab').map(it => it.textContent)).toEqual(['Ch']);

        // A second child arrives before its title, then a third. The user picks the second.
        rerender(
            chatUiTabs({
                titles: ['Chart'],
                isPartial: true,
                items: [child('First'), child('Second')]
            })
        );
        expect(screen.getAllByRole('tab').map(it => it.textContent)).toEqual(['Chart', 'Tab 2']);
        fireEvent.click(screen.getByRole('tab', {name: 'Tab 2'}));

        rerender(
            chatUiTabs({
                titles: ['Chart', 'Data', 'Notes'],
                items: [child('First'), child('Second now'), child('Third')]
            })
        );
        expect(screen.getAllByRole('tab').map(it => it.textContent)).toEqual([
            'Chart',
            'Data',
            'Notes'
        ]);
        expect(screen.getByRole('tab', {name: 'Data'}).getAttribute('aria-selected')).toBe('true');
        // The shown tab follows its child as it changes.
        expect(shownChildren(container)).toEqual(['First', 'Second now']);
        expect(destroy).not.toHaveBeenCalled();

        unmount();
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('shows a placeholder while it waits for its first child, and nothing with none', () => {
        const waiting = render(chatUiTabs({titles: ['Chart'], isPartial: true}));
        expect(waiting.container.querySelector('.xh-chat-ui-skeleton')).toBeTruthy();
        waiting.unmount();

        expect(render(chatUiTabs({titles: ['Chart']})).container.firstChild).toBeNull();
    });

    it('is a container that shows only inside a document, and bounds its tabs', () => {
        const spec = chatUiTabsSpec({maxTabs: 2}),
            catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), spec],
                modes: ['tools', 'document']
            });

        expect(spec.slots).toEqual(['default']);
        expect(spec.standalone).toBe(false);
        expect(catalog.toToolSchemas().map(it => it.name)).toEqual(['show_ui']);
        expect(catalog.validate('tabs', {titles: ['Chart', 'Data']})).toEqual([]);
        expect(catalog.validate('tabs', {titles: ['A', 'B', 'C']})).not.toEqual([]);
        expect(catalog.validate('tabs', {})).not.toEqual([]);
        expect(spec.result({titles: ['Chart', 'Data']})).toBe('Chart | Data');
    });
});
