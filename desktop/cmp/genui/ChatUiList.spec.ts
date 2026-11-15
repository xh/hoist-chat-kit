import {render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {chatUiListSpec, type ChatUiListSpecProps} from './ChatUiList';
import {chatUiStackSpec} from './ChatUiStack';

/**
 * The list spec shows model-written entries as a Hoist ItemList. Apps rely on an entry per
 * complete title, on text that stays text, and on entries that take no click.
 */
describe('chatUiListSpec', () => {
    beforeAll(() => initTestAppAsync());

    const renderList = (props: ChatUiListSpecProps, isPartial = false) =>
            render(
                chatUiListSpec().render(props, {isPartial} as ChatUiRenderContext) as ReactElement
            ),
        texts = (container: HTMLElement, part: string) =>
            [...container.querySelectorAll(`.xh-item-list__${part}`)].map(it => it.textContent);

    it('renders an entry per title, with its description, detail and intent', () => {
        const {container} = renderList({
            items: [
                {title: 'Limit breach on Rates', detail: '09:42', intent: 'danger'},
                {title: 'Margin call settled', description: 'Paid in full by Acme Corp.'}
            ]
        });

        expect(container.querySelector('ul.xh-item-list.xh-chat-ui-list')).toBeTruthy();
        expect(texts(container, 'title')).toEqual(['Limit breach on Rates', 'Margin call settled']);
        expect(texts(container, 'detail')).toEqual(['09:42']);
        expect(texts(container, 'description')).toEqual(['Paid in full by Acme Corp.']);
        expect(container.querySelectorAll('.xh-item-list__entry--intent-danger')).toHaveLength(1);
    });

    it('numbers the entries of an ordered list', () => {
        const {container} = renderList({
            items: [{title: 'First'}, {title: 'Second'}],
            ordered: true
        });

        expect(container.querySelector('ol.xh-item-list')).toBeTruthy();
        expect(texts(container, 'marker')).toEqual(['1', '2']);
    });

    it('leaves out an entry with no title, a blank caption and an unknown intent', () => {
        const {container} = renderList({
            items: [
                {title: 'Kept', description: '  ', detail: '', intent: 'info' as any},
                {title: '  '},
                null,
                'text' as any
            ],
            ordered: 'yes' as any
        });

        expect(texts(container, 'title')).toEqual(['Kept']);
        expect(container.querySelector('.xh-item-list__description')).toBeNull();
        expect(container.querySelector('.xh-item-list__detail')).toBeNull();
        expect(container.querySelector('[class*="--intent-"]')).toBeNull();
        expect(container.querySelector('ol')).toBeNull();
    });

    it('shows only complete entries while the props stream, and nothing with no entry', () => {
        const {container, unmount} = renderList({items: [{title: 'First'}, {title: 'Sec'}]}, true);
        expect(texts(container, 'title')).toEqual(['First']);
        unmount();

        expect(renderList({items: [{title: 'Fi'}]}, true).container.firstChild).toBeNull();
        expect(renderList({items: null}).container.firstChild).toBeNull();
    });

    it('renders text as text, and gives an entry no click', () => {
        const {container} = renderList({
            items: [{title: '<b>Alert</b>', description: '[open](http://example.com)'}]
        });

        expect(container.querySelector('b, a')).toBeNull();
        expect(texts(container, 'title')).toEqual(['<b>Alert</b>']);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows only inside a document, bounds its list, and reads as its titles when copied', () => {
        const spec = chatUiListSpec({maxItems: 2}),
            catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), spec],
                modes: ['tools', 'document']
            }),
            item = {title: 'A'};

        expect(spec.standalone).toBe(false);
        expect(catalog.toToolSchemas().map(it => it.name)).toEqual(['show_ui']);
        expect(catalog.validate('list', spec.example)).toEqual([]);
        expect(catalog.validate('list', {items: [item, item, item]})).not.toEqual([]);
        expect(catalog.validate('list', {items: [{title: 'A', icon: 'bell'}]})).not.toEqual([]);
        expect(spec.result({items: [item, {title: 'B'}]})).toBe('A, B');
    });
});
