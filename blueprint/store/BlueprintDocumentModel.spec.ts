import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../test/blueprintFixtures';
import type {BlueprintAccess} from '../Blueprint';
import {BlueprintModel} from '../BlueprintModel';
import {FakeBlueprintDataProvider} from '../FakeBlueprintDataProvider';
import {BlueprintDocumentModel} from './BlueprintDocumentModel';
import type {BlueprintAccessProvider} from './BlueprintStore';
import {InMemoryBlueprintStore} from './InMemoryBlueprintStore';

/**
 * A stored blueprint: one draft for writers, numbered publishes that never change for everyone,
 * and a version check on every save, whether the store's server makes it or the library does.
 */
describe('BlueprintDocumentModel', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const access = (level: BlueprintAccess, canPublish?: boolean): BlueprintAccessProvider => ({
        accessAsync: async () => ({access: level, ...(canPublish != null ? {canPublish} : {})})
    });

    function session(store: InMemoryBlueprintStore, provider = access('write')) {
        const blueprintModel = new BlueprintModel({
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog})
            }),
            doc = new BlueprintDocumentModel({blueprintModel, store, accessProvider: provider});
        onTestFinished(() => {
            doc.destroy();
            blueprintModel.destroy();
        });
        return {blueprintModel, doc};
    }

    async function created(store = new InMemoryBlueprintStore()) {
        const {id} = await store.createAsync({
            name: 'Positions',
            blueprint: loadBlueprint('p3-morning-report.json')
        });
        return {store, id};
    }

    const errors = (issues: {severity: string; code: string}[]) =>
        issues.filter(it => it.severity === 'error').map(it => it.code);
    const title = (m: BlueprintModel, t: string) =>
        m.applyEdit({ops: [{op: 'set', path: '/elements/posGrid/config/title', value: t}]});

    it('needs an access provider', () => {
        expect(
            () =>
                new BlueprintDocumentModel({
                    blueprintModel: null,
                    store: new InMemoryBlueprintStore(),
                    accessProvider: null
                })
        ).toThrow(/needs an access provider/);
    });

    it('opens the draft in design mode, saves it, and tracks unsaved edits', async () => {
        const {store, id} = await created(),
            {blueprintModel, doc} = session(store);
        expect(await doc.openAsync(id, {as: 'draft'})).toEqual([]);
        expect(blueprintModel.mode).toBe('design');
        expect(doc.document).toMatchObject({kind: 'draft', version: 1});

        title(blueprintModel, 'Mine');
        expect(doc.isDirty).toBe(true);
        expect(await doc.saveDraftAsync()).toEqual([]);
        expect(doc.isDirty).toBe(false);
        expect(doc.document.version).toBe(2);

        const saved = await store.openAsync(id, {as: 'draft'});
        expect(saved.blueprint.elements.posGrid.config.title).toBe('Mine');
        expect(saved.blueprint.schema).toMatchObject({blueprint: 1, widgets: {cubeGrid: 1}});
    });

    it('publishes the draft as the next number, saving it first, and leaves the draft', async () => {
        const {store, id} = await created(),
            {blueprintModel, doc} = session(store);
        await doc.openAsync(id, {as: 'draft'});
        title(blueprintModel, 'First');
        expect(await doc.publishAsync('Ready')).toEqual([]);
        expect(doc.document.publishedVersion).toBe(1);
        expect(await store.listPublishesAsync(id)).toMatchObject([{version: 1, note: 'Ready'}]);

        title(blueprintModel, 'Second');
        await doc.publishAsync();
        const latest = await store.openAsync(id, {as: 'publish'}),
            first = await store.openAsync(id, {as: 'publish', version: 1});
        expect(latest.blueprint.elements.posGrid.config.title).toBe('Second');
        expect(first.blueprint.elements.posGrid.config.title).toBe('First');
        expect(
            (await store.openAsync(id, {as: 'draft'})).blueprint.elements.posGrid.config.title
        ).toBe('Second');
    });

    it('opens only the latest publish for a reader, who may copy it but not delete', async () => {
        const {store, id} = await created();
        await store.publishAsync(id, {base: 1});
        const {blueprintModel, doc} = session(store, access('read'));

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

    it('lets a writer publish by default, unless the provider says otherwise', async () => {
        const {store, id} = await created(),
            {doc} = session(store, access('write', false));
        await doc.openAsync(id, {as: 'draft'});
        expect(doc.canPublish).toBe(false);
        expect(errors(await doc.publishAsync())).toEqual(['edit.notAllowed']);
    });

    it.each([true, false])(
        'refuses a save based on a stale draft, with enforcesBase %s',
        async enforcesBase => {
            const {store, id} = await created(new InMemoryBlueprintStore({enforcesBase})),
                a = session(store),
                b = session(store);
            await a.doc.openAsync(id, {as: 'draft'});
            await b.doc.openAsync(id, {as: 'draft'});
            title(a.blueprintModel, 'A');
            expect(await a.doc.saveDraftAsync()).toEqual([]);
            title(b.blueprintModel, 'B');
            expect(errors(await b.doc.saveDraftAsync())).toEqual(['edit.staleBase']);
            expect(errors(await b.doc.publishAsync())).toEqual(['edit.staleBase']);
            expect(
                (await store.openAsync(id, {as: 'draft'})).blueprint.elements.posGrid.config.title
            ).toBe('A');
        }
    );

    it('keeps renames with the draft across sessions until a publish takes them, undo included', async () => {
        const {store, id} = await created();

        const first = session(store);
        await first.doc.openAsync(id, {as: 'draft'});
        first.blueprintModel.applyEdit({
            ops: [{op: 'renameId', kind: 'element', from: 'posGrid', to: 'positionsGrid'}]
        });
        await first.doc.saveDraftAsync();

        const second = session(store);
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

        const [publish] = await store.listPublishesAsync(id);
        expect(publish.renames).toEqual([
            {kind: 'element', from: 'posGrid', to: 'positionsGrid'},
            {kind: 'element', from: 'priceChart', to: 'prices'}
        ]);
        expect(second.doc.pendingRenames).toEqual([]);
        expect((await store.openAsync(id, {as: 'draft'})).pendingRenames).toEqual([]);
    });

    it('creates a blueprint from the one open, and deletes it with its personalizations', async () => {
        const store = new InMemoryBlueprintStore(),
            {blueprintModel, doc} = session(store);
        blueprintModel.setBlueprint(loadBlueprint('p2-linked-dashboard.json'));
        expect(await doc.createAsync('New')).toEqual([]);
        const {id} = doc.document;
        await store.savePersonalizationAsync({
            blueprintId: id,
            preset: null,
            ops: [],
            publishVersion: 1
        });
        expect(await store.loadPersonalizationsAsync(id)).toHaveLength(1);

        await doc.deleteAsync();
        expect(await store.listAsync()).toEqual([]);
        expect(await store.loadPersonalizationsAsync(id)).toEqual([]);
        expect(blueprintModel.blueprint).toBeNull();
    });

    it('upgrades a blueprint through migrate as it opens', async () => {
        const {store, id} = await created(),
            migrate = vi.fn(bp => ({...bp, root: bp.root})),
            blueprintModel = new BlueprintModel({
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: null
            }),
            doc = new BlueprintDocumentModel({
                blueprintModel,
                store,
                accessProvider: access('write'),
                migrate
            });
        onTestFinished(() => blueprintModel.destroy());
        await doc.openAsync(id, {as: 'draft'});
        expect(migrate).toHaveBeenCalledOnce();
    });
});
