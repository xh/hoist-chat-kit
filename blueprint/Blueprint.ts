import type {PlainObject} from '@xh/hoist/core';

/**
 * A Hoist Blueprint: a plain JSON document that defines a UI. Elements, variables and sources
 * each sit in a flat map keyed by ID, and `root` names the top element.
 */
export interface Blueprint {
    schema?: BlueprintSchemaVersions;
    formats?: Record<string, PlainObject>;
    variables?: Record<string, VariableDecl>;
    sources?: Record<string, SourceDecl>;
    presets?: Record<string, PresetGroup>;
    root?: string;
    elements?: Record<string, BlueprintElement>;
}

/** Versions of the format and of each registry entry a blueprint uses. */
export interface BlueprintSchemaVersions {
    blueprint: number;
    widgets?: Record<string, number>;
    variableTypes?: Record<string, number>;
    resolvers?: Record<string, number>;
}

/** A container or widget. A container also has `children`. */
export interface BlueprintElement {
    component: string;
    config?: PlainObject;
    children?: ChildRef[];
    personalizable?: string[];
}

/** A child's ID, plus whatever its container needs to place it, such as `x`, `y`, `w` and `h`. */
export interface ChildRef {
    id: string;
    [key: string]: unknown;
}

/** A value that reads a variable. */
export interface VarBinding {
    $var: string;
}

export interface VariableDecl {
    /** A Hoist field type, an app variable type, a list of either as `type[]`, or `filter`. */
    type: string;
    label?: string;
    description?: string;
    setBy?: VariableSetBy;
    default?: VariableDefault;
    /** The resolver that computes the value, for `setBy: "resolver"`. */
    compute?: ResolverCall;
    options?: VariableOptions;
}

export type VariableSetBy = 'prompt' | 'resolver' | 'action' | ElementWriter | ElementWriter[];

/** A widget that sets a variable: its shown value, or one of its outputs. */
export interface ElementWriter {
    element: string;
    output?: string;
    field?: string;
}

export type VariableDefault = ({value: unknown} | ResolverCall) & {personalizable?: boolean};

export interface ResolverCall {
    resolver: string;
    args?: PlainObject;
}

export type VariableOptions = {values: unknown[]} | {dataset: string; field: string};

/** A dataset, artifact or inline source. Exactly one of the three keys is set. */
export interface SourceDecl {
    dataset?: string;
    params?: PlainObject;
    /** Instances of parameterized fields, keyed by the name widgets use for them. */
    fields?: Record<string, FieldInstance>;
    filter?: PlainObject;
    artifact?: string;
    inline?: {fields: PlainObject[]; rows: PlainObject[]};
}

export interface FieldInstance {
    field: string;
    params?: PlainObject;
    /** The instance's label. Default the field's label and its parameter values. */
    label?: string;
}

export interface PresetGroup {
    label?: string;
    controls: {path: string; personalizable?: boolean}[];
    default?: string;
    items?: Record<string, {label?: string; set: PlainObject}>;
}

/** One problem found in a blueprint or an edit. */
export interface BlueprintIssue {
    /** Stable ID, named by area, such as `variable.unknown`. Match on this, never the message. */
    code: string;
    severity: 'error' | 'warning';
    /** JSON Pointer into the blueprint as it would be after the edit. */
    path: string;
    message: string;
    /** Index of the operation in the edit that caused the issue, when one did. */
    op?: number;
    /** Operations that resolve the issue, when the fix is mechanical. */
    fix?: BlueprintOp[];
}

/** One operation of an edit. Paths are JSON Pointers, and never index into an array. */
export type BlueprintOp =
    | {op: 'set'; path: string; value: unknown}
    | {op: 'remove'; path: string}
    | {
          op: 'addElement';
          id: string;
          element: BlueprintElement;
          parent?: string;
          child?: PlainObject;
          index?: number;
      }
    | {op: 'removeElement'; id: string}
    | {op: 'moveElement'; id: string; parent: string; child?: PlainObject; index?: number}
    | {op: 'renameId'; kind: 'element' | 'variable' | 'source'; from: string; to: string};

/** A list of operations that apply as one, or not at all. */
export interface BlueprintEdit {
    /** The version the edit was written against. */
    base?: number;
    description?: string;
    /** Who made the edit, such as `user` for an interaction in a widget, or `architect`. */
    author?: string;
    ops: BlueprintOp[];
}

/** True if a value is a `{"$var": name}` binding. */
export function isVarBinding(v: unknown): v is VarBinding {
    return v != null && typeof v === 'object' && typeof (v as PlainObject).$var === 'string';
}

/** Run mode runs the published blueprint. Design mode edits its definition. */
export type BlueprintMode = 'run' | 'design';

/** Whether the user can change the blueprint's definition. */
export type BlueprintAccess = 'read' | 'write';
