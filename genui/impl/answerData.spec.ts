import {describe, expect, it} from 'vitest';
import type {Blueprint} from '../../blueprint';
import {portfolioCatalog} from '../../test/blueprintFixtures';
import {ChatArtifactRegistry} from '../ChatArtifactRegistry';
import {answerDataFor, chatArtifactProvider} from './answerData';

/**
 * An answer reads the chat's artifacts: through the dataset an artifact names, or else through a
 * dataset of its own columns, local to the answer.
 */
describe('answer data', () => {
    const registry = new ChatArtifactRegistry();
    registry.add([
        {
            id: 'art_q',
            columns: [
                {name: 'trader', type: 'string'},
                {name: 'pnlDay', type: 'number'}
            ],
            rows: [{trader: 'Ann', pnlDay: -5}],
            totalRows: 1,
            metadata: {dataset: 'positions'}
        },
        {
            id: 'art_t',
            columns: [
                {name: 'day', type: 'date', label: 'Day'},
                {name: 'fills', type: 'integer'},
                {name: 'px', type: 'number', format: 'currency', decimals: 2},
                {name: 'live', type: 'boolean'}
            ],
            rows: [{day: '2026-11-19', fills: 3, px: 101.5, live: true}],
            totalRows: 1
        },
        {id: 'art_big', columns: [{name: 'v', type: 'number'}], totalRows: 9000}
    ]);

    const answer = (...ids: string[]): Blueprint => ({
        sources: Object.fromEntries(ids.map(it => [it, {artifact: it}])),
        root: 'x',
        elements: {}
    });

    it("maps an artifact to the dataset it names, and builds one from an artifact's columns", () => {
        const {dataCatalog, artifacts} = answerDataFor(answer('art_q', 'art_t', 'art_nope'), {
            dataCatalog: portfolioCatalog,
            registry
        });
        expect(artifacts).toEqual({art_q: 'positions', art_t: 'artifact:art_t'});
        expect(dataCatalog.getDataset('positions')).toBeTruthy();
        expect(dataCatalog.getDataset('artifact:art_t').fields).toMatchObject({
            day: {name: 'day', label: 'Day', type: 'localDate'},
            fills: {type: 'int'},
            px: {type: 'number', format: {prefix: '$', precision: 2}},
            live: {type: 'bool'}
        });
    });

    it('leaves the app catalog as it is when every artifact names a dataset', () => {
        expect(
            answerDataFor(answer('art_q'), {dataCatalog: portfolioCatalog, registry}).dataCatalog
        ).toBe(portfolioCatalog);
    });

    it("loads an artifact's rows, or none and its size when it holds more than the cap", async () => {
        const provider = chatArtifactProvider(registry);
        expect(await provider.loadArtifactAsync('art_t')).toEqual({
            rows: [{day: '2026-11-19', fills: 3, px: 101.5, live: true}],
            totalRows: 1
        });
        expect(await provider.loadArtifactAsync('art_big')).toEqual({rows: [], totalRows: 9000});
        await expect(provider.loadArtifactAsync('art_nope')).rejects.toThrow('art_nope');
    });
});
