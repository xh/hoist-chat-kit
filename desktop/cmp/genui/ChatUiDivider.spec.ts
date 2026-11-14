import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {chatUiDividerSpec} from './ChatUiDivider';
import {chatUiStackSpec} from './ChatUiStack';

/**
 * The divider spec draws a rule between the parts of a nested answer, with Hoist's `hr` element.
 * Apps rely on a component that takes no props and adds nothing to copied text.
 */
describe('chatUiDividerSpec', () => {
    beforeAll(() => initTestAppAsync());

    it('renders a rule, takes no props, and adds no line to copied text', () => {
        const spec = chatUiDividerSpec(),
            catalog = new ChatUiCatalog({components: [chatUiStackSpec(), spec]}),
            {container} = render(spec.render({}, {} as ChatUiRenderContext) as ReactElement);

        expect(container.querySelector('hr.xh-chat-ui-divider')).toBeTruthy();
        expect(spec.standalone).toBe(false);
        expect(catalog.validate('divider', {})).toEqual([]);
        expect(catalog.validate('divider', {label: 'More'})).not.toEqual([]);
        expect(spec.result({})).toBe('');
    });
});
