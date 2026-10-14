import {describe, expect, it} from 'vitest';
import {fromColumnar} from './ChatData';

/**
 * Data servers often return result sets by column. Components and Hoist stores take rows, so the
 * conversion must keep every value in its row, and fill gaps rather than shift values.
 */
describe('fromColumnar', () => {
    it('pivots column lists into rows, with the total row count', () => {
        expect(
            fromColumnar({
                columns: [
                    {name: 'region', type: 'string'},
                    {name: 'sales', type: 'number'}
                ],
                data: {region: ['EMEA', 'APAC'], sales: [10, 20]},
                totalRows: 40
            })
        ).toEqual({
            columns: [
                {name: 'region', type: 'string'},
                {name: 'sales', type: 'number'}
            ],
            rows: [
                {region: 'EMEA', sales: 10},
                {region: 'APAC', sales: 20}
            ],
            totalRows: 40
        });
    });

    it('fills short and missing columns with null, and counts rows when no total is given', () => {
        const frame = fromColumnar({
            columns: [
                {name: 'a', type: 'integer'},
                {name: 'b', type: 'integer'},
                {name: 'c', type: 'integer'}
            ],
            data: {a: [1, 2, 3], b: [1]}
        });
        expect(frame.rows).toEqual([
            {a: 1, b: 1, c: null},
            {a: 2, b: null, c: null},
            {a: 3, b: null, c: null}
        ]);
        expect(frame.totalRows).toBe(3);
    });
});
