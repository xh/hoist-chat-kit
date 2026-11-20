import {hoistCore, hoistError, initTestAppAsync, noContent} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it} from 'vitest';
import {HoistCoreBlueprintRepository} from './HoistCoreBlueprintRepository';

/**
 * The repository over hoist-core's `xhBlueprint` endpoints: each method one request, the record
 * shapes as the server sends them, and the server's refusals as the contract reports them.
 */
describe('HoistCoreBlueprintRepository', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const repository = new HoistCoreBlueprintRepository(),
        record = {id: 'bp1', name: 'Positions', access: 'write', canPublish: true, version: 2};

    it('checks a stale base on the server', () => {
        expect(repository.enforcesBase).toBe(true);
    });

    it('lists, answers whether the user may create, and opens a version', async () => {
        hoistCore.route('GET', 'xhBlueprint/list', () => [record]);
        hoistCore.route('GET', 'xhBlueprint/canCreate', () => ({canCreate: true}));
        hoistCore.route('GET', 'xhBlueprint/open', req =>
            req.query.version === '7' ? null : {...record, kind: req.query.as}
        );

        expect(await repository.listAsync()).toEqual([record]);
        expect(await repository.canCreateAsync()).toBe(true);
        expect(await repository.openAsync('bp1', {as: 'draft'})).toMatchObject({kind: 'draft'});
        expect(await repository.openAsync('bp1', {as: 'publish', version: 7})).toBeNull();
        const [draft, missing] = hoistCore.requestsTo('xhBlueprint/open');
        expect(draft.query).toEqual({id: 'bp1', as: 'draft'});
        expect(missing.query).toEqual({id: 'bp1', as: 'publish', version: '7'});
    });

    it('saves and publishes with the ID in the query and the rest in the body', async () => {
        hoistCore.route('POST', 'xhBlueprint/saveDraft', () => ({version: 3, issues: []}));
        hoistCore.route('POST', 'xhBlueprint/publish', () => ({
            publish: {version: 1, published: 0, renames: []},
            draftVersion: 4,
            issues: []
        }));
        const renames = [{kind: 'element' as const, from: 'a', to: 'b'}];

        expect(
            await repository.saveDraftAsync('bp 1', {blueprint: {root: 'x'}, base: 2, renames})
        ).toEqual({version: 3, issues: []});
        expect(await repository.publishAsync('bp 1', {base: 3, note: 'Ready'})).toMatchObject({
            draftVersion: 4
        });
        const [save] = hoistCore.requestsTo('xhBlueprint/saveDraft'),
            [publish] = hoistCore.requestsTo('xhBlueprint/publish');
        expect(save.query).toEqual({id: 'bp 1'});
        expect(save.json).toEqual({blueprint: {root: 'x'}, base: 2, renames});
        expect(publish.json).toEqual({base: 3, note: 'Ready'});
    });

    it("reports the server's refusal of a save or publish as an issue", async () => {
        hoistCore.route('POST', 'xhBlueprint/saveDraft', () =>
            hoistError(404, {message: 'Not found'})
        );
        hoistCore.route('POST', 'xhBlueprint/publish', () =>
            hoistError(403, {name: 'NotAuthorizedException', message: 'Not allowed'})
        );
        const save = await repository.saveDraftAsync('bp1', {blueprint: {}, base: 1, renames: []}),
            publish = await repository.publishAsync('bp1', {base: 1});
        expect(save.issues.map(it => it.code)).toEqual(['repository.unknown']);
        expect(publish.issues.map(it => it.code)).toEqual(['edit.notAllowed']);
    });

    it('copies nothing from a source that is missing or that the user may not read', async () => {
        hoistCore.route('POST', 'xhBlueprint/copy', () => hoistError(404, {message: 'Not found'}));
        expect(await repository.copyAsync('gone', {name: 'Mine'})).toBeNull();
    });

    it('creates, copies, lists publishes, deletes and shares', async () => {
        hoistCore.route('POST', 'xhBlueprint/create', req => ({...record, name: req.json.name}));
        hoistCore.route('POST', 'xhBlueprint/copy', req => ({...record, name: req.json.name}));
        hoistCore.route('GET', 'xhBlueprint/listPublishes', () => [{version: 1}]);
        hoistCore.route('POST', 'xhBlueprint/delete', () => noContent());
        hoistCore.route('POST', 'xhBlueprint/updateAccess', () => noContent());

        expect(await repository.createAsync({name: 'New', blueprint: {root: 'x'}})).toMatchObject({
            name: 'New'
        });
        expect(
            await repository.copyAsync('bp1', {name: 'Mine', from: {as: 'publish', version: 1}})
        ).toMatchObject({name: 'Mine'});
        expect(await repository.listPublishesAsync('bp1')).toEqual([{version: 1}]);
        await repository.deleteAsync('bp1');
        await repository.updateAccessAsync('bp1', {writers: ['ann'], readers: ['*']});

        expect(hoistCore.requestsTo('xhBlueprint/copy')[0].json).toEqual({
            name: 'Mine',
            from: {as: 'publish', version: 1}
        });
        expect(hoistCore.requestsTo('xhBlueprint/delete')[0].query).toEqual({id: 'bp1'});
        expect(hoistCore.requestsTo('xhBlueprint/updateAccess')[0].json).toEqual({
            writers: ['ann'],
            readers: ['*']
        });
    });

    it("loads and saves the signed-in user's personalizations", async () => {
        const p = {blueprintId: 'bp1', preset: null, ops: [], publishVersion: 1};
        hoistCore.route('GET', 'xhBlueprint/personalizations', () => [p]);
        hoistCore.route('POST', 'xhBlueprint/savePersonalization', req => req.json);

        expect(await repository.loadPersonalizationsAsync('bp1')).toEqual([p]);
        await repository.savePersonalizationAsync(p);
        expect(hoistCore.requestsTo('xhBlueprint/personalizations')[0].query).toEqual({
            blueprintId: 'bp1'
        });
        expect(hoistCore.requestsTo('xhBlueprint/savePersonalization')[0].json).toEqual(p);
    });
});
