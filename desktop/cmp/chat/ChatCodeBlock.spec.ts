import {act, fireEvent, render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {fragment} from '@xh/hoist/cmp/layout';
import {creates, hoistCmp, HoistModel} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {chatMarkdown} from '../../../cmp/markdown';
import {chatCodeBlock} from './ChatCodeBlock';
import {CHAT_MARKDOWN_COMPONENTS} from './ChatMarkdownComponents';

/**
 * A long code block collapses to its first 20 lines. Users rely on the count in "Show N more
 * lines" being the lines they will see, and on a block that streams not collapsing under them.
 */
describe('ChatCodeBlock', () => {
    beforeAll(() => initTestAppAsync());

    it('counts no line for a final newline', () => {
        render(host(chatCodeBlock({content: lines(20) + '\n'})));
        expect(screen.queryByRole('button', {name: /more line/})).toBeNull();
    });

    it('collapses a long block, and says how many lines it hides', () => {
        render(host(chatCodeBlock({content: lines(23)})));
        expect(screen.getByRole('button', {name: 'Show 3 more lines'})).toBeTruthy();
    });

    it('shows the rest and then fewer from one button, which keeps focus', async () => {
        render(host(chatCodeBlock({content: lines(23)})));
        const toggle = screen.getByRole('button', {name: 'Show 3 more lines'});
        toggle.focus();

        await act(() => fireEvent.click(toggle));
        expect(screen.getByText(/line 23/)).toBeTruthy();
        expect(document.activeElement.textContent).toBe('Show fewer lines');
        expect(document.activeElement.getAttribute('aria-expanded')).toBe('true');

        await act(() => fireEvent.click(document.activeElement));
        expect(screen.queryByText(/line 23/)).toBeNull();
        expect(document.activeElement.textContent).toBe('Show 3 more lines');
    });

    it('renders with no model in context, as inside another library', () => {
        render(chatCodeBlock({content: 'print(1)', language: 'python'}));
        expect(screen.getByText('print(1)')).toBeTruthy();
        expect(screen.getByRole('button', {name: 'Copy'})).toBeTruthy();
    });

    it('shows a block in full while it streams, and collapses it once the reply ends', () => {
        const content = '```ts\n' + lines(25) + '\n```',
            props = {content, components: CHAT_MARKDOWN_COMPONENTS},
            {rerender} = render(host(chatMarkdown({...props, isStreaming: true})));
        expect(screen.queryByRole('button', {name: /more line/})).toBeNull();
        expect(screen.getByText(/line 25/)).toBeTruthy();

        rerender(host(chatMarkdown({...props, isStreaming: false})));
        expect(screen.getByRole('button', {name: 'Show 5 more lines'})).toBeTruthy();
    });
});

//------------------
// Helpers
//------------------
class HostModel extends HoistModel {}

// The block renders where a chat does: below a model in context.
const host = hoistCmp.factory({
    model: creates(HostModel),
    render: ({children}) => fragment(children as ReactElement)
});

function lines(count: number): string {
    return Array.from({length: count}, (_, idx) => `line ${idx + 1}`).join('\n');
}
