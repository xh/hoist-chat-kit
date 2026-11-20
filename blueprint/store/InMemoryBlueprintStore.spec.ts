import {describe, expect, it} from 'vitest';
import {loadBlueprint} from '../../test/blueprintFixtures';
import {InMemoryBlueprintStore} from './InMemoryBlueprintStore';

describe('InMemoryBlueprintStore', () => {
    const create = (store: InMemoryBlueprintStore) =>
        store.createAsync({name: 'Positions', blueprint: loadBlueprint('p3-morning-report.json')});

    it('holds copies, so no caller can change what it holds', async () => {
        const store = new InMemoryBlueprintStore(),
            record = await create(store);
        record.blueprint.elements.posGrid.config.title = 'Changed';
        const opened = await store.openAsync(record.id, {as: 'draft'});
        expect(opened.blueprint.elements.posGrid.config.title).not.toBe('Changed');
    });

    it('numbers publishes in order, each unchanged by later saves', async () => {
        const store = new InMemoryBlueprintStore(),
            {id, blueprint} = await create(store);
        expect((await store.publishAsync(id, {base: 1})).publish.version).toBe(1);
        blueprint.elements.posGrid.config.title = 'Second';
        await store.saveDraftAsync(id, {blueprint, base: 1, renames: []});
        expect((await store.publishAsync(id, {base: 2})).publish.version).toBe(2);

        const first = await store.openAsync(id, {as: 'publish', version: 1});
        expect(first.blueprint.elements.posGrid.config.title).not.toBe('Second');
        expect((await store.listAsync())[0]).toMatchObject({draftVersion: 2, publishedVersion: 2});
    });

    it('opens no publish of a blueprint never published', async () => {
        const store = new InMemoryBlueprintStore(),
            {id} = await create(store);
        expect(await store.openAsync(id, {as: 'publish'})).toBeNull();
    });

    it('accepts a stale base when it does not enforce one', async () => {
        const store = new InMemoryBlueprintStore({enforcesBase: false}),
            {id, blueprint} = await create(store);
        expect((await store.saveDraftAsync(id, {blueprint, base: 0, renames: []})).issues).toEqual(
            []
        );
    });

    it("lists each blueprint with the user's access to it", async () => {
        const store = new InMemoryBlueprintStore({accessOf: () => 'read'});
        await create(store);
        expect((await store.listAsync())[0].access).toBe('read');
    });

    it('keeps one personalization per blueprint and preset', async () => {
        const store = new InMemoryBlueprintStore(),
            {id} = await create(store),
            base = {blueprintId: id, ops: [], publishVersion: 1};
        await store.savePersonalizationAsync({...base, preset: null});
        await store.savePersonalizationAsync({...base, preset: 'view:risk'});
        await store.savePersonalizationAsync({...base, preset: 'view:risk', publishVersion: 2});
        const saved = await store.loadPersonalizationsAsync(id);
        expect(saved.map(it => [it.preset, it.publishVersion])).toEqual([
            [null, 1],
            ['view:risk', 2]
        ]);
    });
});
