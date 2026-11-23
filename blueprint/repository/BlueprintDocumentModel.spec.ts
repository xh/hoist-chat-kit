import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import type {BlueprintAccess} from '../Blueprint';
import {BlueprintModel} from '../BlueprintModel';
import {BlueprintRegistry} from '../BlueprintRegistry';
import {FakeBlueprintDataProvider} from '../FakeBlueprintDataProvider';
import {BlueprintDocumentModel} from './BlueprintDocumentModel';
import type {BlueprintRecord} from './BlueprintRepository';
import {InMemoryBlueprintRepository} from './InMemoryBlueprintRepository';

/**
 * A stored blueprint: one shared draft for writers, numbered publishes that never change for
 * everyone, and a version check on every save, whether the repository's server makes it or the
 * library does. The repository alone says what the user may do.
 */
describe('BlueprintDocumentModel', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    // The access the repository grants, which a test changes as it goes.
    interface Grant {
        access: BlueprintAccess;
        canPublish: boolean;
        canShare?: boolean;
    }

    // What a blueprint's owner may do.
    const OWNER: Grant = {access: 'write', canPublish: true, canShare: true};
    const TYPE = 'acme.dashboard';

    function session(repository: InMemoryBlueprintRepository) {
        const blueprintModel = new BlueprintModel({
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog})
            }),
            doc = new BlueprintDocumentModel({blueprintModel, repository});
        onTestFinished(() => {
            doc.destroy();
            blueprintModel.destroy();
        });
        return {blueprintModel, doc};
    }

    // A blueprint the repository holds, with the access a test grants to it. The user writes
    // any blueprint they create or copy.
    async function created(config: {enforcesBase?: boolean} = {}) {
        const grant: Grant = {...OWNER};
        let shared: string = null;
        const repository = new InMemoryBlueprintRepository({
                ...config,
                type: TYPE,
                canCreate: true,
                accessOf: it => ({...(it === shared ? grant : OWNER)})
            }),
            {id} = await repository.createAsync({
                name: 'Positions',
                blueprint: loadBlueprint('p3-morning-report.json')
            });
        shared = id;
        return {repository, grant, id};
    }

    const errors = (issues: {severity: string; code: string}[]) =>
        issues.filter(it => it.severity === 'error').map(it => it.code);
    const title = (m: BlueprintModel, t: string) =>
        m.applyEdit({ops: [{op: 'set', path: '/elements/posGrid/config/title', value: t}]});

    it('lets the blueprint it holds open others through its repository', async () => {
        const {repository} = await created(),
            {blueprintModel} = session(repository);
        expect(blueprintModel.drillInRepository).toBe(repository);
    });

    it('needs a repository', () => {
        expect(() => new BlueprintDocumentModel({blueprintModel: null, repository: null})).toThrow(
            /needs a repository/
        );
    });

    it('opens the draft in design mode, saves it, and tracks unsaved edits', async () => {
        const {repository, id} = await created(),
            {blueprintModel, doc} = session(repository);
        expect(await doc.openAsync(id, {as: 'draft'})).toEqual([]);
        expect(blueprintModel.mode).toBe('design');
        expect(doc.document).toMatchObject({kind: 'draft', version: 1});

        title(blueprintModel, 'Mine');
        expect(doc.isDirty).toBe(true);
        expect(await doc.saveDraftAsync()).toEqual([]);
        expect(doc.isDirty).toBe(false);
        expect(doc.document.version).toBe(2);

        const saved = await repository.openAsync(id, {as: 'draft'});
        expect(saved.blueprint.elements.posGrid.config.title).toBe('Mine');
        expect(saved.blueprint.schema).toMatchObject({blueprint: 1, widgets: {cubeGrid: 1}});
    });

    it('saves a draft with an unfinished widget, and refuses to publish it, naming the widget', async () => {
        const {repository, id} = await created(),
            {blueprintModel, doc} = session(repository);
        await doc.openAsync(id, {as: 'draft'});
        blueprintModel.applyEdit({
            ops: [{op: 'set', path: '/elements/sectorChart/config/y', value: []}]
        });
        expect(errors(await doc.saveDraftAsync())).toEqual([]);
        expect(
            (await repository.openAsync(id, {as: 'draft'})).blueprint.elements.sectorChart.config.y
        ).toEqual([]);

        // A host disables publishing while any is listed.
        expect(doc.unfinishedElements).toEqual(['sectorChart']);
        const refused = await doc.publishAsync();
        expect(refused[0].message).toBe('Finish sectorChart before you publish.');
        expect(errors(refused)).toContain('config.incomplete');
        expect(await repository.listPublishesAsync(id)).toEqual([]);
    });

    it('publishes the draft as the next number, saving it first, and leaves the draft', async () => {
        const {repository, id} = await created(),
            {blueprintModel, doc} = session(repository);
        await doc.openAsync(id, {as: 'draft'});
        title(blueprintModel, 'First');
        expect(await doc.publishAsync('Ready')).toEqual([]);
        expect(doc.document.publishedVersion).toBe(1);
        expect(await repository.listPublishesAsync(id)).toMatchObject([
            {version: 1, note: 'Ready'}
        ]);

        title(blueprintModel, 'Second');
        await doc.publishAsync();
        const latest = await repository.openAsync(id, {as: 'publish'}),
            first = await repository.openAsync(id, {as: 'publish', version: 1});
        expect(latest.blueprint.elements.posGrid.config.title).toBe('Second');
        expect(first.blueprint.elements.posGrid.config.title).toBe('First');
        expect(
            (await repository.openAsync(id, {as: 'draft'})).blueprint.elements.posGrid.config.title
        ).toBe('Second');
    });

    describe('saving one at a time', () => {
        // A repository whose saves and publishes wait until the test releases them, recording saves.
        class Gated extends InMemoryBlueprintRepository {
            calls: {base: number; title: string}[] = [];
            private gates: (() => void)[] = [];

            override async saveDraftAsync(
                ...args: Parameters<InMemoryBlueprintRepository['saveDraftAsync']>
            ) {
                const [, draft] = args;
                this.calls.push({
                    base: draft.base,
                    title: draft.blueprint.elements.posGrid.config.title
                });
                await new Promise<void>(resolve => this.gates.push(resolve));
                return super.saveDraftAsync(...args);
            }

            override async publishAsync(
                ...args: Parameters<InMemoryBlueprintRepository['publishAsync']>
            ) {
                await new Promise<void>(resolve => this.gates.push(resolve));
                return super.publishAsync(...args);
            }

            get gateCount() {
                return this.gates.length;
            }

            async releaseAsync() {
                await vi.waitFor(() => expect(this.gates.length).toBeGreaterThan(0));
                this.gates.shift()();
            }
        }

        async function gated() {
            const repository = new Gated({
                    type: TYPE,
                    canCreate: true,
                    accessOf: () => ({...OWNER})
                }),
                {id} = await repository.createAsync({
                    name: 'Positions',
                    blueprint: loadBlueprint('p3-morning-report.json')
                }),
                s = session(repository);
            await s.doc.openAsync(id, {as: 'draft'});
            return {repository, id, ...s};
        }

        it('coalesces saves asked for while one runs into one save of the latest blueprint', async () => {
            const {repository, blueprintModel, doc} = await gated();
            title(blueprintModel, 'One');
            const first = doc.saveDraftAsync();
            await vi.waitFor(() => expect(repository.calls).toHaveLength(1));
            title(blueprintModel, 'Two');
            const second = doc.saveDraftAsync();
            title(blueprintModel, 'Three');
            const third = doc.saveDraftAsync();
            expect(third).toBe(second);

            await repository.releaseAsync();
            expect(await first).toEqual([]);
            await repository.releaseAsync();
            expect(await second).toEqual([]);
            expect(repository.calls).toEqual([
                {base: 1, title: 'One'},
                {base: 2, title: 'Three'}
            ]);
            expect(doc.isDirty).toBe(false);
        });

        it('publishes only once a save in flight has landed, from its version, keeping later edits', async () => {
            const {repository, blueprintModel, doc, id} = await gated();
            title(blueprintModel, 'One');
            const saving = doc.saveDraftAsync(),
                publishing = doc.publishAsync();
            await repository.releaseAsync();
            expect(await saving).toEqual([]);
            await vi.waitFor(() => expect(repository.gateCount).toBe(1));
            blueprintModel.applyEdit({
                ops: [{op: 'renameId', kind: 'element', from: 'priceChart', to: 'prices'}]
            });
            await repository.releaseAsync();
            expect(await publishing).toEqual([]);
            expect(repository.calls).toHaveLength(1);
            const [publish] = await repository.listPublishesAsync(id);
            expect(publish.version).toBe(1);
            expect(doc.document).toMatchObject({publishedVersion: 1, version: 3});
            // A rename made while the publish ran was not saved, so it waits for the next one.
            expect(publish.renames).toEqual([]);
            expect(doc.pendingRenames).toEqual([
                {kind: 'element', from: 'priceChart', to: 'prices'}
            ]);
            expect(doc.isDirty).toBe(true);
        });
    });

    it('goes stale on a stale save: keeps the edits, refuses more saves, and reloads or copies', async () => {
        const {repository, id} = await created(),
            a = session(repository),
            b = session(repository);
        await a.doc.openAsync(id, {as: 'draft'});
        await b.doc.openAsync(id, {as: 'draft'});
        title(a.blueprintModel, 'A');
        await a.doc.saveDraftAsync();
        title(b.blueprintModel, 'B');
        expect(errors(await b.doc.saveDraftAsync())).toEqual(['edit.staleBase']);
        expect(b.doc.isStale).toBe(true);
        expect(b.blueprintModel.blueprint.elements.posGrid.config.title).toBe('B');

        const save = vi.spyOn(repository, 'saveDraftAsync'),
            publish = vi.spyOn(repository, 'publishAsync');
        expect(errors(await b.doc.saveDraftAsync())).toEqual(['edit.staleBase']);
        expect(errors(await b.doc.publishAsync())).toEqual(['edit.staleBase']);
        expect(save).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();

        const staleVersion = b.doc.document.version;
        expect(await b.doc.createAsync('Mine')).toEqual([]);
        expect(b.doc.document.id).not.toBe(id);
        expect(b.doc.document.copiedFrom).toEqual({id, version: staleVersion, as: 'draft'});
        expect(b.blueprintModel.blueprint.elements.posGrid.config.title).toBe('B');
        expect(b.doc.isStale).toBe(false);

        await b.doc.openAsync(id, {as: 'draft'});
        title(b.blueprintModel, 'Again');
        await repository.saveDraftAsync(id, {
            blueprint: a.blueprintModel.blueprint,
            base: 2,
            renames: []
        });
        await b.doc.saveDraftAsync();
        expect(b.doc.isStale).toBe(true);
        expect(await b.doc.reloadAsync()).toEqual([]);
        expect(b.doc.isStale).toBe(false);
        expect(b.doc.isDirty).toBe(false);
        expect(b.blueprintModel.blueprint.elements.posGrid.config.title).toBe('A');
    });

    it('saves as new without the copy record when the source is no longer open to the user', async () => {
        const {repository, grant, id} = await created(),
            {blueprintModel, doc} = session(repository);
        await doc.openAsync(id, {as: 'draft'});
        title(blueprintModel, 'Mine');
        grant.access = 'read';

        expect(await doc.createAsync('Kept')).toEqual([]);
        expect(doc.document.id).not.toBe(id);
        expect(doc.document).not.toHaveProperty('copiedFrom');
        expect(blueprintModel.blueprint.elements.posGrid.config.title).toBe('Mine');
    });

    it('bumps the draft version on publish, so a draft opened before it saves as stale', async () => {
        const {repository, id} = await created(),
            publisher = session(repository),
            other = session(repository);
        await publisher.doc.openAsync(id, {as: 'draft'});
        await other.doc.openAsync(id, {as: 'draft'});
        publisher.blueprintModel.applyEdit({
            ops: [{op: 'renameId', kind: 'element', from: 'posGrid', to: 'positionsGrid'}]
        });
        expect(await publisher.doc.publishAsync()).toEqual([]);
        expect(publisher.doc.document).toMatchObject({version: 3, draftVersion: 3});

        title(other.blueprintModel, 'Stale');
        expect(errors(await other.doc.saveDraftAsync())).toEqual(['edit.staleBase']);
        title(publisher.blueprintModel, 'Current');
        expect(await publisher.doc.saveDraftAsync()).toEqual([]);
        expect((await repository.openAsync(id, {as: 'draft'})).pendingRenames).toEqual([]);
    });

    it('opens only the latest publish for a reader, who may copy it but not delete', async () => {
        const {repository, grant, id} = await created();
        await repository.publishAsync(id, {base: 1});
        Object.assign(grant, {access: 'read', canPublish: false});
        const {blueprintModel, doc} = session(repository);

        expect(errors(await doc.openAsync(id, {as: 'draft'}))).toEqual(['edit.notAllowed']);
        expect(errors(await doc.openAsync(id, {as: 'publish', version: 1}))).toEqual([
            'edit.notAllowed'
        ]);
        expect(await doc.openAsync(id)).toEqual([]);
        expect([blueprintModel.mode, blueprintModel.access, doc.canPublish]).toEqual([
            'run',
            'read',
            false
        ]);
        expect(errors(await doc.saveDraftAsync())).toEqual(['edit.notAllowed']);
        const copy = await doc.copyAsync('Mine');
        expect(copy.copiedFrom).toEqual({id, version: 1, as: 'publish'});
        await expect(doc.copyAsync('Draft', {as: 'draft'})).rejects.toThrow(
            /only the latest publish/
        );
        await expect(doc.deleteAsync()).rejects.toThrow(/Only a writer/);
    });

    it('keeps the open blueprint, its access, mode and run-mode changes when another fails to open', async () => {
        const {repository, grant, id} = await created();
        await repository.publishAsync(id, {base: 1});
        grant.access = 'read';
        const {blueprintModel, doc} = session(repository);
        await doc.openAsync(id);
        blueprintModel.setTransientValue('/elements/posGrid/config/title', 'Mine');
        const before = blueprintModel.blueprint,
            broken = await repository.createAsync({name: 'Broken', blueprint: {root: 'nowhere'}});

        expect(errors(await doc.openAsync(broken.id, {as: 'draft'})).length).toBeGreaterThan(0);
        expect(blueprintModel.blueprint).toBe(before);
        expect(blueprintModel.effective.elements.posGrid.config.title).toBe('Mine');
        expect([blueprintModel.mode, blueprintModel.access, doc.document.id]).toEqual([
            'run',
            'read',
            id
        ]);
    });

    it('publishes only as the repository allows', async () => {
        const {repository, grant, id} = await created(),
            {doc} = session(repository);
        grant.canPublish = false;
        await doc.openAsync(id, {as: 'draft'});
        expect(doc.canPublish).toBe(false);
        expect(errors(await doc.publishAsync())).toEqual(['edit.notAllowed']);
    });

    it('fails closed: a record that names no access opens for reading only', async () => {
        class Silent extends InMemoryBlueprintRepository {
            override async openAsync(
                ...args: Parameters<InMemoryBlueprintRepository['openAsync']>
            ) {
                const {
                    access: _a,
                    canPublish: _p,
                    canShare: _s,
                    ...rest
                } = await super.openAsync(...args);
                return rest as BlueprintRecord;
            }
        }
        const repository = new Silent({
                type: TYPE,
                canCreate: true,
                accessOf: () => ({...OWNER})
            }),
            {id} = await repository.createAsync({
                name: 'Positions',
                blueprint: loadBlueprint('p3-morning-report.json')
            }),
            {blueprintModel, doc} = session(repository);
        expect(errors(await doc.openAsync(id, {as: 'draft'}))).toEqual(['edit.notAllowed']);
        await repository.publishAsync(id, {base: 1});
        expect(await doc.openAsync(id)).toEqual([]);
        expect([blueprintModel.access, doc.canPublish, doc.canShare]).toEqual([
            'read',
            false,
            false
        ]);
    });

    it('creates only where the repository allows', async () => {
        const {blueprintModel, doc} = session(
            new InMemoryBlueprintRepository({type: TYPE, canCreate: false})
        );
        blueprintModel.setBlueprint(loadBlueprint('p2-linked-dashboard.json'));
        expect(errors(await doc.createAsync('New'))).toEqual(['edit.notAllowed']);
    });

    it('shares a blueprint only as the repository allows, and only where it can share', async () => {
        const {repository, grant, id} = await created(),
            {doc} = session(repository);
        await doc.openAsync(id, {as: 'draft'});
        expect(doc.canShare).toBe(true);
        const sharing = {writers: ['ann'], readers: ['role:TRADER']};
        await doc.updateAccessAsync(sharing);
        expect(doc.document.sharing).toEqual(sharing);
        expect((await repository.listAsync())[0].sharing).toEqual(sharing);

        // A writer the repository does not let share sees neither the control nor the sharing.
        grant.canShare = false;
        await doc.openAsync(id, {as: 'draft'});
        expect(doc.canShare).toBe(false);
        expect(doc.document).not.toHaveProperty('sharing');

        grant.canShare = true;
        await doc.openAsync(id, {as: 'draft'});
        Object.assign(repository, {updateAccessAsync: undefined});
        expect(doc.canShare).toBe(false);
    });

    it('renames the blueprint open for a writer, where its repository can rename', async () => {
        const {repository, grant, id} = await created(),
            {doc} = session(repository);
        await doc.openAsync(id, {as: 'draft'});
        expect(doc.canRename).toBe(true);
        await doc.renameAsync('Book', 'The book');
        expect(doc.document).toMatchObject({name: 'Book', description: 'The book'});
        expect((await repository.listAsync())[0].name).toBe('Book');

        grant.access = 'read';
        await repository.publishAsync(id, {base: 1});
        await doc.openAsync(id, {as: 'publish'});
        expect(doc.canRename).toBe(false);
        await expect(doc.renameAsync('Mine')).rejects.toThrow(/writer/);

        grant.access = 'write';
        await doc.openAsync(id, {as: 'draft'});
        Object.assign(repository, {renameAsync: undefined});
        expect(doc.canRename).toBe(false);
    });

    it('shares only in the modes its repository supports, and with everyone only if allowed', async () => {
        const {repository, id} = await created(),
            {doc} = session(repository);
        await doc.openAsync(id, {as: 'draft'});
        expect(doc.canShareGlobally).toBe(false);
        await expect(doc.updateAccessAsync({writers: [], readers: ['*']})).rejects.toThrow(
            /everyone/
        );

        Object.assign(repository, {sharingModes: ['everyone']});
        expect(doc.sharingModes).toEqual(['everyone']);
        await expect(doc.updateAccessAsync({writers: ['ann'], readers: []})).rejects.toThrow(
            /users/
        );
    });

    it.each([true, false])(
        'refuses a save based on a stale draft, with enforcesBase %s',
        async enforcesBase => {
            const {repository, id} = await created({enforcesBase}),
                a = session(repository),
                b = session(repository);
            await a.doc.openAsync(id, {as: 'draft'});
            await b.doc.openAsync(id, {as: 'draft'});
            title(a.blueprintModel, 'A');
            expect(await a.doc.saveDraftAsync()).toEqual([]);
            title(b.blueprintModel, 'B');
            expect(errors(await b.doc.saveDraftAsync())).toEqual(['edit.staleBase']);
            expect(errors(await b.doc.publishAsync())).toEqual(['edit.staleBase']);
            expect(
                (await repository.openAsync(id, {as: 'draft'})).blueprint.elements.posGrid.config
                    .title
            ).toBe('A');
        }
    );

    it('keeps renames with the draft across sessions until a publish takes them, undo included', async () => {
        const {repository, id} = await created();

        const first = session(repository);
        await first.doc.openAsync(id, {as: 'draft'});
        first.blueprintModel.applyEdit({
            ops: [{op: 'renameId', kind: 'element', from: 'posGrid', to: 'positionsGrid'}]
        });
        await first.doc.saveDraftAsync();

        const second = session(repository);
        await second.doc.openAsync(id, {as: 'draft'});
        expect(second.doc.pendingRenames).toEqual([
            {kind: 'element', from: 'posGrid', to: 'positionsGrid'}
        ]);
        second.blueprintModel.applyEdit({
            ops: [{op: 'renameId', kind: 'element', from: 'priceChart', to: 'prices'}]
        });
        second.blueprintModel.applyEdit({
            ops: [{op: 'renameId', kind: 'variable', from: 'symbol', to: 'ticker'}]
        });
        second.blueprintModel.undo();
        second.blueprintModel.undo();
        second.blueprintModel.redo();
        expect(await second.doc.publishAsync()).toEqual([]);

        const [publish] = await repository.listPublishesAsync(id);
        expect(publish.renames).toEqual([
            {kind: 'element', from: 'posGrid', to: 'positionsGrid'},
            {kind: 'element', from: 'priceChart', to: 'prices'}
        ]);
        expect(second.doc.pendingRenames).toEqual([]);
        expect((await repository.openAsync(id, {as: 'draft'})).pendingRenames).toEqual([]);
    });

    it('creates a blueprint from the one open, and deletes it with its personalizations', async () => {
        const repository = new InMemoryBlueprintRepository({
                type: TYPE,
                canCreate: true,
                accessOf: () => ({...OWNER})
            }),
            {blueprintModel, doc} = session(repository);
        blueprintModel.setBlueprint(loadBlueprint('p2-linked-dashboard.json'));
        expect(await doc.createAsync('New')).toEqual([]);
        const {id} = doc.document;
        await repository.savePersonalizationAsync({
            blueprintId: id,
            preset: null,
            ops: [],
            publishVersion: 1
        });
        expect(await repository.loadPersonalizationsAsync(id)).toHaveLength(1);

        await doc.deleteAsync();
        expect(await repository.listAsync()).toEqual([]);
        expect(await repository.loadPersonalizationsAsync(id)).toEqual([]);
        expect(blueprintModel.blueprint).toBeNull();
    });

    it('opens nothing, by id or by link, of a blueprint of another type', async () => {
        const other = new InMemoryBlueprintRepository({
                type: 'acme.report',
                canCreate: true,
                accessOf: () => ({...OWNER})
            }),
            {id} = await other.createAsync({
                name: 'Report',
                blueprint: loadBlueprint('p2-linked-dashboard.json')
            });
        await other.publishAsync(id, {base: 1});
        // A repository that fails to scope its reads by type.
        const leaky = Object.assign(Object.create(other), {
                type: TYPE,
                openAsync: (...args: Parameters<typeof other.openAsync>) => other.openAsync(...args)
            }),
            {blueprintModel, doc} = session(leaky);

        expect(errors(await doc.openAsync(id, {as: 'draft'}))).toEqual(['edit.notAllowed']);
        expect(errors((await doc.openLinkAsync({id})).issues)).toEqual(['edit.notAllowed']);
        expect(blueprintModel.blueprint).toBeNull();
        expect(doc.document).toBeNull();
    });

    it("copies into another type only if that type's registry and catalog accept it", async () => {
        const {repository, id} = await created(),
            {doc} = session(repository),
            target = (registry: BlueprintRegistry) => ({
                repository: new InMemoryBlueprintRepository({
                    type: 'acme.report',
                    canCreate: true,
                    accessOf: () => ({...OWNER})
                }),
                registry,
                catalog: portfolioCatalog
            });
        await doc.openAsync(id, {as: 'draft'});

        // The blueprint uses app entries that a bare registry lacks.
        const bare = target(new BlueprintRegistry());
        await expect(doc.copyAsync('Copy', {as: 'draft'}, bare)).rejects.toThrow(
            /does not fit acme\.report/
        );
        expect(await bare.repository.listAsync()).toEqual([]);

        const fits = target(scenarioRegistry()),
            record = await doc.copyAsync('Copy', {as: 'draft'}, fits);
        expect(record).toMatchObject({type: 'acme.report', name: 'Copy', kind: 'draft'});
        expect(record).not.toHaveProperty('copiedFrom');
        expect(record.blueprint.schema.widgets).toMatchObject({cubeGrid: 1});
        expect(await repository.listAsync()).toHaveLength(1);
    });

    it('upgrades a blueprint through migrate as it opens', async () => {
        const {repository, id} = await created(),
            migrate = vi.fn(bp => ({...bp, root: bp.root})),
            blueprintModel = new BlueprintModel({
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null
            }),
            doc = new BlueprintDocumentModel({
                blueprintModel,
                repository,
                migrate
            });
        onTestFinished(() => blueprintModel.destroy());
        await doc.openAsync(id, {as: 'draft'});
        expect(migrate).toHaveBeenCalledOnce();
    });
});
