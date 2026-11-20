import {HoistModel} from '@xh/hoist/core';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {isEqual} from 'lodash';
import type {Blueprint, BlueprintAccess, BlueprintIssue} from '../Blueprint';
import type {BlueprintModel} from '../BlueprintModel';
import type {BlueprintRegistry} from '../BlueprintRegistry';
import {
    type BlueprintAccessSpec,
    type BlueprintCreateSpec,
    type BlueprintOpenOptions,
    type BlueprintPublish,
    type BlueprintRecord,
    type BlueprintRename,
    type BlueprintRepository,
    staleBaseIssue
} from './BlueprintRepository';

/** The opened version of a blueprint, without the blueprint, which its model holds. */
export type BlueprintDocument = Omit<BlueprintRecord, 'blueprint'>;

/**
 * A stored blueprint, open in a `BlueprintModel`: opening a version, saving the draft, publishing,
 * copying, sharing and deleting, through the app's {@link BlueprintRepository}, as its records
 * allow. Readers open the latest publish. A draft, an older publish, saving, sharing and deleting
 * are for writers, and publishing for those the repository lets publish.
 */
export class BlueprintDocumentModel extends HoistModel {
    readonly blueprintModel: BlueprintModel;
    readonly repository: BlueprintRepository;
    /** Upgrades a blueprint an older version of the library saved. Default none. */
    readonly migrate: (blueprint: Blueprint) => Blueprint;

    /** The version open, or null. */
    @observableRef accessor document: BlueprintDocument = null;

    /**
     * True once a save or publish of the draft open found another save had landed first. The
     * model keeps its unsaved edits, and saving and publishing are refused until the app reloads
     * the draft with {@link reloadAsync}, discarding them, or saves them as a new blueprint with
     * {@link createAsync}.
     */
    @observable accessor isStale = false;

    // The blueprint model's version when the draft was last opened or saved.
    @observable private accessor savedVersion = 0;
    // The renames the draft held when opened, and where in the history new renames start.
    private openRenames: BlueprintRename[] = [];
    private renamesFrom = 0;
    // Where in the history the last save, or the open, took the draft's renames up to.
    private savedHistoryLength = 0;
    // Saves, publishes and copies run one at a time, in order, so no two write from one base.
    private writes: Promise<unknown> = Promise.resolve();
    // A save asked for while another runs, which later asks join.
    private queuedSave: Promise<BlueprintIssue[]> = null;

    constructor(config: {
        blueprintModel: BlueprintModel;
        repository: BlueprintRepository;
        migrate?: (blueprint: Blueprint) => Blueprint;
    }) {
        super();
        const {blueprintModel, repository, migrate = null} = config;
        throwIf(!repository, 'A BlueprintDocumentModel needs a repository.');
        this.blueprintModel = blueprintModel;
        this.repository = repository;
        this.migrate = migrate;
    }

    /** True if the user may publish the blueprint open, as its repository says. */
    get canPublish(): boolean {
        return this.document?.canPublish === true;
    }

    /** True if the draft open has edits not yet saved. */
    get isDirty(): boolean {
        return this.document?.kind === 'draft' && this.blueprintModel.version !== this.savedVersion;
    }

    /** The renames since the last publish, which the draft keeps until the next. */
    get pendingRenames(): BlueprintRename[] {
        return [
            ...this.openRenames,
            ...standingRenames(this.blueprintModel.history.slice(this.renamesFrom))
        ];
    }

    /**
     * Open a blueprint: its latest publish, in run mode, by default. A draft opens in design mode.
     * A draft, or a publish by number, needs write access, which the repository's record grants.
     */
    async openAsync(
        id: string,
        opts: BlueprintOpenOptions = {as: 'publish'}
    ): Promise<BlueprintIssue[]> {
        const record = await this.repository.openAsync(id, opts);
        if (!record)
            return [refusal(`There is no ${opts.as} of this blueprint that you may open.`)];
        const access: BlueprintAccess = record.access === 'write' ? 'write' : 'read';
        if (needsWrite(opts) && access !== 'write') {
            return [
                refusal(
                    `You have read access only, so you can open the latest publish, not ${opts.as === 'draft' ? 'the draft' : 'an older one'}.`
                )
            ];
        }

        const {blueprintModel} = this,
            blueprint = this.migrate ? this.migrate(record.blueprint) : record.blueprint,
            checked = blueprintModel.validate(blueprint);
        // Checked before the model changes, so a refused blueprint leaves the open one as it was.
        if (checked.some(it => it.severity === 'error')) return checked;
        blueprintModel.setAccess(access);
        blueprintModel.setMode(record.kind === 'draft' ? 'design' : 'run');
        const issues = blueprintModel.setBlueprint(blueprint);
        if (issues.some(it => it.severity === 'error')) return issues;
        this.opened(record, access);
        return issues;
    }

