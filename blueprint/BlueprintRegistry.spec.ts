import {describe, expect, it} from 'vitest';
import {loadBlueprint, portfolioCatalog} from '../test/blueprintFixtures';
import {ARCHITECT_TOOLS} from './architect/ArchitectTools';
import {BlueprintRegistry} from './BlueprintRegistry';
import {validateBlueprint} from './validateBlueprint';

/**
 * A widget draws as a panel, and in any other presentation registered for it, such as the card a
 * chat registers. An app offers only the presentations it registers.
 */
describe('BlueprintRegistry presentations', () => {
    const card = {
            name: 'card',
            label: 'Card',
            guidance: 'Draws the grid as a chat reply does.',
            component: (() => null) as any
        },
        withPresentation = (registry: BlueprintRegistry, presentation: unknown) => {
            const bp = loadBlueprint('p1-one-grid.json');
            bp.elements.posGrid.config.presentation = presentation;
            return validateBlueprint(bp, {catalog: portfolioCatalog, registry}).map(it => it.code);
        },
        describeGrid = (registry: BlueprintRegistry) =>
            ARCHITECT_TOOLS.find(it => it.name === 'describe_registry').run(
                {kind: 'widget', names: ['cubeGrid']},
                {registry} as any
            )['cubeGrid'];

    it('takes a presentation only once one is registered, and only a registered one', () => {
        const plain = new BlueprintRegistry(),
            chat = new BlueprintRegistry();
        chat.addBuiltIns({presentations: [{widget: 'cubeGrid', presentation: card}]});

        expect(withPresentation(plain, 'card')).toContain('schema.invalid');
        expect(withPresentation(chat, 'card')).toEqual([]);
        expect(withPresentation(chat, 'panel')).toEqual([]);
        expect(withPresentation(chat, 'nope')).toContain('schema.invalid');
    });

    it('shows only the registered presentations to the Architect', () => {
        const plain = new BlueprintRegistry(),
            chat = new BlueprintRegistry();
        chat.addBuiltIns({presentations: [{widget: 'cubeGrid', presentation: card}]});

        expect(describeGrid(plain).config.properties.presentation).toBeUndefined();
        expect(describeGrid(plain).guidance).not.toMatch(/presentation/i);
        expect(describeGrid(chat).config.properties.presentation.enum).toEqual(['panel', 'card']);
        expect(describeGrid(chat).guidance).toContain('Draws the grid as a chat reply does.');
    });

    it('says which config keys a presentation ignores, in its guidance and on each key', () => {
        const registry = new BlueprintRegistry();
        registry.addBuiltIns({
            presentations: [
                {widget: 'cubeGrid', presentation: {...card, ignores: ['stripeRows', 'nope']}}
            ]
        });
        const grid = describeGrid(registry);
        expect(grid.guidance).toContain('It ignores stripeRows, nope.');
        expect(grid.config.properties.stripeRows.description).toBe(
            'Alternate the background of rows. The card presentation ignores it.'
        );
        expect(grid.config.properties.nope).toBeUndefined();
        expect(describeGrid(new BlueprintRegistry()).config.properties.stripeRows.description).toBe(
            'Alternate the background of rows.'
        );
    });

    it('takes app entries only under dotted names, beside bare built-ins', () => {
        const registry = new BlueprintRegistry(),
            action = (name: string) => ({name, params: {type: 'object', properties: {}}});
        expect(registry.actions.refresh).toBeDefined();
        expect(() => registry.addActions(action('publish'))).toThrow(/dotted name/);
        expect(() =>
            registry.addResolvers({
                name: 'userFund',
                returns: 'string',
                args: {},
                resolve: () => null
            })
        ).toThrow(/dotted name/);
        expect(() => new BlueprintRegistry({renderers: [{name: 'ticker', appliesTo: {}}]})).toThrow(
            /dotted name/
        );
        registry.addActions(action('acme.publish'));
        expect(registry.actions['acme.publish']).toBeDefined();
        expect(() => registry.addPresentation('cubeGrid', {...card, name: 'tile'})).toThrow(
            /dotted name/
        );
    });

    it('refuses an action param that both names a variable and takes a binding', () => {
        const registry = new BlueprintRegistry(),
            params = (prop: object) => ({type: 'object', properties: {target: prop}});
        expect(() =>
            registry.addActions({
                name: 'acme.pick',
                params: params({type: 'string', 'x-variable': true, 'x-binding': true})
            })
        ).toThrow(/x-variable/);
        expect(() =>
            registry.addActions({
                name: 'acme.pick',
                params: params({type: 'string', 'x-variable': true})
            })
        ).not.toThrow();
    });

    it('refuses a presentation for an unknown widget, or one named panel', () => {
        const registry = new BlueprintRegistry();
        expect(() => registry.addPresentation('nope', {...card, name: 'acme.card'})).toThrow();
        expect(() =>
            registry.addBuiltIns({
                presentations: [{widget: 'cubeGrid', presentation: {...card, name: 'panel'}}]
            })
        ).toThrow();
    });
});

