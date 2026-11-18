import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiRenderContext} from '../../../genui';
import {chatUiSeparatorSpec} from './ChatUiSeparator';
import {chatUiStackSpec} from './ChatUiStack';

/**
 * The separator spec draws a rule between the parts of a nested answer, with Hoist's `hr` element.
 * Apps rely on a component that takes no props and adds nothing to copied text.
 */
describe('chatUiSeparatorSpec', () => {
    beforeAll(() => initTestAppAsync());

    it('renders a rule, takes no props, and adds no line to copied text', () => {
        const spec = chatUiSeparatorSpec(),
            catalog = new ChatUiCatalog({components: [chatUiStackSpec(), spec]}),
            {container} = render(spec.render({}, {} as ChatUiRenderContext) as ReactElement);

        expect(container.querySelector('hr.xh-chat-ui-separator')).toBeTruthy();
        expect(spec.standalone).toBe(false);
        expect(catalog.validate('separator', {})).toEqual([]);
        expect(catalog.validate('separator', {label: 'More'})).not.toEqual([]);
        expect(spec.result({})).toBe('');
    });
});
