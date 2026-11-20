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
