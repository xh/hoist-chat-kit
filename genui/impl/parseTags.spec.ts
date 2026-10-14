import type {PlainObject} from '@xh/hoist/core';
import {describe, expect, it} from 'vitest';
import {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec} from '../ChatUiComponentSpec';

/**
 * The tag parser reads component tags that a model writes into markdown. The markup is untrusted
 * model output, so the parser must read only well-formed tags of catalog components, keep every
 * other character as markdown, never treat code as a tag, and hold back a tag still streaming.
 */
describe('parseTags', () => {
    const catalog = new ChatUiCatalog({components: [grid(), note()]});

    describe('splitting', () => {
        it('splits text into markdown and component segments, in order', () => {
            expect(catalog.parseTags('Sales:\n<ui-grid data="sales"/>\nDone.')).toEqual([
                {type: 'markdown', text: 'Sales:\n'},
                {
                    type: 'component',
                    element: {component: 'grid', props: {data: 'sales'}},
                    source: '<ui-grid data="sales"/>'
                },
                {type: 'markdown', text: '\nDone.'}
            ]);
        });

        it('returns text with no tags as one markdown segment, and empty text as none', () => {
            expect(catalog.parseTags('Just **text**.')).toEqual([
                {type: 'markdown', text: 'Just **text**.'}
            ]);
            expect(catalog.parseTags('')).toEqual([]);
            expect(catalog.parseTags(null)).toEqual([]);
        });

        it('parses adjacent tags, and tags with no attributes', () => {
            const types = catalog
                .parseTags('<ui-note text="a"/><ui-note text="b" />')
                .map(it => it.type);
            expect(types).toEqual(['component', 'component']);
        });

        it('accepts an open tag closed at once', () => {
            const [segment] = catalog.parseTags('<ui-note text="a"></ui-note>');
            expect(segment).toMatchObject({type: 'component', element: {props: {text: 'a'}}});
        });

        it('uses the configured prefix', () => {
            const custom = new ChatUiCatalog({components: [note()], tagPrefix: 'app-'}),
                segments = custom.parseTags('<ui-note text="a"/><app-note text="b"/>');
            expect(segments).toMatchObject([
                {type: 'markdown', text: '<ui-note text="a"/>'},
                {type: 'component', element: {props: {text: 'b'}}}
            ]);
        });

        it('refuses a prefix that is not a plain name', () => {
            expect(() => new ChatUiCatalog({components: [note()], tagPrefix: 'x:'})).toThrow(
                'tagPrefix'
            );
        });
    });

    describe('attributes', () => {
        it.each<[string, string, PlainObject]>([
            ['a string', `<ui-grid data="sales"/>`, {data: 'sales'}],
            ['a single-quoted string', `<ui-grid data='sales'/>`, {data: 'sales'}],
            [
                'a JSON list',
                `<ui-grid data="s" columns='["a","b"]'/>`,
                {data: 's', columns: ['a', 'b']}
            ],
            [
                'a JSON object list',
                `<ui-grid data="s" filter='[{"field":"region","op":"eq","value":"EMEA"}]'/>`,
                {data: 's', filter: [{field: 'region', op: 'eq', value: 'EMEA'}]}
            ],
            ['a number, for a numeric prop', `<ui-grid data="s" top="10"/>`, {data: 's', top: 10}],
            [
                'a boolean, for a boolean prop',
                `<ui-grid data="s" compact="true"/>`,
                {data: 's', compact: true}
            ],
            ['digits, for a string prop', `<ui-grid data="2024"/>`, {data: '2024'}],
            [
                'brackets, for a string prop',
                `<ui-grid data="s" title="[Draft] Q3"/>`,
                {data: 's', title: '[Draft] Q3'}
            ],
            [
                'JSON-looking text, for a string prop',
                `<ui-grid data='{"a":1}'/>`,
                {data: '{"a":1}'}
            ],
            [
                'an entity',
                `<ui-grid data="s" title="A &amp; B &quot;C&quot;"/>`,
                {data: 's', title: 'A & B "C"'}
            ],
            ['a bare ampersand', `<ui-grid data="s" title="P&L"/>`, {data: 's', title: 'P&L'}],
            [
                'angle brackets in quotes',
                `<ui-grid data="s" title="a < b > c"/>`,
                {data: 's', title: 'a < b > c'}
            ],
            [
                'a tag-like value',
                `<ui-grid data="s" title="<ui-note/>"/>`,
                {data: 's', title: '<ui-note/>'}
            ],
            [
                'the other quote',
                `<ui-grid data="s" title="it's 'here'"/>`,
                {data: 's', title: "it's 'here'"}
            ],
            ['a line break', `<ui-grid data="s" title="a\nb"/>`, {data: 's', title: 'a\nb'}],
            ['attributes over lines', `<ui-grid\n  data="s"\n  top="3"\n/>`, {data: 's', top: 3}]
        ])('reads %s', (_, tag, props) => {
            expect(catalog.parseTags(tag)).toEqual([
                {type: 'component', element: {component: 'grid', props}, source: tag}
            ]);
        });

        it('reads a DOCTYPE and a custom entity in a value as plain text', () => {
            const title = "<!DOCTYPE x [<!ENTITY e 'boom'>]>&e;",
                tag = `<ui-grid data="s" title="${title}"/>`;
            expect(catalog.parseTags(tag)).toMatchObject([
                {type: 'component', element: {props: {data: 's', title}}}
            ]);
        });

        it('keeps a script in a value as plain text, checked like any other', () => {
            const tag = `<ui-grid data="s" title="<script>alert(1)</script>"/>`;
            expect(catalog.parseTags(tag)).toMatchObject([
                {type: 'component', element: {props: {title: '<script>alert(1)</script>'}}}
            ]);
        });
    });

    describe('fallbacks', () => {
        it.each<[string, string, string]>([
            ['an unknown component', '<ui-chart data="s"/>', "unknown component 'chart'"],
            [
                'invalid props',
                '<ui-grid data="s" top="many"/>',
                'top: expected integer, got string'
            ],
            ['a missing required prop', '<ui-grid title="x"/>', 'data: required'],
            ['an unknown prop', '<ui-grid data="s" color="red"/>', 'color: unknown property'],
            ['broken JSON', `<ui-grid data="s" columns='["a",'/>`, 'columns: invalid JSON'],
            ['an unquoted value', '<ui-grid data=s/>', 'could not read the attributes'],
            [
                'a value-less attribute',
                '<ui-grid data="s" compact/>',
                'could not read the attributes'
            ],
            [
                'a repeated attribute',
                '<ui-grid data="a" data="b"/>',
                'could not read the attributes'
            ],
            [
                'a namespaced attribute',
                '<ui-grid data="s" x:y="1"/>',
                'could not read the attributes'
            ],
            ['an open tag never closed', '<ui-grid data="s">', 'expected a self-closing tag'],
            ['an unclosed tag at the end', '<ui-grid data="s"', 'expected the tag to end with />']
        ])('renders %s as a fallback', (_, tag, error) => {
            const [segment] = catalog.parseTags(tag);
            expect(segment).toMatchObject({type: 'fallback', source: tag});
            expect((segment as any).errors.join('\n')).toContain(error);
        });

        it('names the component of a fallback, if known, with the props it read', () => {
            expect(catalog.parseTags('<ui-grid data="s" top="0"/>')[0]).toMatchObject({
                type: 'fallback',
                component: 'grid',
                props: {data: 's', top: 0}
            });
            expect(catalog.parseTags('<ui-chart/>')[0]).toMatchObject({component: null});
        });

        it('ends a broken tag at the next tag, which still parses', () => {
            const segments = catalog.parseTags('<ui-grid data="s" <ui-note text="ok"/>');
            expect(segments.map(it => it.type)).toEqual(['fallback', 'component']);
            expect(segments[0]).toMatchObject({source: '<ui-grid data="s" '});
        });

        it('refuses a tag longer than the cap', () => {
            const tag = `<ui-note text="${'x'.repeat(20001)}"/>`;
            expect(catalog.parseTags(tag)[0]).toMatchObject({type: 'fallback'});
        });
    });

    describe('untrusted names', () => {
        it('treats a name inherited by every object as unknown, never as a component', () => {
            for (const name of ['constructor', 'toString', '__proto__']) {
                const [segment] = catalog.parseTags(`<ui-${name}/>`);
                expect(segment).toMatchObject({
                    type: 'fallback',
                    component: null,
                    errors: [`unknown component '${name}'`]
                });
            }
            expect(catalog.validate('constructor', {})).toEqual([
                "Unknown component 'constructor'."
            ]);
        });

        it('refuses a __proto__ attribute, which would hide the props from the checks', () => {
            const [segment] = catalog.parseTags(`<ui-note __proto__='{"text":"x"}'/>`);
            expect(segment).toMatchObject({
                type: 'fallback',
                errors: expect.arrayContaining(['__proto__: not a valid prop name'])
            });
        });

        it('keeps the name and props of a tag for an unknown component, for migrations', () => {
            const [segment] = catalog.parseTags(`<ui-table data="sales" top='5'/>`);
            expect(segment).toMatchObject({
                type: 'fallback',
                component: null,
                name: 'table',
                props: {data: 'sales', top: 5}
            });
        });

        it('returns the same segment for the same tag, so its props keep their identity', () => {
            const text = 'See <ui-note text="a"/>',
                [, first] = catalog.parseTags(text),
                [, second] = catalog.parseTags(`${text} and more.`);
            expect(second).toBe(first);
        });
    });

    describe('markdown that is not a tag', () => {
        it.each([
            ['a tag in a fenced block', '```\n<ui-note text="a"/>\n```'],
            ['a tag in a tilde fence', '~~~xml\n<ui-note text="a"/>\n~~~'],
            ['a tag in an unclosed fence', 'See:\n```\n<ui-note text="a"/>'],
            ['a tag in inline code', 'Write `<ui-note text="a"/>` to show a note.'],
            ['a tag in double-backtick code', 'Write ``<ui-note text="`a`"/>`` here.'],
            ['an escaped tag', 'Write \\<ui-note text="a"/> to show a note.'],
            ['a name that runs on', 'a <ui-note.x text="a"/>'],
            ['a bare angle bracket', 'If a < b and b > c.'],
            ['other HTML', '<div>hi</div> <b>bold</b>'],
            ['a prefix with no name', 'Use <ui- tags.']
        ])('keeps %s as markdown', (_, text) => {
            expect(catalog.parseTags(text)).toEqual([{type: 'markdown', text}]);
        });

        it('parses tags after a closed code block', () => {
            const segments = catalog.parseTags(
                '```\n<ui-note text="a"/>\n```\n<ui-note text="b"/>'
            );
            expect(segments.map(it => it.type)).toEqual(['markdown', 'component']);
        });

        it('treats a lone backtick as text, so a later tag still parses', () => {
            const segments = catalog.parseTags('Use ` for code. <ui-note text="b"/>');
            expect(segments.map(it => it.type)).toEqual(['markdown', 'component']);
        });
    });

    describe('while streaming', () => {
        it('holds back a tag cut off at the end, as a placeholder', () => {
            const text = 'Here:\n<ui-grid data="sal';
            expect(catalog.parseTags(text, {isStreaming: true})).toEqual([
                {type: 'markdown', text: 'Here:\n'},
                {type: 'placeholder', component: 'grid', source: '<ui-grid data="sal'}
            ]);
        });

        it('treats an inline code span still open at the end as code', () => {
            const text = 'Write `<ui-note text="a"/>',
                later = `${text} later.\n\n<ui-note text="b"/>`;
            expect(catalog.parseTags(text, {isStreaming: true})).toEqual([
                {type: 'markdown', text}
            ]);
            // A code span never crosses a blank line, so the backtick turns out to be plain text.
            expect(catalog.parseTags(later, {isStreaming: true}).map(it => it.type)).toEqual([
                'markdown',
                'component',
                'markdown',
                'component'
            ]);
        });

        it('names no component until the tag name is complete', () => {
            expect(catalog.parseTags('<ui-gr', {isStreaming: true})).toEqual([
                {type: 'placeholder', component: null, source: '<ui-gr'}
            ]);
        });

        it('holds back a quote that hides a closing />', () => {
            const [segment] = catalog.parseTags('<ui-grid title="a/>', {isStreaming: true});
            expect(segment.type).toBe('placeholder');
        });

        it('holds back an open tag whose closing tag is still arriving', () => {
            const [segment] = catalog.parseTags('<ui-note text="a"></ui-no', {isStreaming: true});
            expect(segment.type).toBe('placeholder');
        });

        it.each(['<', '<u', '<ui', '<ui-'])('holds back the partial opening %s', tail => {
            expect(catalog.parseTags(`Text ${tail}`, {isStreaming: true})).toEqual([
                {type: 'markdown', text: 'Text '}
            ]);
        });

        it('keeps a partial opening inside code', () => {
            expect(catalog.parseTags('```\na <', {isStreaming: true})).toEqual([
                {type: 'markdown', text: '```\na <'}
            ]);
        });

        it('renders complete tags as they close, ahead of the held-back one', () => {
            const segments = catalog.parseTags('<ui-note text="a"/> and <ui-note te', {
                isStreaming: true
            });
            expect(segments.map(it => it.type)).toEqual(['component', 'markdown', 'placeholder']);
        });
    });

    describe('formatTag', () => {
        it('writes tags that parse back to the same props', () => {
            const props = {
                    data: 'sales "Q3" & <more>',
                    title: "it's",
                    top: 5,
                    compact: false,
                    columns: ["it's", 'a<b', 'x&y'],
                    filter: [{field: 'region', op: 'in', value: ['EMEA', "O'Hare"]}]
                },
                tag = catalog.formatTag('grid', props);

            expect(catalog.parseTags(tag)).toEqual([
                {type: 'component', element: {component: 'grid', props}, source: tag}
            ]);
        });
    });
});

//------------------
// Helpers
//------------------
function grid(): ChatUiComponentSpec {
    return {
        name: 'grid',
        description: 'A table over an artifact.',
        props: {
            type: 'object',
            required: ['data'],
            additionalProperties: false,
            properties: {
                data: {type: 'string'},
                title: {type: 'string'},
                top: {type: 'integer', minimum: 1},
                compact: {type: 'boolean'},
                columns: {type: 'array', items: {type: 'string'}},
                filter: {type: 'array', items: {type: 'object'}}
            }
        },
        dataProps: ['data'],
        render: () => null
    };
}

function note(): ChatUiComponentSpec {
    return {
        name: 'note',
        description: 'A note.',
        props: {type: 'object', properties: {text: {type: 'string'}}},
        render: () => null
    };
}
