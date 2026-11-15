import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {chatUiDividerSpec} from './ChatUiDivider';
import {chatUiFormSpec} from './ChatUiForm';
import {chatUiSectionSpec} from './ChatUiSection';
import {chatUiStack, chatUiStackSpec} from './ChatUiStack';
import {chatUiTabsSpec} from './ChatUiTabs';

/**
 * The divider spec draws a rule between the parts of a nested answer, with Hoist's `Separator`.
 * Apps rely on a rule that needs no props, and on a label that shows as text.
 */
describe('chatUiDividerSpec', () => {
    beforeAll(() => initTestAppAsync());

    it('renders a Hoist Separator with no props, and adds no line to copied text', () => {
        const spec = chatUiDividerSpec(),
            catalog = new ChatUiCatalog({components: [chatUiStackSpec(), spec]}),
            {container} = render(spec.render({}, {} as ChatUiRenderContext) as ReactElement),
            rule = container.querySelector('.xh-separator.xh-chat-ui-divider');

        expect(rule.getAttribute('role')).toBe('separator');
        expect(rule.textContent).toBe('');
        expect(spec.standalone).toBe(false);
        expect(catalog.validate('divider', {})).toEqual([]);
        expect(catalog.validate('divider', {title: 'More'})).not.toEqual([]);
        expect(spec.result({})).toBe('');
    });

    it('shows a label within the rule, as text', () => {
        const spec = chatUiDividerSpec(),
            catalog = new ChatUiCatalog({components: [chatUiStackSpec(), spec]}),
            {container} = render(
                spec.render({label: '<b>Details</b>'}, {} as ChatUiRenderContext) as ReactElement
            );

        expect(container.querySelector('b')).toBeNull();
        expect(container.querySelector('.xh-separator__label').textContent).toBe('<b>Details</b>');
        expect(catalog.validate('divider', {label: 'Details'})).toEqual([]);
        expect(spec.result({label: 'Details'})).toBe('Details');
    });

    it('draws a plain rule for a label that is blank or not text', () => {
        const spec = chatUiDividerSpec(),
            labelOf = (label: unknown) =>
                render(
                    spec.render({label} as any, {} as ChatUiRenderContext) as ReactElement
                ).container.querySelector('.xh-separator__label');

        expect(labelOf('  ')).toBeNull();
        expect(labelOf(12)).toBeNull();
    });

    it('stands as a vertical rule with no label in a row, and lies across a column', () => {
        const spec = chatUiDividerSpec(),
            ruleIn = (direction: 'row' | 'column') =>
                render(
                    chatUiStack({
                        direction,
                        items: [spec.render({label: 'More'}, {} as ChatUiRenderContext)]
                    })
                ).container.querySelector('.xh-chat-ui-divider');

        const vertical = ruleIn('row');
        expect(vertical.getAttribute('aria-orientation')).toBe('vertical');
        expect(vertical.classList).toContain('xh-separator--vertical');
        expect(vertical.textContent).toBe('');

        const horizontal = ruleIn('column');
        expect(horizontal.getAttribute('aria-orientation')).toBe('horizontal');
        expect(horizontal.textContent).toBe('More');
    });

    it.each([
        ['section', () => chatUiSectionSpec(), {title: 'Detail'}],
        ['form', () => chatUiFormSpec(), {title: 'Detail'}],
        ['tabs', () => chatUiTabsSpec(), {titles: ['Detail']}]
    ])('lies across a %s that sits in a row, with its label', (_, container, props) => {
        const rule = chatUiDividerSpec().render({label: 'Middle'}, {} as ChatUiRenderContext),
            inner = container().render(
                props as any,
                {
                    children: [rule],
                    isPartial: false,
                    element: {component: 'x', props: {}}
                } as unknown as ChatUiRenderContext
            ),
            divider = render(
                chatUiStack({direction: 'row', items: [inner]})
            ).container.querySelector('.xh-chat-ui-divider');

        expect(divider.getAttribute('aria-orientation')).toBe('horizontal');
        expect(divider.textContent).toBe('Middle');
    });
});
