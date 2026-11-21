import type {Blueprint, BlueprintAccess} from '../Blueprint';
import {
    type BlueprintAccessSpec,
    type BlueprintCreateSpec,
    type BlueprintOpenOptions,
    type BlueprintPersonalization,
    type BlueprintPublish,
    type BlueprintPublishResult,
    type BlueprintRecord,
    type BlueprintRename,
    type BlueprintSaveResult,
    type BlueprintSharingMode,
    type BlueprintRepository,
    type BlueprintSummary,
    staleBaseIssue
} from './BlueprintRepository';
import {checkBlueprintType} from './impl/blueprintType';

/**
 * A {@link BlueprintRepository} in memory, for tests and demos. It holds everything as copies, so
 * no caller can change what it holds, and it refuses readers as a server should. Being
 * single-threaded, it checks a stale `base` truthfully. Construct it with `enforcesBase: false` to
 * test the library's own check, as for a repository whose server cannot.
 *
 * Not for production: it keeps nothing, and its access is what its config grants, by default
 * read only, with no creating, publishing or sharing.
 */
export class InMemoryBlueprintRepository implements BlueprintRepository {
    readonly type: string;
    readonly enforcesBase: boolean;
    readonly sharingModes: BlueprintSharingMode[] = ['users', 'roles', 'everyone'];
    private readonly canShareGlobally: boolean;
    private readonly userId: string;
    private readonly accessOf: (id: string) => Grant;
    private readonly canCreate: boolean;
    private readonly items = new Map<string, Item>();
    private readonly personalizations = new Map<string, BlueprintPersonalization>();
    private nextId = 1;

    constructor(config: {
        /** The type of blueprint it holds, such as `acme.dashboard`. */
        type: string;
        enforcesBase?: boolean;
        /** The signed-in user the repository acts for. Default `user`. */
        userId?: string;
        /** The user's access to each blueprint. Default read, with no publishing or sharing. */
        accessOf?: (id: string) => Grant;
        /** True if the user may create blueprints. Default false. */
        canCreate?: boolean;
        /** True if a user who may share a blueprint may share it with everyone. Default false. */
        canShareGlobally?: boolean;
    }) {
        checkBlueprintType(config?.type);
        this.type = config.type;
        this.enforcesBase = config.enforcesBase ?? true;
        this.userId = config.userId ?? 'user';
        this.accessOf = config.accessOf ?? (() => ({access: 'read', canPublish: false}));
        this.canCreate = config.canCreate ?? false;
        this.canShareGlobally = config.canShareGlobally ?? false;
    }

    async canCreateAsync(): Promise<boolean> {
        return this.canCreate;
    }

    async listAsync(): Promise<BlueprintSummary[]> {
        return [...this.items.values()].map(it => clone(this.summaryOf(it)));
    }

    async openAsync(id: string, opts: BlueprintOpenOptions): Promise<BlueprintRecord> {
        const item = this.items.get(id);
        if (!item || (needsWrite(opts) && !this.isWriter(id))) return null;
        if (opts.as === 'draft') {
            return clone({
                ...this.summaryOf(item),
                blueprint: item.draft,
                kind: 'draft',
                version: item.draftVersion,
                pendingRenames: item.pendingRenames
            });
        }
        const publish =
            opts.version != null ? item.publishes[opts.version - 1] : item.publishes.at(-1);
        if (!publish) return null;
        return clone({
            ...this.summaryOf(item),
            blueprint: publish.blueprint,
            kind: 'publish',
            version: publish.info.version,
            pendingRenames: []
        });
    }

    async createAsync(spec: BlueprintCreateSpec): Promise<BlueprintRecord> {
        if (!this.canCreate) throw new Error('You may not create a blueprint.');
        const taken = [...this.items.values()].some(
            it => it.owner === this.userId && it.name === spec.name
        );
        if (taken) throw httpError(400, `You already have a blueprint named '${spec.name}'.`);
        if (spec.copiedFrom) this.checkSource(spec.copiedFrom);
        const id = `bp${this.nextId++}`;
        this.items.set(id, {
            id,
            name: spec.name,
            description: spec.description,
            draft: clone(spec.blueprint),
            draftVersion: 1,
            pendingRenames: [],
            publishes: [],
            owner: this.userId,
            updated: Date.now(),
            updatedBy: this.userId,
            ...(spec.copiedFrom ? {copiedFrom: clone(spec.copiedFrom)} : {})
        });
        return this.openAsync(id, {as: 'draft'});
    }

    async saveDraftAsync(
        id: string,
        draft: {blueprint: Blueprint; base: number; renames: BlueprintRename[]}
    ): Promise<BlueprintSaveResult> {
        const item = this.items.get(id);
        if (!item) return {issues: [missing(id)]};
        if (!this.isWriter(id)) return {issues: [notAllowed('save the draft')]};
        if (this.enforcesBase && draft.base !== item.draftVersion) {
            return {issues: [staleBaseIssue(draft.base, item.draftVersion)]};
        }
        Object.assign(item, {
            draft: clone(draft.blueprint),
            draftVersion: item.draftVersion + 1,
            pendingRenames: clone(draft.renames),
            updated: Date.now(),
            updatedBy: this.userId
        });
        return {version: item.draftVersion, issues: []};
    }

