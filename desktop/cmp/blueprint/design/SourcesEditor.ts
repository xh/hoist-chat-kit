import {div, filler, hbox, placeholder} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, useLocalModel, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {select, textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {isEmpty, omit, pickBy} from 'lodash';
import {
    type BlueprintDesignModel,
    FIELD_OVERRIDE_SCHEMA,
    type FieldInstance,
    isFieldInstance,
    type SourceDecl,
    variableTypeMatches
} from '../../../../blueprint';
import './ElementInspector.scss';
import {ConfigEditorModel} from './impl/ConfigEditorModel';
import {CLS, issueRows, labelled, nodeOf, type Option, propertyRow} from './impl/ConfigEditors';

export interface SourcesEditorProps extends HoistProps {
    designModel: BlueprintDesignModel;
}

/**
 * The blueprint's sources: a list to select one, add one or remove one, and the selected one's
 * declaration - its name, dataset, parameters, filter, how its fields show, and instances of its
 * parameterized fields. Each change is one edit. Its selection is the design model's.
 */
export const [SourcesEditor, sourcesEditor] = hoistCmp.withFactory<SourcesEditorProps>({
    displayName: 'BlueprintSourcesEditor',
    className: 'xh-blueprint-element-inspector xh-blueprint-sources-editor',
    model: false,
    render({designModel, className}) {
        const impl = useLocalModel(() => new SourceEditorModel(designModel));
        return sourcesBody({model: impl, className});
    }
});

/** @internal */
export class SourceEditorModel extends ConfigEditorModel {
    /** The selected source's name, or null. */
    get name(): string {
        const {selection, blueprintModel} = this.designModel;
        return selection?.kind === 'source' &&
            Object.hasOwn(blueprintModel.blueprint?.sources ?? {}, selection.id)
            ? selection.id
            : null;
    }

    get values(): SourceDecl {
        return this.name ? this.designModel.blueprintModel.blueprint.sources[this.name] : null;
    }

    get sourceName(): string {
        return this.name;
    }

    get datasetOptions(): Option[] {
        return this.designModel.blueprintModel.catalogs.flatMap(it =>
            Object.keys(it.datasets).map(name => ({value: name, label: name}))
        );
    }

    /** The parameters of the source's dataset. */
    get params(): [string, {type: string; required?: boolean; description?: string}][] {
        return Object.entries(this.dataset?.params ?? {});
    }

    /** The variables a parameter of a type can bind. */
    paramVariables(type: string): string[] {
        const {blueprint, registry} = this.designModel.blueprintModel;
        return Object.entries(blueprint?.variables ?? {})
            .filter(([, it]) => variableTypeMatches(registry, it.type, type))
            .map(([name]) => name);
    }

    /** The dataset's fields that take parameters, of which a source can make instances. */
    get parameterizedFields(): Option[] {
        return Object.values(this.dataset?.fields ?? {})
            .filter(it => it.params)
            .map(it => ({value: it.name, label: it.label ?? it.name}));
    }

    /** The parameters a field of the dataset takes. */
    fieldParams(field: string): [string, {type: string; description?: string}][] {
        return Object.entries(this.dataset?.fields?.[field]?.params ?? {});
    }

    /** Add a source over the first dataset whose required parameters variables can take. */
    add() {
        for (const {value} of this.datasetOptions) {
            if (!this.designModel.addSource(value).issues.some(it => it.severity === 'error')) {
                return;
            }
        }
        this.refuse(SOURCE_KEY, 'Add a variable each dataset parameter can take first.');
    }

    rename(to: string) {
        const {name} = this;
        if (!to || to === name) return;
        this.refuseOn('name', this.designModel.renameId('source', name, to));
    }

    remove() {
        this.refuseOn(SOURCE_KEY, this.designModel.removeSource(this.name));
    }

    setDataset(dataset: string) {
        if (dataset === this.values.dataset) return;
        this.refuseOn('dataset', this.designModel.changeSourceDataset(this.name, dataset));
    }

    /** Add an instance of a parameterized field, named for it, with parameters to start from. */
    addInstance(field: string) {
        const fields = this.values.fields ?? {};
        let n = 1;
        while (Object.hasOwn(fields, `${field}${n}`)) n++;
        const params = Object.fromEntries(
            this.fieldParams(field).map(([pn, pd]) => [
                pn,
                this.newValue(this.valueSchema(pd.type))
            ])
        );
        this.commit('fields', {
            ...fields,
            [`${field}${n}`]: {field, ...(isEmpty(params) ? {} : {params})}
        });
    }

    protected pathOf(key: string): string {
        return `/sources/${this.name}/${key}`;
    }

    protected write(key: string, value: unknown) {
        return this.designModel.setSourceDecl(this.name, key, value);
    }

    private refuseOn(key: string, result: {issues: {severity: string}[]}) {
        const errors = result.issues.filter(it => it.severity === 'error');
        if (errors.length) this.refuseWith(key, errors as any);
    }

    private get dataset() {
        const name = this.values?.dataset;
        return name
            ? this.designModel.blueprintModel.catalogs.map(it => it.getDataset(name)).find(Boolean)
            : null;
    }
}

//------------------
// Implementation
//------------------
// The key a refusal of the source itself, such as its removal, goes under.
const SOURCE_KEY = '';

const FILTER_NODE = nodeOf('filter', {'x-filter': true, type: 'object'}),
    OVERRIDES_NODE = nodeOf('fields', {
        type: 'object',
        'x-field': 'any',
        additionalProperties: FIELD_OVERRIDE_SCHEMA
    });

const sourcesBody = hoistCmp.factory<SourceEditorModel>({
    model: uses(SourceEditorModel),
    render({model: impl, className}) {
        const {name, readOnly: disabled} = impl;
        return div({
            className,
            items: [
                hbox({
                    className: `${CLS}__header`,
                    items: [
                        select({
                            value: name,
                            options: impl.sourceOptions,
                            placeholder: 'Select a source…',
                            flex: 1,
                            onCommit: (id: string) =>
                                id && impl.designModel.select({kind: 'source', id})
                        }),
                        filler(),
                        button({
                            icon: Icon.add(),
                            title: 'Add a source',
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
                ...issueRows(impl, SOURCE_KEY),
                ...(name ? declaration(impl) : [placeholder('Select a source to edit it.')])
            ]
        });
    }
});

function declaration(impl: SourceEditorModel) {
    const decl = impl.values,
        disabled = impl.readOnly,
        fields: PlainObject = decl.fields ?? {},
        overrides = pickBy(fields, it => !isFieldInstance(it)),
        instances = pickBy(fields, isFieldInstance) as Record<string, FieldInstance>,
        commitFields = (next: PlainObject) =>
            impl.commit('fields', isEmpty(next) ? undefined : next);
    return [
        labelled(
            'Name',
            textInput({
                key: `${impl.name}:${impl.resets.name ?? 0}`,
                value: impl.name,
                disabled,
                width: '100%',
                onCommit: (to: string) => impl.rename(to)
            }),
            impl.issuesFor('name')
        ),
        labelled(
            'Dataset',
            select({
                key: `${impl.name}:${impl.resets.dataset ?? 0}`,
                value: decl.dataset ?? null,
                options: impl.datasetOptions,
                disabled,
                width: '100%',
                onCommit: (it: string) => impl.setDataset(it)
            }),
            impl.issuesFor('dataset')
        ),
        labelled(
            'Parameters',
            div({
                className: `${CLS}__group`,
                items: impl.params.map(([pn, pd]) =>
                    labelled(
                        pd.required ? `${pn} *` : pn,
                        select({
                            value: (decl.params?.[pn] as PlainObject)?.$var ?? null,
                            options: impl.paramVariables(pd.type),
                            enableClear: !pd.required,
                            placeholder: `A ${pd.type} variable…`,
                            disabled,
                            width: '100%',
                            onCommit: (v: string) => {
                                const next = v
                                    ? {...decl.params, [pn]: {$var: v}}
                                    : omit(decl.params, pn);
                                impl.commit('params', isEmpty(next) ? undefined : next);
                            }
                        })
                    )
                )
            }),
            impl.issuesFor('params')
        ),
        propertyRow({
            key: `filter:${impl.resets.filter ?? 0}`,
            node: FILTER_NODE,
            value: decl.filter,
            commit: v => impl.commit('filter', v),
            ctx: {impl, key: 'filter'},
            issues: impl.issuesFor('filter')
        }),
        propertyRow({
            key: `fields:${impl.resets.fields ?? 0}`,
            node: OVERRIDES_NODE,
            value: overrides,
            commit: v => commitFields({...instances, ...(v as PlainObject)}),
            ctx: {impl, key: 'fields'},
            issues: impl.issuesFor('fields')
        }),
        labelled('Field instances', instancesEditor(impl, instances, overrides, commitFields))
    ];
}

// Instances of the dataset's parameterized fields: each its field and parameters, plus a way to add one.
function instancesEditor(
    impl: SourceEditorModel,
    instances: Record<string, FieldInstance>,
    overrides: PlainObject,
    commitFields: (fields: PlainObject) => void
) {
    const disabled = impl.readOnly,
        commitInstance = (name: string, inst: FieldInstance) =>
            commitFields({...overrides, ...instances, [name]: inst});
    return div({
        className: `${CLS}__list`,
        items: [
            ...Object.entries(instances).map(([name, inst]) =>
                div({
                    key: name,
                    className: `${CLS}__item`,
                    items: [
                        hbox({
                            className: `${CLS}__item-header`,
                            items: [
                                div({className: `${CLS}__item-label`, item: name}),
                                button({
                                    icon: Icon.delete(),
                                    title: 'Remove',
                                    disabled,
                                    onClick: () =>
                                        commitFields({...overrides, ...omit(instances, name)})
                                })
                            ]
                        }),
                        select({
                            value: inst.field,
                            options: impl.parameterizedFields,
                            disabled,
                            width: '100%',
                            onCommit: (field: string) => commitInstance(name, {...inst, field})
                        }),
                        ...impl.fieldParams(inst.field).map(([pn, pd]) =>
                            propertyRow({
                                key: pn,
                                node: {
                                    ...nodeOf(pn, {
                                        ...impl.valueSchema(pd.type),
                                        description: pd.description
                                    }),
                                    bindable: true
                                },
                                value: inst.params?.[pn],
                                commit: v =>
                                    commitInstance(name, {
                                        ...inst,
                                        params:
                                            v === undefined
                                                ? omit(inst.params, pn)
                                                : {...inst.params, [pn]: v}
                                    }),
                                ctx: {impl, key: 'fields'}
                            })
                        )
                    ]
                })
            ),
            select({
                key: Object.keys(instances).length,
                placeholder: 'Add an instance of…',
                options: impl.parameterizedFields,
                disabled: disabled || !impl.parameterizedFields.length,
                width: '100%',
                onCommit: (field: string) => field && impl.addInstance(field)
            })
        ]
    });
}
