import {describe, expect, it} from 'vitest';
import {loadBlueprint} from '../../test/blueprintFixtures';
import {InMemoryBlueprintRepository} from './InMemoryBlueprintRepository';

describe('InMemoryBlueprintRepository', () => {
    const create = (repository: InMemoryBlueprintRepository) =>
        repository.createAsync({
            name: 'Positions',
            blueprint: loadBlueprint('p3-morning-report.json')
        });

    it('holds copies, so no caller can change what it holds', async () => {
        const repository = new InMemoryBlueprintRepository(),
            record = await create(repository);
        record.blueprint.elements.posGrid.config.title = 'Changed';
        const opened = await repository.openAsync(record.id, {as: 'draft'});
        expect(opened.blueprint.elements.posGrid.config.title).not.toBe('Changed');
    });

    it('numbers publishes in order, each unchanged by later saves, and bumps the draft', async () => {
        const repository = new InMemoryBlueprintRepository(),
            {id, blueprint} = await create(repository);
        expect(await repository.publishAsync(id, {base: 1})).toMatchObject({
            publish: {version: 1},
            draftVersion: 2
        });
        blueprint.elements.posGrid.config.title = 'Second';
        await repository.saveDraftAsync(id, {blueprint, base: 2, renames: []});
        expect((await repository.publishAsync(id, {base: 3})).publish.version).toBe(2);

        const first = await repository.openAsync(id, {as: 'publish', version: 1});
        expect(first.blueprint.elements.posGrid.config.title).not.toBe('Second');
        expect((await repository.listAsync())[0]).toMatchObject({
            draftVersion: 4,
            publishedVersion: 2
        });
    });

    it('opens no publish of a blueprint never published', async () => {
        const repository = new InMemoryBlueprintRepository(),
            {id} = await create(repository);
        expect(await repository.openAsync(id, {as: 'publish'})).toBeNull();
    });

    it('accepts a stale base when it does not enforce one', async () => {
        const repository = new InMemoryBlueprintRepository({enforcesBase: false}),
            {id, blueprint} = await create(repository);
        expect(
            (await repository.saveDraftAsync(id, {blueprint, base: 0, renames: []})).issues
        ).toEqual([]);
    });

    it("lists each blueprint with the user's access to it", async () => {
        const repository = new InMemoryBlueprintRepository({
            accessOf: () => ({access: 'read', canPublish: false})
        });
        await create(repository);
        expect((await repository.listAsync())[0]).toMatchObject({
            access: 'read',
            canPublish: false
        });
    });

    it('keeps one personalization per blueprint and preset', async () => {
        const repository = new InMemoryBlueprintRepository(),
            {id} = await create(repository),
            base = {blueprintId: id, ops: [], publishVersion: 1};
        await repository.savePersonalizationAsync({...base, preset: null});
        await repository.savePersonalizationAsync({...base, preset: 'view:risk'});
        await repository.savePersonalizationAsync({
            ...base,
            preset: 'view:risk',
            publishVersion: 2
        });
        const saved = await repository.loadPersonalizationsAsync(id);
        expect(saved.map(it => [it.preset, it.publishVersion])).toEqual([
            [null, 1],
            ['view:risk', 2]
        ]);
    });
});
