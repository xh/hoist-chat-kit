import {describe, expect, it} from 'vitest';
import {loadBlueprint} from '../../test/blueprintFixtures';
import {hostSourceFor} from './hostSource';

/**
 * What a query's request becomes in a host: a dataset source, the config a widget takes over it,
 * and the host's sources that already give the same rows.
 */
describe('hostSourceFor', () => {
    const host = {
            blueprint: loadBlueprint('p2-linked-dashboard.json'),
            variables: [{name: 'asOf', value: '2026-11-19'}]
        },
        request = {
            dataset: 'positions',
            params: {asOf: '2026-11-19'},
            fields: ['trader', 'pnlDay'],
            groupBy: ['trader'],
            filter: {field: 'sector', op: '=', value: 'Technology'},
            sortBy: 'pnlDay',
            top: 5
        };

    it("gives the request's dataset source with its params as they are, and the widget's config", () => {
        expect(hostSourceFor(request, host)).toEqual({
            source: {dataset: 'positions', params: {asOf: '2026-11-19'}},
            config: {
                fields: ['trader', 'pnlDay'],
                groupBy: ['trader'],
                filter: {field: 'sector', op: '=', value: 'Technology'},
                sortBy: 'pnlDay',
                top: 5
            },
            matches: ['positions']
        });
    });

    it('matches a host source on its params as its variables resolve them now', () => {
        const later = {...host, variables: [{name: 'asOf', value: '2026-11-20'}]};
        expect(hostSourceFor(request, later).matches).toEqual([]);
        expect(hostSourceFor({...request, dataset: 'orders'}, host).matches).toEqual(['orders']);
    });

    it('leaves out what the request does not set', () => {
        expect(hostSourceFor({dataset: 'orders', params: {asOf: '2026-11-19'}}, host)).toEqual({
            source: {dataset: 'orders', params: {asOf: '2026-11-19'}},
            config: {},
            matches: ['orders']
        });
    });
});
