import {describe, expect, it} from 'vitest';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec} from '../ChatUiComponentSpec';
import type {ChatUiFormatContext} from '../ChatUiTextFormat';
import {chatUiTagFormat} from './ChatUiTagFormat';

/**
 * The tag format is the catalog's default text format: component tags in the reply's markdown.
 * Apps rely on it to parse exactly as `parseTags()` always has, and to teach the model the same
 * grammar it parses.
 */
describe('chatUiTagFormat', () => {
    const catalog = new ChatUiCatalog({components: [NOTE]}),
        format = chatUiTagFormat();

    it('parses the same segments as catalog.parseTags for a tag, a partial tag and a fenced tag', () => {
        const cases: [string, boolean][] = [
            ['Here:\n<ui-note text="a"/>\nDone.', false],
            ['Here:\n<ui-note text="a', true],
            ['```\n<ui-note text="a"/>\n```', false]
        ];

        expect(format.name).toBe('tags');
        cases.forEach(([text, isStreaming]) => {
            const segments = format.parse(text, context(isStreaming));
            expect(segments).toEqual(catalog.parseTags(text, {isStreaming}));
        });
        expect(format.parse(cases[1][0], context(true)).map(it => it.type)).toEqual([
            'markdown',
            'placeholder'
        ]);
    });

    it('writes the tags section of the prompt, with each component and its example', () => {
        const prompt = format.toPrompt({catalog}, {});

        expect(prompt.startsWith('### Component tags\n')).toBe(true);
        expect(prompt).toContain(`\`<ui-NAME prop="text" prop='JSON'/>\``);
        expect(prompt).toContain('#### ui-note\nA note.');
        expect(prompt).toContain('- text (string, required)');
        expect(prompt).toContain('Example: <ui-note text="hi"/>');
    });

    function context(isStreaming: boolean): ChatUiFormatContext {
        return {catalog, isStreaming, messageId: null, partId: null, index: 0};
    }
});

//------------------
// Helpers
//------------------
const NOTE: ChatUiComponentSpec = {
    name: 'note',
    description: 'A note.',
    props: {type: 'object', required: ['text'], properties: {text: {type: 'string'}}},
    render: () => null,
    example: {text: 'hi'}
};
