import {describe, expect, it} from 'vitest';
import {ChatUiCatalog, type ChatUiCatalogConfig} from './ChatUiCatalog';
import type {ChatUiComponentSpec} from './ChatUiComponentSpec';
import {canonicalJson, fnv1a, hashJson} from './impl/hash';

/**
 * A server that runs the tool loop registers the catalog's tools and prompt from an export built
 * with the app. Apps rely on the export to hold everything the model needs for each delivery mode,
 * and on the version to change exactly when the content does, so the server can detect drift.
 */
describe('ChatUiCatalog export', () => {
    describe('toToolSchemas', () => {
        it('exports the component tools, as plain JSON', () => {
            const schemas = createCatalog().toToolSchemas();

            expect(schemas.map(it => it.name)).toEqual(['show_grid', 'show_stack']);
            expect(schemas[0]).toEqual({
                name: 'show_grid',
                description: expect.stringContaining('A table over a result.'),
                parameters: GRID.props
            });
            expect(JSON.parse(JSON.stringify(schemas))).toEqual(schemas);
        });

        it('adds the document tool for the document mode', () => {
            expect(
                createCatalog()
                    .toToolSchemas({modes: ['document']})
                    .map(it => it.name)
            ).toEqual(['show_ui']);
            expect(
                createCatalog({documentToolName: 'render_ui'})
                    .toToolSchemas({modes: ['tools', 'document']})
                    .map(it => it.name)
            ).toEqual(['show_grid', 'show_stack', 'render_ui']);
        });
    });

    describe('toPrompt', () => {
        it('explains the tools mode by default, as the instructions do', () => {
            const catalog = createCatalog();

            expect(catalog.toPrompt()).toBe(catalog.instructions);
            expect(catalog.instructions).toContain('### Component tools');
            expect(catalog.instructions).not.toContain('### Component tags');
            expect(catalog.instructions).not.toContain('### UI documents');
        });

        it('explains the tag grammar, with each component, its props and an example tag', () => {
            const prompt = createCatalog().toPrompt({modes: ['tags']});

            expect(prompt).toContain('by writing a component tag in your answer');
            expect(prompt).toContain(`\`<ui-NAME prop="text" prop='JSON'/>\``);
            expect(prompt).toContain('#### ui-grid\nA table over a result.');
            expect(prompt).toContain('- data (string, required): Id of a result from a tool.');
            expect(prompt).toContain('- units (one of "none", "millions")');
            expect(prompt).toContain(
                `Example: <ui-grid data="sales" columns='["region","total"]'/>`
            );
            expect(prompt).toContain('never write out its rows');
            expect(prompt).not.toContain('make several calls');
        });

        it('writes the tag grammar with the configured prefix', () => {
            const prompt = createCatalog({tagPrefix: 'acme-'}).toPrompt({modes: ['tags']});
            expect(prompt).toContain('#### acme-grid');
            expect(prompt).not.toContain('ui-grid');
        });

        it('explains the document mode, with its caps and the components that take children', () => {
            const prompt = createCatalog({limits: {maxElements: 12, maxDepth: 3}}).toPrompt({
                modes: ['document']
            });

            expect(prompt).toContain('by calling `show_ui` with a document');
            expect(prompt).toContain('- Use at most 12 elements, nested at most 3 levels deep.');
            expect(prompt).toContain('- Components that take children: stack (default).');
        });

        it('adds the app rules to the list of rules, and the instructions at the end', () => {
            const prompt = createCatalog({instructions: 'Prefer grids.'}).toPrompt({
                modes: ['tools', 'tags', 'document'],
                rules: ['Never show more than three components.']
            });

            expect(prompt).toContain(
                'by calling the tool of a component, by writing a component tag in your answer or by calling `show_ui` with a document'
            );
            expect(prompt).toContain(
                '- Never show more than three components.\n\n### Component tools'
            );
            expect(prompt.endsWith('Prefer grids.')).toBe(true);
        });
    });

    describe('version', () => {
        it('is stable for the same content, whatever the order of keys or the render functions', () => {
            const reordered: ChatUiComponentSpec = {
                render: () => 'other',
                props: {properties: GRID.props.properties, required: ['data'], type: 'object'},
                description: GRID.description,
                name: 'grid',
                dataProps: ['data'],
                example: GRID.example
            };

            expect(createCatalog().version).toMatch(/^[0-9a-f]{8}$/);
            expect(createCatalog().version).toBe(createCatalog().version);
            expect(createCatalog({components: [reordered, STACK]}).version).toBe(
                createCatalog().version
            );
        });

        it.each<[string, Partial<ChatUiCatalogConfig>]>([
            ['a description', {components: [{...GRID, description: 'A grid.'}, STACK]}],
            ['a schema', {components: [{...GRID, props: {type: 'object'}, dataProps: []}, STACK]}],
            ['a component', {components: [GRID]}],
            ['the instructions', {instructions: 'Be brief.'}],
            ['the tag prefix', {tagPrefix: 'acme-'}],
            ['a limit', {limits: {maxElements: 10}}]
        ])('changes with %s', (_, config) => {
            expect(createCatalog(config).version).not.toBe(createCatalog().version);
        });
    });

    describe('hashJson', () => {
        it('hashes with FNV-1a, over UTF-8', () => {
            // Published FNV-1a 32-bit test vectors.
            expect(fnv1a('')).toBe('811c9dc5');
            expect(fnv1a('a')).toBe('e40c292c');
            expect(fnv1a('foobar')).toBe('bf9cf968');
            expect(fnv1a('é')).not.toBe(fnv1a('e'));
            expect(hashJson({a: 1})).toBe(fnv1a('{"a":1}'));
        });

        it('sorts object keys at every level, and keeps array order', () => {
            expect(canonicalJson({b: 1, a: {d: [2, 1], c: null}})).toBe(
                '{"a":{"c":null,"d":[2,1]},"b":1}'
            );
            expect(hashJson({a: 1, b: 2})).toBe(hashJson({b: 2, a: 1}));
            expect(hashJson([1, 2])).not.toBe(hashJson([2, 1]));
        });
    });
});

//------------------
// Helpers
//------------------
const GRID: ChatUiComponentSpec = {
        name: 'grid',
        description: 'A table over a result.\nShows the first rows.',
        props: {
            type: 'object',
            required: ['data'],
            properties: {
                data: {type: 'string', description: 'Id of a result from a tool.'},
                columns: {type: 'array', items: {type: 'string'}},
                units: {enum: ['none', 'millions']}
            }
        },
        dataProps: ['data'],
        render: () => null,
        example: {data: 'sales', columns: ['region', 'total']}
    },
    STACK: ChatUiComponentSpec = {
        name: 'stack',
        description: 'A vertical stack.',
        props: {type: 'object'},
        slots: ['default'],
        render: () => null
    };

function createCatalog(config: Partial<ChatUiCatalogConfig> = {}): ChatUiCatalog {
    return new ChatUiCatalog({components: [GRID, STACK], ...config});
}
