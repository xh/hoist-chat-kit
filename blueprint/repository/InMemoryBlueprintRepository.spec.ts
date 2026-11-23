import {describe, expect, it} from 'vitest';
import {loadBlueprint} from '../../test/blueprintFixtures';
import {checkBlueprintType, isGlobal} from './BlueprintRepository';
import {InMemoryBlueprintRepository} from './InMemoryBlueprintRepository';

describe('InMemoryBlueprintRepository', () => {
    const TYPE = 'acme.dashboard',
        OWNER = {
            type: TYPE,
            canCreate: true,
            accessOf: () => ({access: 'write' as const, canPublish: true, canShare: true})
        };

    it('fails closed by default: no creating, and read access only', async () => {
        const repository = new InMemoryBlueprintRepository({type: TYPE});
        expect(await repository.canCreateAsync()).toBe(false);
        await expect(create(repository)).rejects.toThrow(/may not create/);
    });

    it('checks a type with the rule every repository shares', () => {
        expect(() => checkBlueprintType('acme.dashboard')).not.toThrow();
        expect(() => checkBlueprintType('dashboard')).toThrow(/dotted/);
    });

    it('takes one dotted type, and records it on every blueprint', async () => {
        expect(() => new InMemoryBlueprintRepository({type: null})).toThrow(/type/);
        expect(() => new InMemoryBlueprintRepository({type: 'dashboard'})).toThrow(/dotted/);
        expect(() => new InMemoryBlueprintRepository({type: `acme.${'x'.repeat(50)}`})).toThrow(
            /50/
        );
        const repository = new InMemoryBlueprintRepository(OWNER),
            {id, type} = await create(repository);
        expect(repository.type).toBe(TYPE);
        expect(type).toBe(TYPE);
        expect((await repository.listAsync())[0].type).toBe(TYPE);
        expect((await repository.openAsync(id, {as: 'draft'})).type).toBe(TYPE);
    });

    it('refuses a name the user already has in its type, on a create or a copy', async () => {
        const repository = new InMemoryBlueprintRepository(OWNER),
            {id} = await create(repository);
        await repository.publishAsync(id, {base: 1});
        await expect(create(repository)).rejects.toMatchObject({httpStatus: 400});
        await expect(repository.copyAsync(id, {name: 'Positions'})).rejects.toMatchObject({
            httpStatus: 400
        });
        expect((await repository.copyAsync(id, {name: 'Positions 2'})).name).toBe('Positions 2');
    });

    it('renames a blueprint for a writer, refusing a name its owner already has', async () => {
        const repository = new InMemoryBlueprintRepository(OWNER),
            {id} = await create(repository);
        await repository.createAsync({
            name: 'Orders',
            blueprint: loadBlueprint('p3-morning-report.json')
        });
        const renamed = await repository.renameAsync(id, {name: 'Book', description: 'The book'});
        expect(renamed).toMatchObject({id, name: 'Book', description: 'The book', draftVersion: 1});
        expect((await repository.openAsync(id, {as: 'draft'})).name).toBe('Book');
        await expect(repository.renameAsync(id, {name: 'Orders'})).rejects.toMatchObject({
            httpStatus: 400
        });
        // Its own name is no clash.
        expect((await repository.renameAsync(id, {name: 'Book'})).description).toBe('The book');

        const reader = new InMemoryBlueprintRepository({type: TYPE});
        Object.assign(reader, {items: (repository as any).items});
        await expect(reader.renameAsync(id, {name: 'Mine'})).rejects.toThrow(/writer/);
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

    it('names the user who created a blueprint as its owner, whoever saves it after', async () => {
        const creator = new InMemoryBlueprintRepository({...OWNER, userId: 'ann'}),
            {id} = await create(creator);
        expect((await creator.listAsync()).find(it => it.id === id).owner).toBe('ann');
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
            repository = new InMemoryBlueprintRepository({
                type: TYPE,
                canCreate: true,
                accessOf: () => grant
            });
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
            type: TYPE,
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

    it("changes a publish's note, label and pin for a writer, leaving its content as it was", async () => {
        let access: 'write' | 'read' = 'write';
        const repository = new InMemoryBlueprintRepository({
                ...OWNER,
                accessOf: () => ({access, canPublish: true})
            }),
            {id, version: base} = await create(repository);
        await repository.publishAsync(id, {base, note: 'First'});
        const content = (await repository.openAsync(id, {as: 'publish', version: 1})).blueprint;

        expect(
            await repository.updatePublishAsync(id, 1, {
                label: `  ${'x'.repeat(60)}  `,
                pinned: true
            })
        ).toMatchObject({version: 1, note: 'First', label: 'x'.repeat(50), pinned: true});
        // Only the keys given change, and null or a blank clears one.
        const cleared = await repository.updatePublishAsync(id, 1, {note: null, label: ' '});
        expect(cleared).toMatchObject({version: 1, pinned: true});
        expect(cleared.note).toBeUndefined();
        expect(cleared.label).toBeUndefined();
        expect((await repository.listPublishesAsync(id))[0]).toEqual(cleared);
        expect((await repository.openAsync(id, {as: 'publish', version: 1})).blueprint).toEqual(
            content
        );

        await expect(repository.updatePublishAsync(id, 9, {pinned: false})).rejects.toThrow();
        access = 'read';
        await expect(repository.updatePublishAsync(id, 1, {pinned: false})).rejects.toThrow();
    });
});
