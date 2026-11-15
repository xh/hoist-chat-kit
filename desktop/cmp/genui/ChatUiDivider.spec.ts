import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {chatUiDividerSpec} from './ChatUiDivider';
import {chatUiStackSpec} from './ChatUiStack';

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
});