    /**
     * Create a blueprint from the one the model holds, and open its draft. With a blueprint open,
     * as when a stale draft's edits save as new, the new one records it as what it copies. If the
     * repository refuses that source, as for a user who has lost access to it, the blueprint is
     * created without the record, so the edits are not lost.
     */
    async createAsync(name: string, description?: string): Promise<BlueprintIssue[]> {
        if (!(await this.repository.canCreateAsync())) {
            return [refusal('You may not create a blueprint.')];
        }
        const {document, repository} = this,
            spec: BlueprintCreateSpec = {
                name,
                description,
                blueprint: this.withSchema(this.blueprintModel.blueprint ?? {})
            };
        let record: BlueprintRecord;
        try {
            record = await repository.createAsync(
                document
                    ? {
                          ...spec,
                          copiedFrom: {
                              id: document.id,
                              version: document.version,
                              as: document.kind
                          }
                      }
                    : spec
            );
        } catch (e) {
            // The user may have lost access to the source since opening it: keep their edits.
            if (!document || !REFUSED_SOURCE.includes(Number(e?.httpStatus))) throw e;
            record = await repository.createAsync(spec);
        }
        return this.openAsync(record.id, {as: 'draft'});
    }

    /**
     * Save the draft open, if it has unsaved edits. Saves run one at a time: one asked for while
     * another runs waits for it, then saves the blueprint as it is by then, and further asks in
     * the meantime join that one. A repository that does not check the draft's version itself is
     * checked first, which narrows the race between two writers but does not close it.
     */
    saveDraftAsync(): Promise<BlueprintIssue[]> {
        if (this.queuedSave) return this.queuedSave;
        const save = this.inTurnAsync(() => {
            this.queuedSave = null;
            return this.doSaveDraftAsync();
        });
        this.queuedSave = save;
        return save;
    }

    /**
     * Publish the saved draft as the next number, once any save in flight has landed. A draft
     * with unsaved edits saves first.
     */
    publishAsync(note?: string): Promise<BlueprintIssue[]> {
        return this.inTurnAsync(async () => {
            const {document, repository} = this;
            if (document?.kind !== 'draft' || !this.canPublish) {
                return [refusal('You may not publish this blueprint.')];
            }
            if (this.isStale) return [staleRefusal()];
            if (this.isDirty) {
                const issues = await this.doSaveDraftAsync();
                if (issues.some(it => it.severity === 'error')) return issues;
            }
            const stale = await this.staleIssueAsync();
            if (stale) return this.wentStale([stale]);
            const {publish, draftVersion, issues} = await repository.publishAsync(document.id, {
                base: this.document.version,
                note
            });
            if (publish) this.published(publish, draftVersion);
            return this.wentStale(issues);
        });
    }

    /** Open the draft again as it is stored, discarding unsaved edits, as after going stale. */
    reloadAsync(): Promise<BlueprintIssue[]> {
        return this.inTurnAsync(() => {
            const {document} = this;
            throwIf(document?.kind !== 'draft', 'Open a draft to reload it.');
            return this.openAsync(document.id, {as: 'draft'});
        });
    }

    /**
     * Copy the blueprint open into a new one, from its latest publish by default. Copying needs
     * the right to create, and copying a draft, or an older publish, needs write access.
     */
    copyAsync(name: string, from?: BlueprintOpenOptions): Promise<BlueprintRecord> {
        return this.inTurnAsync(async () => {
            const {document} = this;
            throwIf(!document, 'Open a blueprint to copy it.');
            throwIf(
                from && needsWrite(from) && document.access !== 'write',
                'You may copy only the latest publish.'
            );
            throwIf(!(await this.repository.canCreateAsync()), 'You may not create a blueprint.');
            return this.repository.copyAsync(document.id, {name, ...(from ? {from} : {})});
        });
    }

    /** Delete the blueprint open, with its publishes and personalizations. Needs write access. */
    async deleteAsync() {
        const {document} = this;
        throwIf(document?.access !== 'write', 'Only a writer can delete a blueprint.');
        await this.repository.deleteAsync(document.id);
        this.closed();
    }

    /** True if the user may share the blueprint open, as its repository says, and it can share. */
    get canShare(): boolean {
        return this.document?.canShare === true && !!this.repository.updateAccessAsync;
    }

    /** Set who may write and who may read the blueprint open. */
    async updateAccessAsync(spec: BlueprintAccessSpec) {
        throwIf(!this.canShare, 'You may not share this blueprint.');
        await this.repository.updateAccessAsync(this.document.id, spec);
        this.shared(spec);
    }

    //------------------
    // Implementation
    //------------------
    private async doSaveDraftAsync(): Promise<BlueprintIssue[]> {
        const {document, repository} = this;
        if (document?.kind !== 'draft' || document.access !== 'write') {
            return [refusal('Only a writer can save a draft, once one is open.')];
        }
        if (this.isStale) return [staleRefusal()];
        if (!this.isDirty) return [];
        const stale = await this.staleIssueAsync();
        if (stale) return this.wentStale([stale]);
        const {blueprintModel} = this,
            sent = {
                modelVersion: blueprintModel.version,
                historyLength: blueprintModel.history.length,
                renames: this.pendingRenames
            },
            {version, issues} = await repository.saveDraftAsync(document.id, {
                blueprint: this.withSchema(this.blueprintModel.blueprint),
                base: document.version,
                renames: sent.renames
            });
        if (version != null) this.saved(version, sent);
        return this.wentStale(issues);
    }