describe('BlueprintRegistry bindings', () => {
    const props = (registry: BlueprintRegistry, widget: string) =>
        registry.widgets[widget].config.properties;

    it('lets a property bind by default where a variable type matches its type, unless it opts out', () => {
        const registry = new BlueprintRegistry(),
            panel = props(registry, 'panel'),
            grid = props(registry, 'cubeGrid');
        expect(panel.style['x-binding']).toBe(true);
        expect(panel.compactHeader['x-binding']).toBe(true);
        expect(grid.groupRowHeight['x-binding']).toBe(true);
        // A value the widget writes back from the user stays a literal.
        expect(panel.collapsed['x-binding']).toBe(false);
        expect(grid.sortBy['x-binding']).toBe(false);
        expect(grid.columnState['x-binding']).toBe(false);
        expect(props(registry, 'dashContainer').layout['x-binding']).toBe(false);
        // A reference to the blueprint, or template text, never binds by default.
        expect(grid.source['x-binding']).toBeUndefined();
        expect(panel.icon['x-binding']).toBeUndefined();
        expect(props(registry, 'markdown').text['x-binding']).toBeUndefined();
    });

    it("applies the same default to an app's widget", () => {
        const registry = new BlueprintRegistry({
                widgets: [
                    {
                        name: 'acme.ticker',
                        label: 'Ticker',
                        guidance: 'A ticker of symbols.',
                        version: 1,
                        category: 'data',
                        config: {
                            type: 'object',
                            properties: {
                                speed: {type: 'number'},
                                symbols: {type: 'array', items: {type: 'string'}},
                                fixed: {type: 'boolean', 'x-binding': false},
                                style: {type: 'object'}
                            }
                        }
                    }
                ]
            }),
            p = props(registry, 'acme.ticker');
        expect([p.speed, p.symbols, p.fixed, p.style].map(it => it['x-binding'])).toEqual([
            true,
            true,
            false,
            undefined
        ]);
    });

    it("keeps a widget's presentation a literal, as the renderer reads it unresolved", () => {
        const registry = new BlueprintRegistry(),
            {presentation} = props(registry, 'cubeGrid');
        if (presentation) expect(presentation['x-binding']).toBe(false);
        registry.addPresentation('chart', {
            name: 'acme.card',
            label: 'Card',
            guidance: 'A card.'
        } as any);
        expect(props(registry, 'chart').presentation['x-binding']).toBe(false);
    });

    it('shows the Architect only the marks that differ from the default', () => {
        const registry = new BlueprintRegistry(),
            tool = ARCHITECT_TOOLS.find(it => it.name === 'describe_registry'),
            {panel} = tool.run({kind: 'widget', names: ['panel']}, {registry} as any) as any;
        expect(panel.config.properties.style).not.toHaveProperty('x-binding');
        expect(panel.config.properties.collapsed['x-binding']).toBe(false);
        // A template title keeps its mark, as text binds only where it says so.
        expect(panel.config.properties.title['x-binding']).toBe(true);
    });
});
