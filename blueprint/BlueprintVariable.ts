import {HoistBase} from '@xh/hoist/core';
import type {FilterSpec} from '@xh/hoist/data';
import {action, computed, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {isArray, isEqual, isPlainObject, isString} from 'lodash';
import type {ElementWriter, ResolverCall, VariableDecl} from './Blueprint';
import {andFilters} from './impl/bindings';

/** What can set a variable, as its `setBy` names it. */
export interface BlueprintVariableWriter {
    kind: 'prompt' | 'resolver' | 'action' | 'element' | 'output';
    element?: string;
    output?: string;
    field?: string;
}

/** The parts of a blueprint's runtime a variable reads. */
export interface BlueprintVariableContext {
    runResolver(call: ResolverCall): unknown;
}

/**
 * A blueprint variable at runtime: its declaration, what can set it, and its current value. The
 * value is transient. It holds the default until a writer sets it, and a variable set by a
 * resolver computes it again whenever the resolver's inputs change.
 */
export class BlueprintVariable extends HoistBase {
    readonly name: string;
    readonly decl: VariableDecl;
    readonly writers: BlueprintVariableWriter[];

    /** The value a prompt, action or widget set, or undefined while the default applies. */
    @observableRef private accessor setValue: unknown = undefined;

    /** The latest value from each output that writes this variable, by writer index. */
    @observableRef private accessor outputValues: unknown[] = [];

    private readonly context: BlueprintVariableContext;

    constructor(name: string, decl: VariableDecl, context: BlueprintVariableContext) {
        super();
        this.name = name;
        this.decl = decl;
        this.context = context;
        this.writers = parseWriters(decl);
    }

    /** The current value. */
    @computed
    get value(): unknown {
        const {decl} = this;
        if (decl.setBy === 'resolver') return this.context.runResolver(decl.compute);
        if (this.hasOutputs) {
            const values = this.outputValues.filter(it => it != null);
            if (values.length) {
                return decl.type === 'filter' ? andFilters(values as FilterSpec[]) : values[0];
            }
        } else if (this.setValue !== undefined) {
            return this.setValue;
        }
        return this.defaultValue;
    }

    /** True once a writer has set the value, so the default no longer applies. */
    get isSet(): boolean {
        return this.hasOutputs
            ? this.outputValues.some(it => it != null)
            : this.setValue !== undefined;
    }

    /** True if nothing can set the variable, so it always holds its default. */
    get isConstant(): boolean {
        return this.decl.setBy == null;
    }

    /** True if a prompt, an action, URL parameters or the Architect may set the variable. */
    get isSettable(): boolean {
        const {writers} = this;
        return writers.length === 1 && ['prompt', 'action', 'element'].includes(writers[0].kind);
    }

    /** The value from the declared default. */
    @computed
    get defaultValue(): unknown {
        const def = this.decl.default;
        if (!def) return null;
        return 'value' in def ? def.value : this.context.runResolver(def);
    }

    /** Set the value, as a prompt, an action or a widget that shows it. */
    @action
    set(value: unknown) {
        throwIf(!this.isSettable, `Variable '${this.name}' cannot be set directly.`);
        this.setValue = value;
    }

    /** Restore the default. */
    @action
    reset() {
        this.setValue = undefined;
        this.outputValues = [];
    }

    /** Take the value of the output at a writer index. */
    @action
    setOutputValue(writerIdx: number, value: unknown) {
        if (isEqual(this.outputValues[writerIdx] ?? null, value ?? null)) return;
        const next = [...this.outputValues];
        next[writerIdx] = value ?? null;
        this.outputValues = next;
    }

    private get hasOutputs(): boolean {
        return this.writers.some(it => it.kind === 'output');
    }
}

function parseWriters(decl: VariableDecl): BlueprintVariableWriter[] {
    const {setBy} = decl;
    if (setBy == null) return [];
    if (isString(setBy)) return [{kind: setBy}];
    const elements: ElementWriter[] = isArray(setBy) ? setBy : isPlainObject(setBy) ? [setBy] : [];
    return elements.map(it => ({kind: it.output ? 'output' : 'element', ...it}));
}
