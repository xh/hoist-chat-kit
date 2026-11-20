import type {Blueprint, BlueprintAccess, BlueprintIssue, BlueprintOp} from '../Blueprint';

/**
 * Where blueprints persist, as the app implements it: one shared draft per blueprint, numbered
 * publishes that never change, and each user's personalizations. The library defines what a
 * repository must do, and the app decides how, such as with Hoist's JsonBlobs or its own server.
 *
 * - A repository acts for its signed-in user. It lists only the blueprints that user may read, and
 *   its personalization methods reach only that user's personalizations.
 * - It is the only source of access. Each summary and record says what the user may do, and
 *   {@link canCreateAsync} says whether they may create one. Nothing grants access otherwise.
 * - Readers run the latest publish. A draft, and an older publish, are for writers. A server
 *   behind the repository must refuse them to readers, as only a server is a security boundary.
 *   {@link BlueprintDocumentModel} also refuses them. A repository that cannot keep a draft from
 *   readers says so in its own docs.
 * - Saving a draft or publishing takes the draft version it was based on, and refuses a stale one
 *   with `edit.staleBase`. A repository that cannot check this on its server sets `enforcesBase`
 *   false. The library then checks first, which narrows the race but does not close it, and the
 *   repository should read the draft again after it saves, to warn if another save landed in
 *   between.
 * - Each publish takes the next number, created only if absent, so two publishers can never take
 *   the same one.
 * - Deleting a blueprint deletes its publishes and its personalizations. A repository without
 *   referential integrity does this in code, and ignores and cleans up orphans it finds.
 */
export interface BlueprintRepository {
    /**
     * True if the repository refuses a stale `base` itself, atomically on its server. False, and
     * the library reads the draft's version before each save and publish.
     */
    readonly enforcesBase: boolean;

    /** The blueprints the signed-in user may read. The app filters them further as it needs. */
    listAsync(): Promise<BlueprintSummary[]>;

    /** True if the signed-in user may create a blueprint. */
    canCreateAsync(): Promise<boolean>;

    /**
     * Open a blueprint: its draft, its latest publish, or a publish by number. Null if there is
     * none, such as a blueprint never published.
     */
    openAsync(id: string, opts: BlueprintOpenOptions): Promise<BlueprintRecord>;

    /** Create a blueprint, with the blueprint given as its first draft and no publish. */
    createAsync(spec: {
        name: string;
        description?: string;
        blueprint: Blueprint;
    }): Promise<BlueprintRecord>;

    /**
     * Save the draft. Refused with `edit.staleBase` if the draft is no longer at `base`.
     *
     * @param renames - the renames since the last publish, which the draft keeps until the next.
     */
    saveDraftAsync(
        id: string,
        draft: {blueprint: Blueprint; base: number; renames: BlueprintRename[]}
    ): Promise<BlueprintSaveResult>;

    /**
     * Publish the draft as the next number, with the renames the draft holds, which it then
     * clears. Refused with `edit.staleBase` if the draft is no longer at `base`. A publish never
     * changes, and publishing leaves the draft as it is.
     */
    publishAsync(id: string, opts: {base: number; note?: string}): Promise<BlueprintPublishResult>;

    /** Every publish of a blueprint, oldest first. */
    listPublishesAsync(id: string): Promise<BlueprintPublish[]>;

    /**
     * Copy a blueprint into a new one, whose draft is the source's latest publish, or the version
     * given. The copy records where it came from, and has no publish of its own.
     */
    copyAsync(
        id: string,
        opts: {name: string; from?: BlueprintOpenOptions}
    ): Promise<BlueprintRecord>;

    /** Delete a blueprint, with its publishes and every user's personalizations of it. */
    deleteAsync(id: string): Promise<void>;

    /** The signed-in user's personalizations of a blueprint. */
    loadPersonalizationsAsync(blueprintId: string): Promise<BlueprintPersonalization[]>;

    /**
     * Save one of the signed-in user's personalizations, replacing the one for its blueprint and
     * preset.
     */
    savePersonalizationAsync(p: BlueprintPersonalization): Promise<void>;

    /**
     * Set who may write and who may read a blueprint, by the user or role names the repository
     * knows. Optional: the library offers sharing only when a repository implements it.
     */
    updateAccessAsync?(id: string, spec: BlueprintAccessSpec): Promise<void>;
}

/** Who may write and who may read a blueprint. Writers may also read. */
export interface BlueprintAccessSpec {
    writers: string[];
    readers: string[];
}

/** Which version of a blueprint to open: its draft, or a publish, the latest by default. */
export type BlueprintOpenOptions = {as: 'draft'} | {as: 'publish'; version?: number};

/** A blueprint as a repository lists it. */
export interface BlueprintSummary {
    id: string;
    name: string;
    description?: string;
    /** The draft's version: a counter of its saves, which a save's `base` names. */
    draftVersion: number;
    /** The number of the latest publish, or null if there is none. */
    publishedVersion: number;
    /** The signed-in user's access to the blueprint. */
    access: BlueprintAccess;
    /** True if the signed-in user may publish the blueprint. */
    canPublish: boolean;
    /** Epoch millis of the last save or publish. */
    updated: number;
    updatedBy?: string;
    /** The blueprint and version a copy came from. */
    copiedFrom?: {id: string; version: number; as: 'draft' | 'publish'};
}

/** One version of a blueprint, opened. */
export interface BlueprintRecord extends BlueprintSummary {
    blueprint: Blueprint;
    kind: 'draft' | 'publish';
    /** The draft's version for a draft, or the publish's number. */
    version: number;
    /** For a draft, the renames since the last publish. Empty for a publish. */
    pendingRenames: BlueprintRename[];
}

/** A rename of an element, variable or source, which a personalization's paths follow. */
export interface BlueprintRename {
    kind: 'element' | 'variable' | 'source';
    from: string;
    to: string;
}

/** One publish of a blueprint. It never changes. */
export interface BlueprintPublish {
    version: number;
    /** Epoch millis. */
    published: number;
    publishedBy?: string;
    note?: string;
    /** The renames since the publish before, in order. */
    renames: BlueprintRename[];
}

/** One user's changes to the personalizable paths of a blueprint, for one preset. */
export interface BlueprintPersonalization {
    blueprintId: string;
    /** The preset, as `group:item`, or null for paths that no preset controls. */
    preset: string;
    /** `set` and `remove` operations only. */
    ops: BlueprintOp[];
    /** The publish the operations were made against. */
    publishVersion: number;
}

export interface BlueprintSaveResult {
    /** The draft's new version, if the save applied. */
    version?: number;
    issues: BlueprintIssue[];
}

export interface BlueprintPublishResult {
    /** The new publish, if it applied. */
    publish?: BlueprintPublish;
    issues: BlueprintIssue[];
}

/** The issue a repository returns for a save or publish based on a draft version no longer current. */
export function staleBaseIssue(base: number, current: number): BlueprintIssue {
    return {
        code: 'edit.staleBase',
        severity: 'error',
        path: '',
        message: `The draft is at version ${current}, but this was based on version ${base}. Open it again.`
    };
}
