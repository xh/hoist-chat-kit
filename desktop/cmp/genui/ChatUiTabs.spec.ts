import {fireEvent, render, screen} from '@testing-library/react';
import {div, fragment} from '@xh/hoist/cmp/layout';
import {TabContainerModel} from '@xh/hoist/cmp/tab';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import type {ChatModel} from '../../../core';
import {ChatUiCatalog} from '../../../genui';
import {chatUiBadgesSpec} from './ChatUiBadges';
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
            [...container.querySelectorAll('.test-child')].map(it => it.textContent),
        tabNames = () => screen.getAllByRole('tab').map(it => it.textContent),
        isSelected = (tab: HTMLElement) => tab.getAttribute('aria-selected') === 'true';

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
        expect(tabNames()).toEqual(['Ch']);

        // A second title arrives, cut short. The user picks its tab.
        rerender(
            chatUiTabs({
                titles: ['Chart', 'Da'],
                isPartial: true,
                items: [child('First'), child('Second')]
            })
        );
        expect(tabNames()).toEqual(['Chart', 'Da']);
        fireEvent.click(screen.getByRole('tab', {name: 'Da'}));

        rerender(
            chatUiTabs({
                titles: ['Chart', 'Data', 'Notes'],
                items: [child('First'), child('Second now'), child('Third')]
            })
        );
        expect(tabNames()).toEqual(['Chart', 'Data', 'Notes']);
        expect(screen.getByRole('tab', {name: 'Data'}).getAttribute('aria-selected')).toBe('true');
        // The shown tab follows its child as it changes.
        expect(shownChildren(container)).toEqual(['First', 'Second now']);
        expect(destroy).not.toHaveBeenCalled();

        unmount();
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('shows no default name while titles are still to come, and one once the props are complete', () => {
        // OpenUI Lang writes the children before the titles.
        const items = [child('First'), child('Second')],
            {container, rerender} = render(chatUiTabs({isPartial: true, items}));
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
        expect(container.querySelector('.xh-chat-ui-skeleton')).toBeTruthy();

        rerender(chatUiTabs({titles: ['Chart'], isPartial: true, items}));
        expect(tabNames()).toEqual(['Chart']);

        rerender(chatUiTabs({titles: ['Chart'], items}));
        expect(tabNames()).toEqual(['Chart', 'Tab 2']);
    });

    it('removes the tabs of children that go away, and moves off a removed active tab', () => {
        const titles = ['Chart', 'Data', 'Notes'],
            {container, rerender} = render(
                chatUiTabs({titles, items: [child('First'), child('Second'), child('Third')]})
            );
        fireEvent.click(screen.getByRole('tab', {name: 'Notes'}));
        expect(shownChildren(container)).toEqual(['First', 'Third']);

        rerender(chatUiTabs({titles, items: [child('First'), child('Second')]}));

        expect(tabNames()).toEqual(['Chart', 'Data']);
        expect(screen.getAllByRole('tab').filter(isSelected)).toHaveLength(1);
        expect(container.querySelectorAll('.test-child').length).toBeGreaterThan(0);
        expect(shownChildren(container)).not.toContain('Third');
    });

    it('fills its tabs as a document streams, with a placeholder for a child still to come', () => {
        const catalog = new ChatUiCatalog({components: [chatUiTabsSpec(), chatUiBadgesSpec()]}),
            badges = (label: string) => ({
                component: 'badges',
                props: {badges: [{label}, {label: 'More'}]}
            }),
            renderDoc = (elements: object, isPartial: boolean) =>
                fragment({
                    item: catalog.renderDocument(
                        {
                            root: 'top',
                            elements: {
                                top: {
                                    component: 'tabs',
                                    props: {titles: ['Chart', 'Data']},
                                    children: ['a', 'b']
                                },
                                ...elements
                            }
                        },
                        {
                            chatModel: null as ChatModel,
                            messageId: 'm1',
                            part: {type: 'data', id: 'd1', dataType: 'xh.chat.ui', data: null},
                            isPartial
                        }
                    )
                }),
            {container, rerender} = render(renderDoc({a: badges('In A')}, true));

        expect(tabNames()).toEqual(['Chart', 'Data']);
        expect(container.querySelector('.xh-badge').textContent).toBe('In A');
        fireEvent.click(screen.getByRole('tab', {name: 'Data'}));
        expect(container.querySelector('.xh-chat-ui-fallback')).toBeNull();

        rerender(renderDoc({a: badges('In A'), b: badges('In B')}, false));
        expect(screen.getByRole('tab', {name: 'Data'}).getAttribute('aria-selected')).toBe('true');
        expect([...container.querySelectorAll('.xh-badge')].map(it => it.textContent)).toEqual([
            'In A',
            'More',
            'In B',
            'More'
        ]);
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
