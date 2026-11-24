import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject} from 'lodash';
import {describe, expect, it} from 'vitest';
import {
    READ_ANSWER_SPEC,
    REQUEST_DESIGN_MODE_SPEC,
    REQUEST_FEATURE_SPEC
} from '../../genui/architect/toolSpecs';
import {answerBlueprintSchema} from '../../genui/impl/answerTool';
import {scenarioRegistry} from '../../test/blueprintFixtures';
import {ARCHITECT_TOOLS} from './ArchitectTools';
import {normalizeToolInput, strictToolSchema} from './toolSchemas';

/**
 * Tool schemas work across vendors: a model that must send every property, as under OpenAI's
 * strict mode, gets a schema it accepts, and its input reads as the tool means it.
 */
describe('tool schemas', () => {
    const queryParams = ARCHITECT_TOOLS.find(it => it.name === 'query_dataset').parameters;

    it('drops each optional property with no value, and keeps a required one', () => {
        expect(
            normalizeToolInput(queryParams, {
                dataset: 'positions',
                params: {},
                fields: [],
                groupBy: null,
                filter: {},
                sortBy: '',
                top: 5
            })
        ).toEqual({dataset: 'positions', params: {}, top: 5});
    });

    it('drops empty optional values inside the objects a schema declares, at any depth', () => {
        const schema = {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['id'],
                        properties: {id: {type: 'string'}, column: {type: 'array'}}
                    }
                }
            }
        };
        expect(normalizeToolInput(schema, {items: [{id: 'a', column: []}, {id: ''}]})).toEqual({
            items: [{id: 'a'}, {id: ''}]
        });
    });

    it('leaves the values of an open object as they are', () => {
        expect(
            normalizeToolInput(queryParams, {dataset: 'x', params: {fund: null, asOf: ''}})
        ).toEqual({dataset: 'x', params: {fund: null, asOf: ''}});
    });

    it('gives every tool a schema that strict mode takes: closed, all required, nothing open', () => {
        const registry = scenarioRegistry(),
            schemas: [string, PlainObject][] = [
                ...ARCHITECT_TOOLS.map(it => [it.name, it.parameters] as [string, PlainObject]),
                ...[READ_ANSWER_SPEC, REQUEST_DESIGN_MODE_SPEC, REQUEST_FEATURE_SPEC].map(
                    it => [it.name, it.parameters] as [string, PlainObject]
                ),
                ['show_ui', answerBlueprintSchema(registry)]
            ];
        schemas.forEach(([name, schema]) =>
            expect(strictProblems(strictToolSchema(schema)), name).toEqual([])
        );
    });

    it('makes an optional property nullable, and an open value JSON text', () => {
        const strict = strictToolSchema(queryParams);
        expect(strict.required).toEqual(Object.keys(queryParams.properties));
        expect(strict.properties.dataset.type).toBe('string');
        expect(strict.properties.top.type).toEqual(['integer', 'null']);
        expect(strict.properties.params.type).toBe('string');
        expect(strict.properties.filter.type).toEqual(['string', 'null']);
        expect(strict.properties.filter.description).toBe('A Hoist filter. As JSON.');
    });

    it('reads input written against the strict schema as the tool means it', () => {
        const editParams = ARCHITECT_TOOLS.find(it => it.name === 'edit_blueprint').parameters,
            op = {op: 'set', path: '/elements/a/config', value: {text: 'Hi'}};
        expect(
            normalizeToolInput(
                editParams,
                {base: 3, description: 'Greet', ops: [JSON.stringify(op)]},
                {strict: true}
            )
        ).toEqual({base: 3, description: 'Greet', ops: [op]});

        expect(
            normalizeToolInput(
                queryParams,
                {
                    dataset: 'positions',
                    params: '{"asOf": "2026-07-01"}',
                    fields: null,
                    groupBy: null,
                    filter: null,
                    sortBy: null,
                    top: null
                },
                {strict: true}
            )
        ).toEqual({dataset: 'positions', params: {asOf: '2026-07-01'}});

        // A value of any type that is not JSON stays as the text it is.
        const setParams = ARCHITECT_TOOLS.find(it => it.name === 'set_variable').parameters;
        expect(
            normalizeToolInput(setParams, {variable: 'fund', value: 'Oak'}, {strict: true})
        ).toEqual({variable: 'fund', value: 'Oak'});
    });
});

// What strict mode refuses in a schema: an object open to more keys, a property not required, or
// a value with no type.
function strictProblems(schema: PlainObject, path = ''): string[] {
    if (!isPlainObject(schema)) return [`${path}: not a schema`];
    const ret: string[] = [];
    if (schema.type == null && !schema.enum && !schema.anyOf) ret.push(`${path}: no type`);
    if ([schema.type].flat().includes('object')) {
        const props = schema.properties ?? {};
        if (schema.additionalProperties !== false) ret.push(`${path}: open object`);
        if (JSON.stringify(schema.required ?? []) !== JSON.stringify(Object.keys(props))) {
            ret.push(`${path}: not every property required`);
        }
        Object.entries<PlainObject>(props).forEach(([k, p]) =>
            ret.push(...strictProblems(p, `${path}/${k}`))
        );
    }
    if (schema.items) ret.push(...strictProblems(schema.items, `${path}[]`));
    return ret;
}
