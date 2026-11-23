import {XH} from '@xh/hoist/core';
import type {Blueprint, BlueprintIssue} from '../Blueprint';
import type {
    BlueprintAccessSpec,
    BlueprintCreateSpec,
    BlueprintOpenOptions,
    BlueprintPersonalization,
    BlueprintPublish,
    BlueprintPublishChanges,
    BlueprintPublishResult,
    BlueprintRecord,
    BlueprintRename,
    BlueprintRepository,
    BlueprintSaveResult,
    BlueprintSharingMode,
    BlueprintSummary
} from './BlueprintRepository';
import {checkBlueprintType} from './BlueprintRepository';

/**
 * A {@link BlueprintRepository} over hoist-core's blueprint endpoints, `xhBlueprint/<action>`, for
 * one type of blueprint, which every request names in its query.
 * hoist-core keeps blueprints in its database, checks each user's access, and refuses a stale
 * `base` atomically. An app enables it in hoist-core with the `xhBlueprintConfig` config.
 *
 * Grantees for sharing are a username, `role:<ROLE>`, or `*` for everyone. The server answers
 * 404 for a blueprint that is missing or that the user may not read, and 403 for an action the
 * user's access does not allow. These map to the contract's refusals: an issue from a save or
 * publish, null from an open or a copy, and a rejection from any other call.
 */
export class HoistCoreBlueprintRepository implements BlueprintRepository {
    readonly type: string;
    readonly enforcesBase = true;
    readonly sharingModes: BlueprintSharingMode[] = ['users', 'roles', 'everyone'];
    private readonly baseUrl: string;

    constructor(config: {
        /** The type of blueprint it holds, such as `acme.dashboard`. */
        type: string;
        /** Default `xhBlueprint`. */
        baseUrl?: string;
    }) {
        checkBlueprintType(config?.type);
        this.type = config.type;
        this.baseUrl = config.baseUrl ?? 'xhBlueprint';
    }

    listAsync(): Promise<BlueprintSummary[]> {
        return XH.fetchJson({url: this.url('list'), params: {type: this.type}});
    }

    async canCreateAsync(): Promise<boolean> {
        const {canCreate} = await XH.fetchJson({
            url: this.url('canCreate'),
            params: {type: this.type}
        });
        return canCreate === true;
    }

    openAsync(id: string, opts: BlueprintOpenOptions): Promise<BlueprintRecord> {
        const version = opts.as === 'publish' ? opts.version : null;
        return XH.fetchJson({
            url: this.url('open'),
            params: {id, as: opts.as, ...(version != null ? {version} : {}), type: this.type}
        });
    }

    createAsync(spec: BlueprintCreateSpec): Promise<BlueprintRecord> {
        return XH.postJson({url: this.url('create'), body: spec});
    }

    saveDraftAsync(
        id: string,
        draft: {blueprint: Blueprint; base: number; renames: BlueprintRename[]}
    ): Promise<BlueprintSaveResult> {
        return this.refusalsAsIssues(XH.postJson({url: this.url('saveDraft', id), body: draft}));
    }

    publishAsync(id: string, opts: {base: number; note?: string}): Promise<BlueprintPublishResult> {
        return this.refusalsAsIssues(XH.postJson({url: this.url('publish', id), body: opts}));
    }

    listPublishesAsync(id: string): Promise<BlueprintPublish[]> {
        return XH.fetchJson({url: this.url('listPublishes'), params: {id, type: this.type}});
    }

    async copyAsync(
        id: string,
        opts: {name: string; from?: BlueprintOpenOptions}
    ): Promise<BlueprintRecord> {
        try {
            return await XH.postJson({url: this.url('copy', id), body: opts});
        } catch (e) {
            if (Number(e?.httpStatus) === 404) return null;
            throw e;
        }
    }

    async deleteAsync(id: string): Promise<void> {
        await XH.postJson({url: this.url('delete', id)});
    }

    renameAsync(id: string, spec: {name: string; description?: string}): Promise<BlueprintSummary> {
        return XH.postJson({url: this.url('rename', id), body: spec});
    }

    loadPersonalizationsAsync(blueprintId: string): Promise<BlueprintPersonalization[]> {
        return XH.fetchJson({
            url: this.url('personalizations'),
            params: {blueprintId, type: this.type}
        });
    }

    async savePersonalizationAsync(p: BlueprintPersonalization): Promise<void> {
        await XH.postJson({url: this.url('savePersonalization'), body: p});
    }

    updatePublishAsync(
        id: string,
        version: number,
        changes: BlueprintPublishChanges
    ): Promise<BlueprintPublish> {
        return XH.postJson({url: this.url('updatePublish', id), body: {version, ...changes}});
    }

    async updateAccessAsync(id: string, spec: BlueprintAccessSpec): Promise<void> {
        await XH.postJson({url: this.url('updateAccess', id), body: spec});
    }

    //------------------
    // Implementation
    //------------------
    // A POST carries its ID and type in the query, as hoist-core reads its body as the JSON
    // payload. A GET passes them as params.
    private url(action: string, id?: string): string {
        const base = `${this.baseUrl}/${action}`;
        if (!POSTS.includes(action)) return base;
        const query = new URLSearchParams({...(id != null ? {id} : {}), type: this.type});
        return `${base}?${query}`;
    }

    private async refusalsAsIssues<T extends {issues: BlueprintIssue[]}>(
        request: Promise<T>
    ): Promise<T> {
        try {
            return await request;
        } catch (e) {
            const status = Number(e?.httpStatus);
            if (status === 404) return {issues: [refused('repository.unknown', e)]} as T;
            if (status === 403) return {issues: [refused('edit.notAllowed', e)]} as T;
            throw e;
        }
    }
}

const POSTS = [
    'create',
    'saveDraft',
    'publish',
    'copy',
    'delete',
    'rename',
    'savePersonalization',
    'updateAccess',
    'updatePublish'
];

function refused(code: string, e: {message?: string}): BlueprintIssue {
    return {code, severity: 'error', path: '', message: e?.message ?? code};
}
