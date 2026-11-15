import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {chatUiKeyValuesSpec, type ChatUiKeyValuesSpecProps} from './ChatUiKeyValues';
import {chatUiStackSpec} from './ChatUiStack';

/**
 * The key values spec shows model-written facts as a Hoist KeyValueList. Apps rely on an entry
 * per complete label, on numbers in the format the model chose, and on text that stays text.
 */
describe('chatUiKeyValuesSpec', () => {
    beforeAll(() => initTestAppAsync());

    // jsdom has no layout, and so no ResizeObserver.
    beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));

    const renderKeyValues = (props: ChatUiKeyValuesSpecProps, isPartial = false) =>
            render(
                chatUiKeyValuesSpec().render(props, {
                    isPartial
                } as ChatUiRenderContext) as ReactElement
            ),
        texts = (container: HTMLElement, part: string) =>
            [...container.querySelectorAll(`.xh-key-value-list__${part}`)].map(
                it => it.textContent
            );

    it('renders a labeled value per item, with each number in its format', () => {
        const {container} = renderKeyValues({
            items: [
                {label: 'Counterparty', value: 'Acme Corp'},
                {label: 'Exposure', value: 4200000, format: 'currency', decimals: 0},
                {label: 'Weight', value: 0.125, format: 'percent'},
                {label: 'Status', value: 'Under review', intent: 'warning'}
            ]
        });

        expect(container.querySelector('dl.xh-key-value-list.xh-chat-ui-key-values')).toBeTruthy();
        expect(texts(container, 'label')).toEqual(['Counterparty', 'Exposure', 'Weight', 'Status']);
        expect(texts(container, 'value')).toEqual([
            'Acme Corp',
            '$4,200,000',
            '12.5%',
            'Under review'
        ]);
        expect(
            container.querySelectorAll('.xh-key-value-list__entry--intent-warning')
        ).toHaveLength(1);
    });

    it('shows a dash for a value that is missing, blank or a list, and a boolean as text', () => {
        const {container} = renderKeyValues({
            items: [
                {label: 'Owner'},
                {label: 'Desk', value: '  '},
                {label: 'Tags', value: ['a', 'b'] as any},
                {label: 'Zero', value: 0},
                {label: 'Active', value: true},
                {label: 'Hedged', value: false}
            ]
        });

        expect(texts(container, 'value')).toEqual(['-', '-', '-', '0', 'true', 'false']);
    });

    it('takes the number of columns as the most, and shows fewer in a narrow chat', () => {
        // Hoist's list never uses more columns than it has entries.
        const items = ['A', 'B', 'C', 'D', 'E'].map(label => ({label, value: 1})),
            columnsOf = (width: number, columns?: number) => {
                vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
                return renderKeyValues({items, columns})
                    .container.querySelector<HTMLElement>('.xh-key-value-list')
                    .style.getPropertyValue('--xh-key-value-list-columns');
            };
        onTestFinished(() => {
            vi.restoreAllMocks();
        });

        expect(columnsOf(1000, 2)).toBe('2');
        expect(columnsOf(1000, 40)).toBe('4');
        expect(columnsOf(1000, 0)).toBe('3');
        expect(columnsOf(340, 2)).toBe('1');
        expect(columnsOf(500, 3)).toBe('2');
    });

    it('leaves out an item with no label, an unknown intent, and the last item while streaming', () => {
        const {container, unmount} = renderKeyValues({
            items: [
                {label: 'Rating', value: 'A+', intent: 'info' as any},
                {label: '', value: 'x'},
                null,
                'text' as any
            ]
        });
        expect(texts(container, 'label')).toEqual(['Rating']);
        expect(container.querySelector('[class*="--intent-"]')).toBeNull();
        unmount();

        const partial = renderKeyValues(
            {items: [{label: 'Rating', value: 'A+'}, {label: 'Sec'}]},
            true
        );
        expect(texts(partial.container, 'label')).toEqual(['Rating']);
        partial.unmount();

        expect(renderKeyValues({items: [{label: 'Ra'}]}, true).container.firstChild).toBeNull();
    });

    it('renders a label and a value as text, not as markup', () => {
        const {container} = renderKeyValues({
            items: [{label: '<i>Site</i>', value: '<a href="http://example.com">open</a>'}]
        });

        expect(container.querySelector('i, a')).toBeNull();
        expect(texts(container, 'value')).toEqual(['<a href="http://example.com">open</a>']);
    });

    it('shows only inside a document, shows a count past its most items, and reads as its labels when copied', () => {
        const spec = chatUiKeyValuesSpec({maxItems: 2}),
            catalog = new ChatUiCatalog({
                components: [chatUiStackSpec(), spec],
                modes: ['tools', 'document']
            }),
            item = {label: 'A', value: 1};

        expect(spec.standalone).toBe(false);
        expect(catalog.toToolSchemas().map(it => it.name)).toEqual(['show_ui']);
        expect(catalog.validate('keyValues', {items: [item, item], columns: 2})).toEqual([]);
        // More than the most shows the first ones and a count, rather than fail.
        expect(catalog.validate('keyValues', {items: [item, item, item]})).toEqual([]);
        const {container} = render(
            spec.render(
                {items: [item, item, item]} as any,
                {isPartial: false} as ChatUiRenderContext
            ) as ReactElement
        );
        expect(container.querySelector('.xh-chat-ui-more__note').textContent).toBe(
            '1 more not shown'
        );
        expect(spec.props.properties.items.description).toBe('At most 2.');
        expect(catalog.validate('keyValues', {items: [item], columns: 9})).not.toEqual([]);
        expect(catalog.validate('keyValues', {items: [{value: 1}]})).not.toEqual([]);
        expect(spec.result({items: [item, {label: 'B'}]})).toBe('A, B');
    });
});

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
