import {describe, expect, it} from 'vitest';
import {
    checkInterruptAnswer,
    getApprovalPayload,
    getInterruptAnswerSpec,
    isApprovalSchema
} from './interruptSchema';

/**
 * An interrupt's `responseSchema` decides how the user answers it, and the shape of an approval.
 * AG-UI leaves the schema unbounded, so the kit renders only the shapes it can check, and reads
 * the extra shapes Pydantic writes.
 */
describe('interruptSchema', () => {
    describe('getInterruptAnswerSpec', () => {
        it('answers a question with no schema in a text box', () => {
            expect(getInterruptAnswerSpec(null)).toEqual({kind: 'text'});
        });

        it('shows one choice of three options or fewer, alone in an object, as buttons', () => {
            const spec = getInterruptAnswerSpec({
                type: 'object',
                properties: {
                    cadence: {
                        oneOf: [
                            {const: 'daily', title: 'Daily', description: 'Every morning'},
                            {const: 'weekly', title: 'Weekly'}
                        ]
                    }
                },
                required: ['cadence']
            });
            expect(spec).toMatchObject({
                kind: 'choice',
                field: 'cadence',
                options: [
                    {value: 'daily', label: 'Daily', description: 'Every morning'},
                    {value: 'weekly', label: 'Weekly'}
                ]
            });
        });

        it('shows a schema that is itself a string enum as a choice of bare values', () => {
            expect(getInterruptAnswerSpec({type: 'string', enum: ['allow', 'deny']})).toMatchObject(
                {kind: 'choice', field: null, options: [{value: 'allow'}, {value: 'deny'}]}
            );
        });

        it('confirms a schema that is a boolean', () => {
            expect(getInterruptAnswerSpec({type: 'boolean'})).toMatchObject({kind: 'confirm'});
        });

        it('builds a form for a flat object of simple fields', () => {
            const spec = getInterruptAnswerSpec({
                type: 'object',
                properties: {
                    note: {type: 'string', title: 'Note'},
                    start: {type: 'string', format: 'date'},
                    count: {type: 'integer', minimum: 1, maximum: 9, default: 3},
                    urgent: {type: 'boolean'},
                    region: {type: 'string', enum: ['EU', 'US', 'APAC', 'LATAM']},
                    desks: {type: 'array', items: {enum: ['FX', 'Rates']}}
                },
                required: ['note']
            });
            expect(spec.kind).toBe('form');
            expect(spec.kind === 'form' && spec.fields).toMatchObject([
                {name: 'note', label: 'Note', type: 'text', isRequired: true},
                {name: 'start', type: 'date', isRequired: false},
                {name: 'count', type: 'integer', min: 1, max: 9, defaultValue: 3},
                {name: 'urgent', type: 'boolean'},
                {name: 'region', type: 'choice', options: [{value: 'EU'}, {}, {}, {}]},
                {name: 'desks', type: 'choices', options: [{value: 'FX'}, {value: 'Rates'}]}
            ]);
        });

        it('reads the local refs and nullable fields Pydantic writes', () => {
            const spec = getInterruptAnswerSpec({
                $defs: {Region: {type: 'string', enum: ['EU', 'US']}},
                type: 'object',
                properties: {
                    region: {$ref: '#/$defs/Region'},
                    note: {anyOf: [{type: 'string'}, {type: 'null'}], default: null},
                    count: {type: ['integer', 'null']}
                },
                required: ['region']
            });
            expect(spec.kind === 'form' && spec.fields).toMatchObject([
                {name: 'region', type: 'choice', isRequired: true},
                {name: 'note', type: 'text', isRequired: false},
                {name: 'count', type: 'integer'}
            ]);
        });

        it('refuses a nested object, and a keyword the kit cannot check', () => {
            expect(
                getInterruptAnswerSpec({
                    type: 'object',
                    properties: {address: {type: 'object', properties: {}}}
                }).kind
            ).toBe('unsupported');
            expect(
                getInterruptAnswerSpec({
                    type: 'object',
                    properties: {a: {type: 'string'}},
                    allOf: [{required: ['a']}]
                })
            ).toMatchObject({kind: 'unsupported', problems: ['allOf']});
        });
    });

    describe('checkInterruptAnswer', () => {
        it('checks an answer against the normalized schema', () => {
            const spec = getInterruptAnswerSpec({
                type: 'object',
                properties: {count: {anyOf: [{type: 'integer', maximum: 5}, {type: 'null'}]}},
                required: ['count']
            });
            expect(checkInterruptAnswer(spec, {count: 3})).toEqual([]);
            expect(checkInterruptAnswer(spec, {count: 7})).toHaveLength(1);
            expect(checkInterruptAnswer(spec, {})).toHaveLength(1);
        });
    });

    describe('getApprovalPayload', () => {
        it('sends {approved}, with any reason, when the interrupt has no schema', () => {
            expect(getApprovalPayload(null, true)).toEqual({approved: true});
            expect(getApprovalPayload(null, false, 'Too large')).toEqual({
                approved: false,
                reason: 'Too large'
            });
        });

        it('follows the shape the schema asks for', () => {
            const reasoned = {
                type: 'object',
                properties: {confirmed: {type: 'boolean'}, message: {type: 'string'}}
            };
            expect(getApprovalPayload(reasoned, false, 'No')).toEqual({
                confirmed: false,
                message: 'No'
            });
            expect(
                getApprovalPayload(
                    {type: 'object', properties: {behavior: {enum: ['allow', 'deny']}}},
                    true
                )
            ).toEqual({behavior: 'allow'});
            expect(getApprovalPayload({type: 'string', enum: ['allow', 'deny']}, false)).toBe(
                'deny'
            );
            expect(getApprovalPayload({type: 'boolean'}, true)).toBe(true);
        });

        it('leaves a schema of another shape to render as a question', () => {
            const schema = {type: 'object', properties: {when: {type: 'string'}}};
            expect(getApprovalPayload(schema, true)).toBeUndefined();
            expect(isApprovalSchema(schema)).toBe(false);
            expect(isApprovalSchema(null)).toBe(true);
        });
    });
});
