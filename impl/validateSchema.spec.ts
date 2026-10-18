import type {PlainObject} from '@xh/hoist/core';
import {describe, expect, it} from 'vitest';
import {validateSchema} from './validateSchema';

/**
 * The JSON Schema subset checker behind generative UI. Its messages go back to the model when a
 * call has invalid props, so each must name the path at fault and what was expected. While props
 * stream, it must accept any prefix of a valid document, so the UI can render as the model writes.
 */
describe('validateSchema', () => {
    const ROW: PlainObject = {
            type: 'object',
            required: ['label', 'value'],
            additionalProperties: false,
            properties: {
                label: {type: 'string', minLength: 1, maxLength: 20},
                value: {type: 'number', minimum: 0, maximum: 100},
                intent: {enum: ['good', 'bad']}
            }
        },
        TABLE: PlainObject = {
            type: 'object',
            required: ['rows'],
            properties: {
                title: {type: ['string', 'null']},
                rows: {type: 'array', items: ROW, minItems: 1, maxItems: 3}
            }
        };

    it.each([
        ['a string', {type: 'string'}, 'x'],
        ['an integer as a number', {type: 'number'}, 3],
        ['an integer', {type: 'integer'}, 3],
        ['a boolean', {type: 'boolean'}, false],
        ['null', {type: 'null'}, null],
        ['a type from a list', {type: ['string', 'null']}, null],
        ['an enum value', {enum: ['a', 1]}, 1],
        ['a const value', {const: {a: [1]}}, {a: [1]}],
        ['a pattern match', {type: 'string', pattern: '^[A-Z]{3}$'}, 'USD'],
        ['a valid table', TABLE, {title: 'Q3', rows: [{label: 'Sales', value: 42}]}],
        ['open additional properties', {type: 'object'}, {anything: true}],
        ['an anyOf branch', {anyOf: [{type: 'string'}, {type: 'number'}]}, 4],
        ['one oneOf branch', {oneOf: [{type: 'integer'}, {type: 'string'}]}, 'x'],
        ['unknown keywords', {type: 'string', format: 'date'}, 'not a date']
    ])('accepts %s', (_, schema, value) => {
        expect(validateSchema(value, schema)).toEqual([]);
    });

    it.each([
        ['a wrong type', {type: 'number'}, 'x', ['expected number, got string']],
        ['a fraction for an integer', {type: 'integer'}, 1.5, ['expected integer, got number']],
        [
            'a missing type from a list',
            {type: ['string', 'null']},
            1,
            ['expected string or null, got number']
        ],
        ['an array for an object', {type: 'object'}, [], ['expected object, got array']],
        ['a value not in an enum', {enum: ['a', 'b']}, 'c', ['expected one of "a", "b"']],
        ['a value not equal to a const', {const: 'a'}, 'b', ['expected "a"']],
        [
            'a string that misses a pattern',
            {pattern: '^\\d+$'},
            'abc',
            ['expected to match /^\\d+$/']
        ],
        ['a short string', {minLength: 2}, 'a', ['expected at least 2 characters']],
        ['a long string', {maxLength: 2}, 'abc', ['expected at most 2 characters, got 3']],
        ['a small number', {minimum: 1}, 0, ['expected at least 1, got 0']],
        ['a large number', {maximum: 1}, 2, ['expected at most 1, got 2']],
        ['too few items', {minItems: 1}, [], ['expected at least 1 item, got 0']],
        ['too many items', {maxItems: 1}, [1, 2], ['expected at most 1 item, got 2']],
        [
            'nested problems, with paths',
            TABLE,
            {
                rows: [
                    {label: 'A', value: 1},
                    {label: '', value: 'x', extra: 1}
                ]
            },
            [
                'rows[1].label: expected at least 1 character',
                'rows[1].value: expected number, got string',
                'rows[1].extra: unknown property'
            ]
        ],
        ['a missing required property', TABLE, {}, ['rows: required']],
        [
            'an additional property against its schema',
            {additionalProperties: {type: 'number'}},
            {a: 1, b: 'x'},
            ['b: expected number, got string']
        ],
        [
            'a key that is not an identifier',
            {properties: {'first name': {type: 'string'}}},
            {'first name': 1},
            ['["first name"]: expected string, got number']
        ],
        [
            'no anyOf branch, with the closest branch problems',
            {anyOf: [{type: 'string'}, {type: 'object', required: ['a', 'b']}]},
            {a: 1},
            ['b: required']
        ],
        [
            'more than one oneOf branch',
            {oneOf: [{type: 'number'}, {type: 'integer'}]},
            1,
            ['matches more than one allowed schema']
        ]
    ])('rejects %s', (_, schema, value, errors) => {
        expect(validateSchema(value, schema)).toEqual(errors);
    });

    it('reports a schema pattern that does not compile, rather than throw', () => {
        expect(validateSchema('abc', {pattern: '(['})).toEqual([
            'schema pattern /([/ is not a valid regular expression'
        ]);
    });

    describe('isPartial', () => {
        it.each([
            ['missing required properties', TABLE, {rows: [{label: 'Sa'}]}],
            ['too few items', TABLE, {rows: []}],
            ['a short string', {minLength: 5}, 'ab'],
            ['the start of an enum value', ROW, {label: 'A', value: 1, intent: 'go'}],
            ['the start of a const value', {const: 'column'}, 'col'],
            ['a string that may yet match a pattern', {pattern: '^[A-Z]{3}$'}, 'U'],
            ['more than one oneOf branch', {oneOf: [{type: 'number'}, {type: 'integer'}]}, 1],
            ['a positive number that more digits may lift to its minimum', {minimum: 1900}, 2],
            ['a negative number that more digits may lower to its maximum', {maximum: -10}, -1]
        ])('accepts %s', (_, schema, value) => {
            expect(validateSchema(value, schema, {isPartial: true})).toEqual([]);
        });

        it.each([
            [
                'a wrong type',
                TABLE,
                {rows: [{label: 7}]},
                ['rows[0].label: expected string, got number']
            ],
            ['too many items', {maxItems: 1}, [1, 2], ['expected at most 1 item, got 2']],
            [
                'a value outside an enum',
                {enum: ['line', 'bar']},
                'pie',
                ['expected one of "line", "bar"']
            ],
            [
                'a positive number over its maximum',
                {maximum: 10},
                11,
                ['expected at most 10, got 11']
            ],
            [
                'a negative number under its minimum',
                {minimum: -10},
                -11,
                ['expected at least -10, got -11']
            ]
        ])('still rejects %s', (_, schema, value, errors) => {
            expect(validateSchema(value, schema, {isPartial: true})).toEqual(errors);
        });
    });
});