    // Run a write after those before it, whether they succeeded or failed.
    private inTurnAsync<T>(fn: () => Promise<T>): Promise<T> {
        const ret = this.writes.then(fn, fn);
        this.writes = ret.catch(() => null);
        return ret;
    }

    @action
    private wentStale(issues: BlueprintIssue[]): BlueprintIssue[] {
        if (issues.some(it => it.code === 'edit.staleBase')) this.isStale = true;
        return issues;
    }

    @action
    private opened(record: BlueprintRecord, access: BlueprintAccess) {
        const {blueprint: _bp, ...document} = record;
        this.document = {...document, access, canPublish: record.canPublish === true};
        this.isStale = false;
        this.savedVersion = this.blueprintModel.version;
        this.openRenames = record.pendingRenames ?? [];
        this.renamesFrom = this.savedHistoryLength = this.blueprintModel.history.length;
    }

    @action
    // As of the model version the save sent, so edits made while it ran stay unsaved.
    private saved(
        version: number,
        sent: {modelVersion: number; historyLength: number; renames: BlueprintRename[]}
    ) {
        this.document = {
            ...this.document,
            version,
            draftVersion: version,
            pendingRenames: sent.renames
        };
        this.savedVersion = sent.modelVersion;
        this.savedHistoryLength = sent.historyLength;
    }

    @action
    private published(publish: BlueprintPublish, draftVersion: number) {
        this.document = {
            ...this.document,
            publishedVersion: publish.version,
            pendingRenames: [],
            ...(draftVersion != null ? {version: draftVersion, draftVersion} : {})
        };
        this.openRenames = [];
        // The publish took the renames saved, so those made since the last save stay pending.
        this.renamesFrom = this.savedHistoryLength;
    }

    @action
    private shared(sharing: BlueprintAccessSpec) {
        this.document = {...this.document, sharing};
    }

    @action
    private closed() {
        this.document = null;
        this.blueprintModel.clear();
    }

    // The library's own check, for a repository that cannot check on its server.
    private async staleIssueAsync(): Promise<BlueprintIssue> {
        const {document, repository} = this;
        if (repository.enforcesBase) return null;
        const current = await repository.openAsync(document.id, {as: 'draft'});
        return current && current.version !== document.version
            ? staleBaseIssue(document.version, current.version)
            : null;
    }

    private withSchema(blueprint: Blueprint): Blueprint {
        return {...blueprint, schema: schemaMapOf(blueprint, this.blueprintModel.registry)};
    }
}

/**
 * The versions a blueprint was saved with: the format's, and each widget's it uses. Other
 * entries it already holds stay.
 */
export function schemaMapOf(blueprint: Blueprint, registry: Pick<BlueprintRegistry, 'widgets'>) {
    const widgets = Object.fromEntries(
        Object.values(blueprint.elements ?? {})
            .map(it => registry.widgets[it.component])
            .filter(Boolean)
            .map(it => [it.name, it.version])
    );
    return {...blueprint.schema, blueprint: BLUEPRINT_FORMAT_VERSION, widgets};
}

//------------------
// Implementation
//------------------
const BLUEPRINT_FORMAT_VERSION = 1;

// The statuses with which a repository refuses a create's copiedFrom: missing or unreadable,
// not open at that version, or no such version.
const REFUSED_SOURCE = [404, 403, 400];

function needsWrite(opts: BlueprintOpenOptions): boolean {
    return opts.as === 'draft' || (opts.as === 'publish' && opts.version != null);
}

function staleRefusal(): BlueprintIssue {
    return {
        code: 'edit.staleBase',
        severity: 'error',
        path: '',
        message:
            'Another save landed after you opened this draft. Reload it, or save your edits as a new blueprint.'
    };
}

function refusal(message: string): BlueprintIssue {
    return {code: 'edit.notAllowed', severity: 'error', path: '', message};
}

// The renames that still stand after the edits given: an undo takes back the renames of the edit
// it reverts, and a redo puts them back.
function standingRenames(
    history: {version: number; ops: any[]; undoes?: number; redoes?: number}[]
): BlueprintRename[] {
    const byVersion = new Map<number, BlueprintRename[]>(),
        standing: {version: number; rename: BlueprintRename}[] = [];
    history.forEach(it => {
        if (it.undoes != null) {
            const undone = byVersion.get(it.undoes) ?? [];
            undone.forEach(r => {
                const at = standing.findIndex(s => s.version === it.undoes && isEqual(s.rename, r));
                if (at >= 0) standing.splice(at, 1);
            });
            return;
        }
        const renames =
            it.redoes != null
                ? (byVersion.get(it.redoes) ?? [])
                : it.ops
                      .filter(op => op.op === 'renameId')
                      .map(({kind, from, to}) => ({kind, from, to}));
        byVersion.set(it.version, renames);
        renames.forEach(rename => standing.push({version: it.version, rename}));
    });
    return standing.map(it => it.rename);
}
