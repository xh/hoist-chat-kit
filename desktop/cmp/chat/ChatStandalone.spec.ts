import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {chatMarkdown} from '../../../cmp/markdown';
import {chatCodeBlock} from './ChatCodeBlock';
import {chatComposerPill} from './ChatComposerPill';
import {chatCopyButton} from './ChatCopyButton';
import {chatElapsed} from './ChatElapsed';
import {chatEmptyState} from './ChatEmptyState';
import {chatErrorBoundary} from './ChatErrorBoundary';
import {chatFileChip} from './ChatFileChip';
import {CHAT_MARKDOWN_COMPONENTS} from './ChatMarkdownComponents';
import {chatReasoning} from './ChatReasoning';
import {chatSources} from './ChatSources';
import {chatStatusCue} from './ChatStatusCue';
import {chatSuggestions} from './ChatSuggestions';

/**
 * The building blocks an app may render inside another library's components, with no Hoist model
 * above them. Apps rely on each one rendering there, rather than showing "No model found" or
 * throwing.
 */
describe('building blocks with no model in context', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    });

    const cases: Record<string, () => ReactElement> = {
        ChatSources: () =>
            chatSources({
                sources: [
                    {type: 'source', id: 's1', sourceType: 'document', title: 'Doc', marker: 1}
                ]
            }),
        ChatCodeBlock: () => chatCodeBlock({content: 'print(1)', language: 'python'}),
        ChatCopyButton: () => chatCopyButton({getCopyText: () => 'text'}),
        ChatErrorBoundary: () => chatErrorBoundary({item: chatCopyButton({getCopyText: () => ''})}),
        ChatReasoning: () =>
            chatReasoning({
                part: {
                    type: 'reasoning',
                    id: 'r1',
                    text: 'Thinking',
                    state: 'done',
                    startedAt: 0,
                    endedAt: 2000
                }
            }),
        ChatFileChip: () =>
            chatFileChip({
                file: {type: 'file', id: 'f1', name: 'a.pdf', mediaType: 'application/pdf'}
            }),
        ChatElapsed: () => chatElapsed({startedAt: Date.now() - 5000, endedAt: Date.now()}),
        ChatStatusCue: () => chatStatusCue({status: 'streaming'}),
        ChatComposerPill: () => chatComposerPill({text: 'Scope'}),
        ChatEmptyState: () => chatEmptyState({title: 'Ask anything'}),
        ChatSuggestions: () => chatSuggestions({suggestions: ['One'], onSelect: () => {}})
    };

    for (const [name, element] of Object.entries(cases)) {
        it(`renders ${name}`, () => {
            const {container} = render(element());
            expect(container.textContent).not.toContain('No model found');
            expect(container.innerHTML).not.toBe('');
        });
    }

    // BUG: Hoist's `Markdown`, which renders each block, declares no model spec, so it looks up
    // any model and finds none. Passes once hoist-react gives it `model: false`.
    it.fails('renders ChatMarkdown, with a long table and a code fence', () => {
        const rows = Array.from({length: 120}, (_, idx) => `| ${idx} | x |`).join('\n'),
            {container} = render(
                chatMarkdown({
                    content: `| A | B |\n|---|---|\n${rows}\n\n\`\`\`ts\nconst a = 1;\n\`\`\``,
                    components: CHAT_MARKDOWN_COMPONENTS
                })
            );
        expect(container.textContent).not.toContain('No model found');
    });
});

//------------------
// Helpers
//------------------
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
