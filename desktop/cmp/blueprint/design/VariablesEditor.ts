import {div, filler, hbox, placeholder} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {select, textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {castArray, isEmpty, isString, omit} from 'lodash';
import {
    BUILT_IN_VARIABLE_TYPES,
    type BlueprintDesignModel,
    type EditorNode,
    type ElementWriter,
    type ResolverCall,
    toEditorSpec,
    type VariableDecl
} from '../../../../blueprint';
import './ElementInspector.scss';
import {ConfigEditorModel} from './impl/ConfigEditorModel';
import {
    CLS,
    issueRows,
    labelled,
    nodeOf,
    type Option,
    propertyRow,
    type RowProps
} from './impl/ConfigEditors';

export interface VariablesEditorProps extends HoistProps {
    designModel: BlueprintDesignModel;
}

/**
 * The blueprint's variables: a list to select one, add one or remove one, and the selected one's
 * declaration - its name, type, label, who sets it, its default and its options. Each change is
 * one edit. Its selection is the design model's.
 */
export const [VariablesEditor, variablesEditor] = hoistCmp.withFactory<VariablesEditorProps>({
    displayName: 'BlueprintVariablesEditor',
    className: 'xh-blueprint-element-inspector xh-blueprint-variables-editor',
    model: false,
    render({designModel, className}) {
        const impl = useLocalModel(() => new VariableEditorModel(designModel));
        return variablesBody({model: impl, className});
    }
});

/** @internal */
export class VariableEditorModel extends ConfigEditorModel {
    /** The selected variable's name, or null. */
    get name(): string {
        const {selection, blueprintModel} = this.designModel;
        return selection?.kind === 'variable' &&
            Object.hasOwn(blueprintModel.blueprint?.variables ?? {}, selection.id)
            ? selection.id
            : null;
    }

    /** The declaration as it shows, with any default that the active preset sets. */
    get values(): VariableDecl {
        return this.name ? this.designModel.blueprintModel.effective.variables[this.name] : null;
    }

    get sourceName(): string {
        return null;
    }

    get variableOptions(): Option[] {
        return Object.keys(this.designModel.blueprintModel.blueprint?.variables ?? {}).map(it => ({
            value: it,
            label: it
        }));
    }

    /** The plain properties of a declaration, generated as a widget's config is. */
    get nodes(): EditorNode[] {
        return toEditorSpec({
            type: 'object',
            required: ['type'],
            properties: {
                type: {enum: this.typeOptions},
                label: {type: 'string', maxLength: 100},
                description: {type: 'string', maxLength: 500}
            }
        });
    }

    /** The built-in types, the app's types, and a list of each but `filter`. */
    get typeOptions(): string[] {
        const types = [
            ...BUILT_IN_VARIABLE_TYPES,
            ...Object.keys(this.designModel.blueprintModel.registry.variableTypes)
        ];
        return [...types, ...types.filter(it => it !== 'filter').map(it => `${it}[]`)];
    }

    /** Each widget value and output a variable can be set by. */
    get writerOptions(): Option[] {
        const {blueprint, registry} = this.designModel.blueprintModel;
        return Object.entries(blueprint?.elements ?? {}).flatMap(([element, el]) => {
            const spec = registry.widgets[el.component];
            return [
                ...(spec?.value ? [{element}] : []),
                ...(spec?.outputs ?? []).map(it => ({element, output: it.name}))
            ].map(it => ({value: writerKey(it), label: writerLabel(it)}));
        });
    }

    /** True if a writer is an output that sets the value of a field it names, as `selected` does. */
    needsField(writer: ElementWriter): boolean {
        const {blueprint, registry} = this.designModel.blueprintModel,
            spec = registry.widgets[blueprint?.elements?.[writer.element]?.component];
        return spec?.outputs?.find(it => it.name === writer.output)?.type === 'field';
    }

    /** The fields of a writer's element's source, for an output that names one. */
    writerFieldOptions(element: string): Option[] {
        const {blueprintModel} = this.designModel,
            source = blueprintModel.getSource(
                blueprintModel.blueprint?.elements?.[element]?.config?.source
            );
        return Object.keys(source?.fields ?? {}).map(it => ({
            value: it,
            label: source.fieldLabel(it)
        }));
    }

    /** Who sets the variable: no one, the user, a resolver, an action, or widgets. */
    get setByKind(): SetByKind {
        const setBy = this.values?.setBy;
        if (setBy == null) return 'none';
        return isString(setBy) ? (setBy as SetByKind) : 'widgets';
    }

    /** Switch who sets the variable, with what that needs, in one edit. */
    setSetByKind(kind: SetByKind) {
        if (kind === this.setByKind) return;
        const first = this.writerOptions[0],
            setBy =
                kind === 'none' ? undefined : kind === 'widgets' ? parseWriter(first?.value) : kind,
            compute =
                kind === 'resolver'
                    ? (this.values.compute ?? {resolver: this.resolverOptions[0]?.value})
                    : undefined;
        this.update('setBy', {setBy, compute});
    }

    get resolverOptions(): Option[] {
        return Object.keys(this.designModel.blueprintModel.registry.resolvers).map(it => ({
            value: it,
            label: it
        }));
    }

    /** Each argument a resolver takes, with its description. */
    resolverArgs(name: string): Record<string, string> {
        return this.designModel.blueprintModel.registry.resolvers[name]?.args ?? {};
    }

    get datasetOptions(): Option[] {
        return this.designModel.blueprintModel.catalogs.flatMap(it =>
            Object.keys(it.datasets).map(name => ({value: name, label: name}))
        );
    }

    datasetFieldOptions(dataset: string): Option[] {
        const ds = this.designModel.blueprintModel.catalogs
            .map(it => it.getDataset(dataset))
            .find(Boolean);
        return Object.values(ds?.fields ?? {}).map(it => ({
            value: it.name,
            label: it.label ?? it.name
        }));
    }

    add() {
        this.designModel.addVariable();
    }

    rename(to: string) {
        const {name} = this;
        if (!to || to === name) return;
        const errors = this.designModel
            .renameId('variable', name, to)
            .issues.filter(it => it.severity === 'error');
        if (errors.length) this.refuseWith('name', errors);
    }

    remove() {
        const errors = this.designModel
            .removeVariable(this.name)
            .issues.filter(it => it.severity === 'error');
        if (errors.length) this.refuseWith(VARIABLE_KEY, errors);
    }

    /** Set keys of the declaration together, as one edit, with refusals shown under `key`. */
    update(key: string, changes: PlainObject) {
        const errors = this.designModel
            .updateVariableDecl(this.name, changes)
            .issues.filter(it => it.severity === 'error');
        if (errors.length) {
            this.refuseWith(key, errors);
        } else {
            this.refusal = null;
        }
    }

    protected pathOf(key: string): string {
        return `/variables/${this.name}/${key}`;
    }

    protected write(key: string, value: unknown) {
        return this.designModel.setVariableDecl(this.name, key, value);
    }
}

//------------------
// Implementation
//------------------
type SetByKind = 'none' | 'prompt' | 'resolver' | 'action' | 'widgets';

// The key a refusal of the variable itself, such as its removal, goes under.
const VARIABLE_KEY = '';

const SET_BY_OPTIONS: Option[] = [
    {value: 'none', label: 'No one'},
    {value: 'prompt', label: 'The user'},
    {value: 'resolver', label: 'A resolver'},
    {value: 'action', label: 'Actions'},
    {value: 'widgets', label: 'Widgets'}
];

const variablesBody = hoistCmp.factory<VariableEditorModel>({
    model: uses(VariableEditorModel),
    render({model: impl, className}) {
        const {name, readOnly: disabled} = impl;
        return div({
            className,
            children: [
                hbox({
                    className: `${CLS}__header`,
                    children: [
                        select({
                            value: name,
                            options: impl.variableOptions,
                            placeholder: 'Select a variable…',
                            flex: 1,
                            onCommit: (id: string) =>
                                id && impl.designModel.select({kind: 'variable', id})
                        }),
                        filler(),
                        button({
                            icon: Icon.add(),
                            title: 'Add a variable',
                            minimal: true,
                            disabled,
                            onClick: () => impl.add()
                        }),
                        button({
                            icon: Icon.delete(),
                            title: name ? `Remove ${name}` : 'Remove',
                            minimal: true,
                            disabled: disabled || !name,
                            onClick: () => impl.remove()
                        })
                    ]
                }),
                ...issueRows(impl, VARIABLE_KEY),
                ...(name ? declaration(impl) : [placeholder('Select a variable to edit it.')])
            ]
        });
    }
});

function declaration(impl: VariableEditorModel) {
    const decl = impl.values,
        ctx = {impl, key: null},
        row = (props: Omit<RowProps, 'ctx'>) =>
            propertyRow({...props, ctx: {impl, key: props.node.key}});
    return [
        labelled(
            'Name',
            textInput({
                key: `${impl.name}:${impl.resets.name ?? 0}`,
                value: impl.name,
                disabled: impl.readOnly,
                width: '100%',
                onCommit: (to: string) => impl.rename(to)
            }),
            impl.issuesFor('name')
        ),
        ...impl.nodes.map(node =>
            row({
                key: `${node.key}:${impl.resets[node.key] ?? 0}`,
                node,
                value: decl[node.key],
                commit: v => impl.commit(node.key, v),
                issues: impl.issuesFor(node.key)
            })
        ),
        labelled('Set by', setByEditor(impl), impl.issuesFor('setBy')),
        impl.setByKind === 'resolver'
            ? labelled(
                  'Compute',
                  resolverCallEditor(decl.compute, it => impl.commit('compute', it), impl, ctx),
                  impl.issuesFor('compute')
              )
            : null,
        labelled(
            'Default',
            defaultEditor(impl),
            impl.issuesFor('default'),
            impl.badgeFor('default')
        ),
        labelled('Options', optionsEditor(impl), impl.issuesFor('options'))
    ];
}

function setByEditor(impl: VariableEditorModel) {
    const {readOnly: disabled} = impl,
        kind = impl.setByKind,
        writers = kind === 'widgets' ? castArray(impl.values.setBy as ElementWriter[]) : [],
        commitWriters = (list: ElementWriter[]) =>
            impl.commit('setBy', list.length === 1 ? list[0] : list);
    return div({
        className: `${CLS}__list`,
        children: [
            select({
                value: kind,
                options: SET_BY_OPTIONS,
                disabled,
                width: '100%',
                onCommit: (it: SetByKind) => impl.setSetByKind(it)
            }),
            ...writers.map((writer, i) =>
                hbox({
                    key: `${i}:${writerKey(writer)}`,
                    className: `${CLS}__tab`,
                    children: [
                        select({
                            value: writerKey(writer),
                            options: withOption(impl.writerOptions, writer),
                            disabled,
                            flex: 1,
                            onCommit: (it: string) =>
                                commitWriters(
                                    writers.map((w, j) => (j === i ? parseWriter(it) : w))
                                )
                        }),
                        impl.needsField(writer)
                            ? select({
                                  value: writer.field ?? null,
                                  options: impl.writerFieldOptions(writer.element),
                                  placeholder: 'Field…',
                                  disabled,
                                  flex: 1,
                                  onCommit: (field: string) =>
                                      commitWriters(
                                          writers.map((w, j) => (j === i ? {...w, field} : w))
                                      )
                              })
                            : null,
                        button({
                            icon: Icon.delete(),
                            title: 'Remove',
                            minimal: true,
                            disabled: disabled || writers.length === 1,
                            onClick: () => commitWriters(writers.filter((_, j) => j !== i))
                        })
                    ]
                })
            ),
            kind === 'widgets'
                ? button({
                      icon: Icon.add(),
                      text: 'Add a widget',
                      minimal: true,
                      disabled,
                      onClick: () => {
                          const taken = writers.map(writerKey),
                              next = impl.writerOptions.find(it => !taken.includes(it.value));
                          if (next) commitWriters([...writers, parseWriter(next.value)]);
                      }
                  })
                : null
        ]
    });
}

// A default of a literal value, or a resolver's, which a user may personalize.
function defaultEditor(impl: VariableEditorModel) {
    const dflt = (impl.values.default ?? null) as PlainObject,
        kind = dflt == null ? 'none' : 'resolver' in dflt ? 'resolver' : 'value',
        personalizable = dflt?.personalizable ? {personalizable: true} : {},
        commit = (it: unknown) => impl.commit('default', it),
        valueNode = nodeOf('value', impl.valueSchema(impl.values.type));
    return div({
        className: `${CLS}__list`,
        children: [
            select({
                value: kind,
                options: [
                    {value: 'none', label: 'None'},
                    {value: 'value', label: 'A value'},
                    {value: 'resolver', label: 'A resolver'}
                ],
                disabled: impl.readOnly,
                width: '100%',
                onCommit: (it: string) =>
                    it !== kind &&
                    commit(
                        it === 'none'
                            ? undefined
                            : it === 'value'
                              ? {value: impl.newValue(valueNode.schema) ?? null, ...personalizable}
                              : {resolver: impl.resolverOptions[0]?.value, ...personalizable}
                    )
            }),
            kind === 'value'
                ? propertyRow({
                      key: 'value',
                      node: valueNode,
                      value: dflt.value,
                      commit: v => commit({...dflt, value: v ?? null}),
                      ctx: {impl, key: 'default'}
                  })
                : null,
            kind === 'resolver'
                ? resolverCallEditor(
                      omit(dflt, 'personalizable') as ResolverCall,
                      it => commit({...it, ...personalizable}),
                      impl,
                      {impl, key: 'default'}
                  )
                : null,
            kind !== 'none'
                ? propertyRow({
                      key: 'personalizable',
                      node: PERSONALIZABLE_NODE,
                      value: !!dflt.personalizable,
                      commit: v =>
                          commit(
                              v ? {...dflt, personalizable: true} : omit(dflt, 'personalizable')
                          ),
                      ctx: {impl, key: 'default'}
                  })
                : null
        ]
    });
}

// The values a variable may take: a list, or a dataset field's values.
function optionsEditor(impl: VariableEditorModel) {
    const options = (impl.values.options ?? null) as PlainObject,
        kind = options == null ? 'none' : 'dataset' in options ? 'dataset' : 'values',
        commit = (it: unknown) => impl.commit('options', it),
        disabled = impl.readOnly,
        listNode = nodeOf('values', {type: 'array', items: impl.valueSchema(impl.values.type)});
    return div({
        className: `${CLS}__list`,
        children: [
            select({
                value: kind,
                options: [
                    {value: 'none', label: 'Any value'},
                    {value: 'values', label: 'A list'},
                    {value: 'dataset', label: "A dataset field's values"}
                ],
                disabled,
                width: '100%',
                onCommit: (it: string) =>
                    it !== kind &&
                    commit(
                        it === 'none'
                            ? undefined
                            : it === 'values'
                              ? {values: []}
                              : {dataset: impl.datasetOptions[0]?.value, field: null}
                    )
            }),
            kind === 'values'
                ? propertyRow({
                      key: 'values',
                      node: listNode,
                      value: options.values,
                      commit: v => commit({values: v ?? []}),
                      ctx: {impl, key: 'options'}
                  })
                : null,
            kind === 'dataset'
                ? hbox({
                      className: `${CLS}__tab`,
                      children: [
                          select({
                              value: options.dataset,
                              options: impl.datasetOptions,
                              disabled,
                              flex: 1,
                              onCommit: (dataset: string) => commit({dataset, field: null})
                          }),
                          select({
                              value: options.field,
                              options: impl.datasetFieldOptions(options.dataset),
                              placeholder: 'Field…',
                              disabled,
                              flex: 1,
                              onCommit: (field: string) => commit({...options, field})
                          })
                      ]
                  })
                : null
        ]
    });
}

// A resolver and its arguments, each a literal or a variable.
function resolverCallEditor(
    call: ResolverCall,
    commit: (call: ResolverCall) => void,
    impl: VariableEditorModel,
    ctx: {impl: VariableEditorModel; key: string}
) {
    const args = call?.args ?? {};
    return div({
        className: `${CLS}__group`,
        children: [
            select({
                value: call?.resolver ?? null,
                options: impl.resolverOptions,
                disabled: impl.readOnly,
                width: '100%',
                onCommit: (resolver: string) => resolver !== call?.resolver && commit({resolver})
            }),
            ...Object.entries(impl.resolverArgs(call?.resolver)).map(([arg, description]) =>
                propertyRow({
                    key: arg,
                    node: argNode(arg, description),
                    value: args[arg],
                    commit: v => {
                        const next = v === undefined ? omit(args, arg) : {...args, [arg]: v};
                        commit({resolver: call.resolver, ...(isEmpty(next) ? {} : {args: next})});
                    },
                    ctx
                })
            )
        ]
    });
}

// An argument a resolver takes, whose type its spec does not give: text, a number, or a variable.
function argNode(arg: string, description: string): EditorNode {
    return {
        ...nodeOf(arg, {anyOf: [{type: 'string'}, {type: 'number'}], description}),
        bindable: true
    };
}

const PERSONALIZABLE_NODE = nodeOf('personalizable', {
    type: 'boolean',
    description: 'Let each user keep their own default.'
});

function writerKey(writer: ElementWriter): string {
    return JSON.stringify({
        element: writer.element,
        ...(writer.output ? {output: writer.output} : {})
    });
}

function writerLabel(writer: ElementWriter): string {
    return writer.output ? `${writer.element} › ${writer.output}` : writer.element;
}

function parseWriter(key: string): ElementWriter {
    return key ? JSON.parse(key) : undefined;
}

// The options, plus the writer given if they lack it, so a select still shows it.
function withOption(options: Option[], writer: ElementWriter): Option[] {
    const key = writerKey(writer);
    return options.some(it => it.value === key)
        ? options
        : [...options, {value: key, label: writerLabel(writer)}];
}