    async publishAsync(
        id: string,
        opts: {base: number; note?: string}
    ): Promise<BlueprintPublishResult> {
        const item = this.items.get(id);
        if (!item) return {issues: [missing(id)]};
        if (!this.accessOf(id).canPublish) return {issues: [notAllowed('publish')]};
        if (this.enforcesBase && opts.base !== item.draftVersion) {
            return {issues: [staleBaseIssue(opts.base, item.draftVersion)]};
        }
        const info: BlueprintPublish = {
            version: item.publishes.length + 1,
            published: Date.now(),
            publishedBy: this.userId,
            ...(opts.note ? {note: opts.note} : {}),
            renames: item.pendingRenames
        };
        item.publishes.push({info, blueprint: clone(item.draft)});
        item.pendingRenames = [];
        item.draftVersion++;
        item.updated = info.published;
        return {publish: clone(info), draftVersion: item.draftVersion, issues: []};
    }

    async listPublishesAsync(id: string): Promise<BlueprintPublish[]> {
        return clone(this.items.get(id)?.publishes.map(it => it.info) ?? []);
    }

    async copyAsync(
        id: string,
        opts: {name: string; from?: BlueprintOpenOptions}
    ): Promise<BlueprintRecord> {
        const from = opts.from ?? {as: 'publish'},
            source = await this.openAsync(id, from);
        if (!source) return null;
        return this.createAsync({
            name: opts.name,
            description: source.description,
            blueprint: source.blueprint,
            copiedFrom: {id, version: source.version, as: source.kind}
        });
    }

    async deleteAsync(id: string): Promise<void> {
        if (!this.isWriter(id)) throw new Error('Only a writer can delete a blueprint.');
        this.items.delete(id);
        [...this.personalizations.keys()]
            .filter(key => key.split('|')[1] === id)
            .forEach(key => this.personalizations.delete(key));
    }

    async loadPersonalizationsAsync(blueprintId: string): Promise<BlueprintPersonalization[]> {
        return clone(
            [...this.personalizations.entries()]
                .filter(([key]) => key.startsWith(`${this.userId}|${blueprintId}|`))
                .map(([, it]) => it)
        );
    }

    async savePersonalizationAsync(p: BlueprintPersonalization): Promise<void> {
        this.personalizations.set(`${this.userId}|${p.blueprintId}|${p.preset ?? ''}`, clone(p));
    }

    async updateAccessAsync(id: string, spec: BlueprintAccessSpec): Promise<void> {
        const item = this.items.get(id);
        if (!item || !this.accessOf(id).canShare)
            throw new Error('You may not share this blueprint.');
        if (spec.readers.includes('*') && !this.canShareGlobally) {
            throw new Error('You may not share this blueprint with everyone.');
        }
        item.sharing = clone(spec);
    }

    //------------------
    // Implementation
    //------------------
    private grantOf(id: string): Grant & {canShareGlobally: boolean} {
        const {access, canPublish, canShare = false} = this.accessOf(id);
        return {access, canPublish, canShare, canShareGlobally: canShare && this.canShareGlobally};
    }

    // A source a copy records must be open to the user, as the version it names. Refused as
    // hoist-core refuses it: 404 if missing or unreadable, 403 if the version needs write, 400 if
    // there is no such version.
    private checkSource({id, version, as}: BlueprintSummary['copiedFrom']) {
        const item = this.items.get(id),
            latest = item?.publishes.at(-1)?.info.version;
        if (!item) throw httpError(404, `Blueprint '${id}' not found`);
        const exists = as === 'draft' ? version <= item.draftVersion : version <= (latest ?? 0);
        if (!exists) throw httpError(400, `'${id}' has no ${as} version ${version}`);
        const needsWrite = as === 'draft' || version !== latest;
        if (needsWrite && !this.isWriter(id)) {
            throw httpError(403, `You may not open that version of '${id}'`);
        }
    }

    private isWriter(id: string): boolean {
        return this.accessOf(id).access === 'write';
    }

    private summaryOf(item: Item): BlueprintSummary {
        return {
            id: item.id,
            type: this.type,
            name: item.name,
            ...(item.description ? {description: item.description} : {}),
            ...(item.owner ? {owner: item.owner} : {}),
            draftVersion: item.draftVersion,
            publishedVersion: item.publishes.at(-1)?.info.version ?? null,
            ...this.grantOf(item.id),
            updated: item.updated,
            updatedBy: item.updatedBy,
            ...(item.copiedFrom ? {copiedFrom: item.copiedFrom} : {}),
            ...(item.sharing && this.accessOf(item.id).canShare ? {sharing: item.sharing} : {})
        };
    }
}

interface Grant {
    access: BlueprintAccess;
    canPublish: boolean;
    canShare?: boolean;
}

interface Item {
    id: string;
    name: string;
    description?: string;
    draft: Blueprint;
    draftVersion: number;
    pendingRenames: BlueprintRename[];
    publishes: {info: BlueprintPublish; blueprint: Blueprint}[];
    owner?: string;
    updated: number;
    updatedBy: string;
    copiedFrom?: BlueprintSummary['copiedFrom'];
    sharing?: BlueprintAccessSpec;
}

function clone<T>(value: T): T {
    return value == null ? value : structuredClone(value);
}

function needsWrite(opts: BlueprintOpenOptions): boolean {
    return opts.as === 'draft' || (opts.as === 'publish' && opts.version != null);
}

function notAllowed(what: string) {
    return {
        code: 'edit.notAllowed',
        severity: 'error' as const,
        path: '',
        message: `You may not ${what}.`
    };
}

function missing(id: string) {
    return {
        code: 'repository.unknown',
        severity: 'error' as const,
        path: '',
        message: `There is no blueprint '${id}'.`
    };
}

function httpError(httpStatus: number, message: string): Error {
    return Object.assign(new Error(message), {httpStatus});
}
