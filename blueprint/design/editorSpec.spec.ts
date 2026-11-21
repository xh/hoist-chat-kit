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

    it('makes a param that names a variable a variable picker, never a binding', () => {
        const [node] = toEditorSpec({
            type: 'object',
            properties: {variable: {type: 'string', 'x-variable': true}}
        });
        expect(node).toMatchObject({kind: 'variable', bindable: false});
    });

    it('makes a param that names a stored blueprint a blueprint picker', () => {
        const [node] = toEditorSpec({
            type: 'object',
            properties: {blueprint: {type: 'string', 'x-blueprint': true}}
        });
        expect(node).toMatchObject({kind: 'blueprint'});
    });

    it('names the annotated kinds, before their plain type', () => {
        const chart = byKey(toEditorSpec(configOf('chart')));
        expect(chart.source.kind).toBe('source');
        expect(chart.x).toMatchObject({kind: 'field', role: 'any', multiple: false});
        expect(chart.y).toMatchObject({kind: 'field', role: 'measure', multiple: true});
        expect(chart.filter.kind).toBe('filter');
    });

    it('makes lists of objects into item editors, with each item a group', () => {
        const buttons = byKey(toEditorSpec(configOf('buttonGroup'))).buttons;
        expect(buttons.kind).toBe('list');
        const item = buttons.kind === 'list' ? buttons.item : null;
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

    it('edits a date string with a date picker', () => {
        const [node] = toEditorSpec({
            type: 'object',
            properties: {on: {type: 'string', format: 'date'}}
        });
        expect(node.kind).toBe('date');
    });

    it("edits a property table's fields with the grid's column picker", () => {
        const spec = BUILT_IN_WIDGETS.find(it => it.name === 'propertyTable'),
            fields = toEditorSpec(spec.config).find(it => it.key === 'fields');
        expect(fields.kind).toBe('fieldList');
        expect(
            (fields as Extract<EditorNode, {kind: 'fieldList'}>).settings.map(it => it.key)
        ).toEqual(['label', 'format', 'renderer']);
    });

    it("names a value's unit in its label", () => {
        const [node] = toEditorSpec({
            type: 'object',
            properties: {minTileWidth: {type: 'integer', 'x-unit': 'px'}}
        });
        expect(node.label).toMatch(/\(px\)$/);
    });

    it("picks a preset selector's group from the blueprint's groups", () => {
        const spec = BUILT_IN_WIDGETS.find(it => it.name === 'presetSelector');
        expect(toEditorSpec(spec.config).find(it => it.key === 'group').kind).toBe('preset');
    });
});
