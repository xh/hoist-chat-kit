import type {PlainObject} from '@xh/hoist/core';
import {describe, expect, it} from 'vitest';
import {CHAT_DATA_ROW_ID, type ChatDataFrame} from './ChatData';
import {
    applyDataView,
    CHAT_CHART_VIEW_PROPERTIES,
    CHAT_DATA_VIEW_PROPERTIES,
    type ChatChartView,
    type ChatDataView,
    findDataViewProblems
} from './ChatDataView';
import {findSchemaProblems, validateSchema} from '../impl/validateSchema';

/**
 * A view is how the model asks for a slice of an artifact - which rows, in what order, which
 * columns, in what unit - without writing the data. Apps rely on it to apply exactly the closed
 * grammar the model was given, never to evaluate anything else, and to report a view that names
 * a column the data does not have.
 */
describe('applyDataView', () => {
    const FRAME: ChatDataFrame = {
        columns: [
            {name: 'region', type: 'string'},
            {name: 'sales', type: 'number', format: 'currency'},
            {name: 'units', type: 'integer'},
            {name: 'margin', type: 'number', format: 'percent'},
            {name: 'year', type: 'integer', format: 'none'},
            {name: 'day', type: 'date'},
            {name: 'active', type: 'boolean'}
        ],
        rows: [
            row('EMEA', 3_000_000, 30, 0.2, 2023, '2024-03-01', true, 0),
            row('APAC', 1_500_000, 15, 0.1, 2024, '2024-01-15', false, 1),
            row('AMER', 4_500_000, null, 0.3, 2024, '2024-02-10', true, 2),
            row(null, 500_000, 5, null, 2023, null, null, 3)
        ],
        totalRows: 4
    };

    describe('filter', () => {
        it.each<[string, ChatDataView['filter'], (string | null)[]]>([
            ['eq on text', [{field: 'region', op: 'eq', value: 'EMEA'}], ['EMEA']],
            ['neq on text', [{field: 'region', op: 'neq', value: 'EMEA'}], ['APAC', 'AMER', null]],
            ['eq null for an empty value', [{field: 'region', op: 'eq', value: null}], [null]],
            ['gt on numbers', [{field: 'sales', op: 'gt', value: 1_500_000}], ['EMEA', 'AMER']],
            [
                'gte on numbers',
                [{field: 'sales', op: 'gte', value: 1_500_000}],
                ['EMEA', 'APAC', 'AMER']
            ],
            ['lt on numbers', [{field: 'sales', op: 'lt', value: 1_500_000}], [null]],
            ['lte on numbers', [{field: 'sales', op: 'lte', value: 1_500_000}], ['APAC', null]],
            [
                'a number written as text',
                [{field: 'year', op: 'eq', value: '2024'}],
                ['APAC', 'AMER']
            ],
            [
                'in on a list',
                [{field: 'region', op: 'in', value: ['APAC', 'AMER']}],
                ['APAC', 'AMER']
            ],
            ['notNull', [{field: 'units', op: 'notNull'}], ['EMEA', 'APAC', null]],
            [
                'a range that skips empty values',
                [{field: 'units', op: 'lt', value: 100}],
                ['EMEA', 'APAC', null]
            ],
            [
                'dates by ISO text',
                [{field: 'day', op: 'gte', value: '2024-02-01'}],
                ['EMEA', 'AMER']
            ],
            [
                'booleans written as text',
                [{field: 'active', op: 'eq', value: 'true'}],
                ['EMEA', 'AMER']
            ],
            [
                'every condition',
                [
                    {field: 'year', op: 'eq', value: 2024},
                    {field: 'sales', op: 'gt', value: 2_000_000}
                ],
                ['AMER']
            ],
            [
                'a range across types, which matches nothing',
                [{field: 'region', op: 'gt', value: 5}],
                []
            ]
        ])('applies %s', (_, filter, regions) => {
            const result = applyDataView(FRAME, {filter});
            expect(result.rows.map(it => it.region)).toEqual(regions);
            expect(result.totalRows).toBe(regions.length);
        });
    });

    describe('sort and top', () => {
        it.each<[string, ChatDataView, (string | null)[]]>([
            ['ascending text', {sortBy: 'region'}, ['AMER', 'APAC', 'EMEA', null]],
            ['descending numbers', {sortBy: 'sales|desc'}, ['AMER', 'EMEA', 'APAC', null]],
            ['ascending, explicitly', {sortBy: 'sales|asc'}, [null, 'APAC', 'EMEA', 'AMER']],
            [
                'empty values last when descending',
                {sortBy: 'units|desc'},
                ['EMEA', 'APAC', null, 'AMER']
            ],
            ['dates', {sortBy: 'day'}, ['APAC', 'AMER', 'EMEA', null]],
            ['the top rows after sorting', {sortBy: 'sales|desc', top: 2}, ['AMER', 'EMEA']],
            ['the top rows unsorted', {top: 1}, ['EMEA']]
        ])('applies %s', (_, view, regions) => {
            expect(applyDataView(FRAME, view).rows.map(it => it.region)).toEqual(regions);
        });

        it('counts the rows that pass the filter, before the top', () => {
            expect(applyDataView(FRAME, {top: 2}).totalRows).toBe(4);
        });

        it('leaves the frame as it was', () => {
            const before = structuredClone(FRAME);
            applyDataView(FRAME, {sortBy: 'sales|desc', units: 'millions', columns: ['sales']});
            expect(FRAME).toEqual(before);
        });
    });

    describe('units', () => {
        it('scales the number columns of a table, but not percents, plain numbers or integers', () => {
            const result = applyDataView(FRAME, {units: 'millions', top: 1});

            expect(result.rows[0]).toMatchObject({
                sales: 3,
                units: 30,
                margin: 0.2,
                year: 2023
            });
            expect(result.columns.find(it => it.name === 'sales')).toMatchObject({
                type: 'number',
                units: 'millions'
            });
            expect(result.columns.find(it => it.name === 'units').units).toBeUndefined();
            expect(result.columns.find(it => it.name === 'year').units).toBeUndefined();
        });

        it('scales only the y columns of a chart', () => {
            const view: ChatChartView = {
                    type: 'bar',
                    x: 'year',
                    y: ['units'],
                    units: 'thousands',
                    top: 1
                },
                result = applyDataView(FRAME, view);
            expect(result.rows[0]).toMatchObject({units: 0.03, sales: 3_000_000, year: 2023});
        });

        it.each<[ChatDataView['units'], number]>([
            ['none', 3_000_000],
            ['thousands', 3000],
            ['millions', 3],
            ['billions', 0.003]
        ])('scales to %s', (units, sales) => {
            expect(applyDataView(FRAME, {units, top: 1}).rows[0].sales).toBe(sales);
        });

        it('keeps empty values empty', () => {
            expect(
                applyDataView(FRAME, {units: 'thousands', sortBy: 'units|desc'}).rows[3].units
            ).toBeNull();
        });
    });

    describe('columns', () => {
        it('selects columns in order, with labels and formats, and keeps the row id', () => {
            const result = applyDataView(FRAME, {
                columns: ['sales', {name: 'region', label: 'Region', format: 'upper'}],
                top: 1
            });

            expect(result.columns).toEqual([
                {name: 'sales', type: 'number', format: 'currency'},
                {name: 'region', type: 'string', label: 'Region', format: 'upper'}
            ]);
            expect(result.rows[0]).toEqual({
                sales: 3_000_000,
                region: 'EMEA',
                [CHAT_DATA_ROW_ID]: 0
            });
        });

        it('filters and sorts on columns it does not select', () => {
            const result = applyDataView(FRAME, {
                columns: ['region'],
                filter: [{field: 'units', op: 'notNull'}],
                sortBy: 'sales'
            });
            expect(result.rows.map(it => it.region)).toEqual([null, 'APAC', 'EMEA']);
        });

        it('keeps the columns a chart plots, even when not selected', () => {
            const view: ChatChartView = {
                    type: 'line',
                    x: 'day',
                    y: ['sales'],
                    groupBy: 'region',
                    columns: ['units']
                },
                result = applyDataView(FRAME, view);
            expect(result.columns.map(it => it.name)).toEqual(['units', 'day', 'sales', 'region']);
        });

        it('keeps every column by default', () => {
            expect(applyDataView(FRAME, {}).columns).toBe(FRAME.columns);
        });
    });

    describe('findDataViewProblems', () => {
        it.each<[string, PlainObject, string[]]>([
            [
                'an unknown column',
                {columns: ['region', 'regoin']},
                ["columns[1]: unknown column 'regoin'"]
            ],
            [
                'an unknown sort column',
                {sortBy: 'revenue|desc'},
                ["sortBy: unknown column 'revenue'"]
            ],
            [
                'an unknown filter column',
                {filter: [{field: 'country', op: 'eq', value: 'FR'}]},
                ["filter[0].field: unknown column 'country'"]
            ],
            [
                'in without a list',
                {filter: [{field: 'region', op: 'in', value: 'EMEA'}]},
                ["filter[0].value: expected a list of values for 'in'"]
            ],
            [
                'a range without a value',
                {filter: [{field: 'sales', op: 'gt'}]},
                ["filter[0].value: required for 'gt'"]
            ],
            [
                'a chart over unknown and text columns',
                {type: 'bar', x: 'month', y: ['sales', 'region'], groupBy: 'segment'},
                [
                    "x: unknown column 'month'",
                    "y[1]: column 'region' is not numeric",
                    "groupBy: unknown column 'segment'"
                ]
            ]
        ])('reports %s', (_, view, problems) => {
            expect(findDataViewProblems(view as ChatDataView, FRAME.columns)).toEqual(problems);
        });

        it('makes applyDataView throw, naming each problem', () => {
            expect(() => applyDataView(FRAME, {sortBy: 'nope', columns: ['zip']})).toThrow(
                "Invalid data view: columns[0]: unknown column 'zip'; sortBy: unknown column 'nope'"
            );
        });
    });

    describe('schemas', () => {
        const TABLE_SCHEMA = {
                type: 'object',
                additionalProperties: false,
                properties: CHAT_DATA_VIEW_PROPERTIES
            },
            CHART_SCHEMA = {
                type: 'object',
                required: ['type', 'x', 'y'],
                additionalProperties: false,
                properties: CHAT_CHART_VIEW_PROPERTIES
            };

        it('use only keywords the catalog checks', () => {
            expect(findSchemaProblems(TABLE_SCHEMA)).toEqual([]);
            expect(findSchemaProblems(CHART_SCHEMA)).toEqual([]);
        });

        it('accept the views the grammar allows, and reject the rest', () => {
            const view = {
                columns: ['region', {name: 'sales', label: 'Sales'}],
                sortBy: 'sales|desc',
                filter: [
                    {field: 'region', op: 'in', value: ['EMEA', 'APAC']},
                    {field: 'units', op: 'notNull'}
                ],
                top: 10,
                units: 'millions'
            };
            expect(validateSchema(view, TABLE_SCHEMA)).toEqual([]);
            expect(
                validateSchema({...view, type: 'bar', x: 'region', y: ['sales']}, CHART_SCHEMA)
            ).toEqual([]);

            expect(validateSchema({sortBy: 'sales|down'}, TABLE_SCHEMA)).not.toEqual([]);
            expect(
                validateSchema({filter: [{field: 'a', op: 'like', value: 'x%'}]}, TABLE_SCHEMA)
            ).not.toEqual([]);
            expect(
                validateSchema(
                    {filter: [{field: 'a', op: 'eq', value: {$where: 'x'}}]},
                    TABLE_SCHEMA
                )
            ).not.toEqual([]);
            expect(validateSchema({top: 0}, TABLE_SCHEMA)).not.toEqual([]);
            expect(validateSchema({type: 'bar', x: 'a', y: []}, CHART_SCHEMA)).not.toEqual([]);
        });
    });
});

//------------------
// Helpers
//------------------
function row(
    region: string,
    sales: number,
    units: number,
    margin: number,
    year: number,
    day: string,
    active: boolean,
    id: number
): PlainObject {
    return {
        region,
        sales,
        units,
        margin,
        year,
        day: day ? Date.parse(day) : null,
        active,
        [CHAT_DATA_ROW_ID]: id
    };
}
