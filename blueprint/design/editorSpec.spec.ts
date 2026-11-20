import {describe, expect, it} from 'vitest';
import {BUILT_IN_WIDGETS} from '../impl/builtInWidgets';
import {type EditorNode, toEditorSpec} from './editorSpec';

/**
 * Each widget's config editor comes from its schema: an input per plain value, a group, list or
 * map per structure, the registry's annotations by name, and JSON for anything else.
 */
describe('toEditorSpec', () => {
    const configOf = (name: string) => BUILT_IN_WIDGETS.find(it => it.name === name).config,
        byKey = (nodes: EditorNode[]) => Object.fromEntries(nodes.map(it => [it.key, it]));

    it('makes an editor per property, in schema order, with labels and required flags', () => {
        const nodes = toEditorSpec(configOf('chart'));
        expect(nodes.map(it => it.key).slice(0, 4)).toEqual(['source', 'title', 'type', 'xTitle']);
        expect(byKey(nodes).xTitle).toMatchObject({
            kind: 'text',
            label: 'X title',
            required: false,
            bindable: true,
            maxLength: 100
        });
        expect(byKey(nodes).type).toMatchObject({kind: 'choice', required: true});
    });

    it("carries a property's default, for an editor to show while it is unset", () => {
        const grid = byKey(toEditorSpec(configOf('cubeGrid')));
        expect(grid.stripeRows.default).toBe(true);
        expect(grid.treeStyle.default).toBe('highlights');
        expect(grid.title.default).toBeUndefined();
    });

    it('names the annotated kinds, before their plain type', () => {
        const chart = byKey(toEditorSpec(configOf('chart')));
        expect(chart.source.kind).toBe('source');
        expect(chart.x).toMatchObject({kind: 'field', role: 'any', multiple: false});
        expect(chart.y).toMatchObject({kind: 'field', role: 'measure', multiple: true});
        expect(chart.filter.kind).toBe('filter');
    });

    it('makes lists of objects into item editors, with each item a group', () => {
        const cards = byKey(toEditorSpec(configOf('statCardStrip'))).cards;
        expect(cards.kind).toBe('list');
        const item = cards.kind === 'list' ? cards.item : null;
        expect(item.kind).toBe('group');
        expect(item.kind === 'group' && byKey(item.children).label.kind).toBe('text');
    });

    it('makes an object keyed freely into a map, as for the grid columns', () => {
        const columns = byKey(toEditorSpec(configOf('cubeGrid'))).columns;
        expect(columns.kind).toBe('map');
        expect(columns.kind === 'map' && columns.value.kind).toBe('group');
    });

    it("makes a list of fields with settings into a field list, as for the grid's column state", () => {
        const grid = byKey(toEditorSpec(configOf('cubeGrid')));
        expect(grid.columnState).toMatchObject({kind: 'fieldList', role: 'any'});
        const settings = grid.columnState.kind === 'fieldList' ? grid.columnState.settings : [];
        expect(settings.map(it => it.key)).toEqual(['width', 'hidden', 'pinned']);
        expect(grid.columns).toMatchObject({kind: 'map', keyRole: 'any'});
    });

    it('switches between simple variants, and falls back to JSON for structured ones', () => {
        const nodes = toEditorSpec({
            type: 'object',
            properties: {
                size: {anyOf: [{type: 'number'}, {enum: ['auto']}]},
                shape: {anyOf: [{type: 'string'}, {type: 'object', properties: {a: {}}}]},
                any: {}
            }
        });
        expect(nodes.map(it => it.kind)).toEqual(['oneOf', 'json', 'json']);
    });
});
