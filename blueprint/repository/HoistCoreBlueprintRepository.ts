import {XH} from '@xh/hoist/core';
import type {Blueprint, BlueprintIssue} from '../Blueprint';
import type {
    BlueprintAccessSpec,
    BlueprintCreateSpec,
    BlueprintOpenOptions,
    BlueprintPersonalization,
    BlueprintPublish,
    BlueprintPublishResult,
    BlueprintRecord,
    BlueprintRename,
    BlueprintRepository,
    BlueprintSaveResult,
    BlueprintSummary
} from './BlueprintRepository';

/**
 * A {@link BlueprintRepository} over hoist-core's blueprint endpoints, `xhBlueprint/<action>`.
 * hoist-core keeps blueprints in its database, checks each user's access, and refuses a stale
 * `base` atomically. An app enables it in hoist-core with the `xhBlueprintConfig` config.
 *
 * Grantees for sharing are a username, `role:<ROLE>`, or `*` for everyone. The server answers
 * 404 for a blueprint that is missing or that the user may not read, and 403 for an action the
 * user's access does not allow. These map to the contract's refusals: an issue from a save or
 * publish, null from an open or a copy, and a rejection from any other call.
 */
export class HoistCoreBlueprintRepository implements BlueprintRepository {
    readonly enforcesBase = true;
    private readonly baseUrl: string;

    constructor(config: {/** Default `xhBlueprint`. */ baseUrl?: string} = {}) {
        this.baseUrl = config.baseUrl ?? 'xhBlueprint';
    }

    listAsync(): Promise<BlueprintSummary[]> {
        return XH.fetchJson({url: this.url('list')});
    }

    async canCreateAsync(): Promise<boolean> {
        const {canCreate} = await XH.fetchJson({url: this.url('canCreate')});
        return canCreate === true;
    }

    openAsync(id: string, opts: BlueprintOpenOptions): Promise<BlueprintRecord> {
        const version = opts.as === 'publish' ? opts.version : null;
        return XH.fetchJson({
            url: this.url('open'),
            params: {id, as: opts.as, ...(version != null ? {version} : {})}
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
        return XH.fetchJson({url: this.url('listPublishes'), params: {id}});
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

    loadPersonalizationsAsync(blueprintId: string): Promise<BlueprintPersonalization[]> {
        return XH.fetchJson({url: this.url('personalizations'), params: {blueprintId}});
    }

    async savePersonalizationAsync(p: BlueprintPersonalization): Promise<void> {
        await XH.postJson({url: this.url('savePersonalization'), body: p});
    }

    async updateAccessAsync(id: string, spec: BlueprintAccessSpec): Promise<void> {
        await XH.postJson({url: this.url('updateAccess', id), body: spec});
    }

    //------------------
    // Implementation
    //------------------
    // A POST carries its ID in the query, as hoist-core reads its body as the JSON payload.
    private url(action: string, id?: string): string {
        const ret = `${this.baseUrl}/${action}`;
        return id == null ? ret : `${ret}?id=${encodeURIComponent(id)}`;
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

function refused(code: string, e: {message?: string}): BlueprintIssue {
    return {code, severity: 'error', path: '', message: e?.message ?? code};
}
