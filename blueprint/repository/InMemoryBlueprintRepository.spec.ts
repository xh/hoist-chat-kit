import {describe, expect, it} from 'vitest';
import {loadBlueprint} from '../../test/blueprintFixtures';
import {isGlobal} from './BlueprintRepository';
import {InMemoryBlueprintRepository} from './InMemoryBlueprintRepository';

describe('InMemoryBlueprintRepository', () => {
    const OWNER = {
        canCreate: true,
        accessOf: () => ({access: 'write' as const, canPublish: true, canShare: true})
    };

    it('fails closed by default: no creating, and read access only', async () => {
        const repository = new InMemoryBlueprintRepository();
        expect(await repository.canCreateAsync()).toBe(false);
        await expect(create(repository)).rejects.toThrow(/may not create/);
    });

    const create = (repository: InMemoryBlueprintRepository) =>
        repository.createAsync({
            name: 'Positions',
            blueprint: loadBlueprint('p3-morning-report.json')
        });

    it('holds copies, so no caller can change what it holds', async () => {
        const repository = new InMemoryBlueprintRepository(OWNER),
            record = await create(repository);
        record.blueprint.elements.posGrid.config.title = 'Changed';
        const opened = await repository.openAsync(record.id, {as: 'draft'});
        expect(opened.blueprint.elements.posGrid.config.title).not.toBe('Changed');
    });

    it('numbers publishes in order, each unchanged by later saves, and bumps the draft', async () => {
        const repository = new InMemoryBlueprintRepository(OWNER),
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

    it('records where a new blueprint was copied from, when given', async () => {
        const repository = new InMemoryBlueprintRepository(OWNER),
            source = await create(repository),
            copiedFrom = {id: source.id, version: 1, as: 'draft' as const},
            record = await repository.createAsync({
                name: 'Mine',
                blueprint: loadBlueprint('p3-morning-report.json'),
                copiedFrom
            });
        expect(record.copiedFrom).toEqual(copiedFrom);
    });

    it('refuses to record a copy of a version the user may not open', async () => {
        const grant = {access: 'write' as 'read' | 'write', canPublish: true},
            repository = new InMemoryBlueprintRepository({canCreate: true, accessOf: () => grant});
        const {id} = await create(repository);
        grant.access = 'read';
        await expect(
            repository.createAsync({
                name: 'Mine',
                blueprint: {},
                copiedFrom: {id, version: 1, as: 'draft'}
            })
        ).rejects.toMatchObject({httpStatus: 403});
        await expect(
            repository.createAsync({
                name: 'Mine',
                blueprint: {},
                copiedFrom: {id: 'gone', version: 1, as: 'publish'}
            })
        ).rejects.toMatchObject({httpStatus: 404});
    });

    it('shares with users, roles and everyone, and with everyone only where its config allows', async () => {
        const make = (canShareGlobally: boolean) =>
                new InMemoryBlueprintRepository({...OWNER, canShareGlobally}),
            closed = make(false),
            {id} = await create(closed);
        expect(closed.sharingModes).toEqual(['users', 'roles', 'everyone']);
        expect((await closed.listAsync())[0].canShareGlobally).toBe(false);
        await closed.updateAccessAsync(id, {writers: ['ann'], readers: ['role:TRADER']});
        await expect(closed.updateAccessAsync(id, {writers: [], readers: ['*']})).rejects.toThrow(
            /everyone/
        );

        const open = make(true),
            other = await create(open);
        expect((await open.listAsync())[0].canShareGlobally).toBe(true);
        await open.updateAccessAsync(other.id, {writers: [], readers: ['*']});
        expect(isGlobal((await open.listAsync())[0])).toBe(true);
    });

    it('opens no publish of a blueprint never published', async () => {
        const repository = new InMemoryBlueprintRepository(OWNER),
            {id} = await create(repository);
        expect(await repository.openAsync(id, {as: 'publish'})).toBeNull();
    });

    it('accepts a stale base when it does not enforce one', async () => {
        const repository = new InMemoryBlueprintRepository({...OWNER, enforcesBase: false}),
            {id, blueprint} = await create(repository);
        expect(
            (await repository.saveDraftAsync(id, {blueprint, base: 0, renames: []})).issues
        ).toEqual([]);
    });

    it("lists each blueprint with the user's access to it", async () => {
        const repository = new InMemoryBlueprintRepository({
            canCreate: true,
            accessOf: () => ({access: 'read', canPublish: false})
        });
        await create(repository);
        expect((await repository.listAsync())[0]).toMatchObject({
            access: 'read',
            canPublish: false
        });
    });

    it('keeps one personalization per blueprint and preset', async () => {
        const repository = new InMemoryBlueprintRepository(OWNER),
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
