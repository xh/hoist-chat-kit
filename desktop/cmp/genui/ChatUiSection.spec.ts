import {fireEvent, render, screen} from '@testing-library/react';
import {fragment} from '@xh/hoist/cmp/layout';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import type {ChatModel} from '../../../core';
import {ChatUiCatalog} from '../../../genui';
import {chatUiBadgesSpec} from './ChatUiBadges';
import {chatUiSectionSpec} from './ChatUiSection';

/**
 * The section spec groups the children of a nested answer in Hoist's Card. Apps rely on the
 * card's title and intent, on a section the user can collapse, and on a collapsed section that
 * builds its children only when first opened.
 */
describe('chatUiSectionSpec', () => {
    beforeAll(() => initTestAppAsync());

    const catalog = new ChatUiCatalog({components: [chatUiSectionSpec(), chatUiBadgesSpec()]}),
        doc = (props: object) => ({
            root: 'top',
            elements: {
                top: {component: 'section', props, children: ['a']},
                a: {component: 'badges', props: {badges: [{label: 'Inside'}, {label: 'More'}]}}
            }
        }),
        renderDoc = (props: object, isPartial = false) =>
            render(
                fragment({
                    item: catalog.renderDocument(doc(props), {
                        chatModel: null as ChatModel,
                        messageId: 'm1',
                        part: {type: 'data', id: 'd1', dataType: 'xh.chat.ui', data: null},
                        isPartial
                    })
                })
            );

    it('renders its children in a Hoist Card, with its title and the color of its intent', () => {
        const {container} = renderDoc({title: 'By desk', intent: 'warning'}),
            card = container.querySelector('.xh-card.xh-chat-ui-section');

        expect(card.className).toContain('xh-card--intent-warning');
        expect(card.querySelector('legend').textContent).toBe('By desk');
        expect(card.querySelector('.xh-card__content .xh-badge').textContent).toBe('Inside');
        // A section that cannot collapse has a plain header, not a button.
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('takes no color from an intent cut short as it streams', () => {
        const {container} = renderDoc({title: 'By desk', intent: 'warn'}, true);

        expect(container.querySelector('.xh-card').className).toContain('xh-card--intent-none');
    });

    it('collapses and expands on a click of its title, when collapsible', () => {
        const {container} = renderDoc({title: 'By desk', collapsible: true}),
            card = container.querySelector('.xh-card');
        expect(card.className).toContain('xh-card--expanded');

        fireEvent.click(screen.getByRole('button', {name: 'By desk'}));
        expect(card.className).toContain('xh-card--collapsed');

        fireEvent.click(screen.getByRole('button', {name: 'By desk'}));
        expect(card.className).toContain('xh-card--expanded');
    });

    it('builds the children of a collapsed section on first expand, and keeps them after', () => {
        const {container} = renderDoc({title: 'Detail', collapsed: true});
        expect(container.querySelector('.xh-card').className).toContain('xh-card--collapsed');
        expect(container.querySelector('.xh-badge')).toBeNull();

        fireEvent.click(screen.getByRole('button', {name: 'Detail'}));
        expect(container.querySelector('.xh-badge')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', {name: 'Detail'}));
        expect(container.querySelector('.xh-card').className).toContain('xh-card--collapsed');
        expect(container.querySelector('.xh-badge')).toBeTruthy();
    });

    it('never collapses with no title, as the title is the only way to expand', () => {
        const {container} = renderDoc({collapsible: true, collapsed: true});

        expect(container.querySelector('.xh-card').className).toContain('xh-card--expanded');
        expect(container.querySelector('.xh-badge')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('takes a collapse prop that arrives after the title, as the props stream', () => {
        const {container, rerender} = renderDoc({title: 'Detail'}, true);
        expect(screen.queryByRole('button')).toBeNull();

        rerender(
            fragment({
                item: catalog.renderDocument(doc({title: 'Detail', collapsible: true}), {
                    chatModel: null as ChatModel,
                    messageId: 'm1',
                    part: {type: 'data', id: 'd1', dataType: 'xh.chat.ui', data: null},
                    isPartial: true
                })
            })
        );

        expect(screen.getByRole('button', {name: 'Detail'})).toBeTruthy();
        expect(container.querySelector('.xh-badge')).toBeTruthy();
    });

    it('is a container that shows only inside a document, and reads as its title when copied', () => {
        const spec = chatUiSectionSpec();

        expect(spec.slots).toEqual(['default']);
        expect(spec.standalone).toBe(false);
        expect(catalog.validate('section', {title: 'By desk', intent: 'loud'})).not.toEqual([]);
        expect(spec.result({title: 'By desk'})).toBe('By desk');
        expect(spec.result({})).toBe('');
        expect(
            catalog.toCopyText([
                {type: 'document', document: doc({title: 'By desk'}), isPartial: false, source: ''}
            ])
        ).toBe('By desk\nInside, More');
    });
});
