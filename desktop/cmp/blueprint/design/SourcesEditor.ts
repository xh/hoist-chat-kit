import {div, filler, hbox, placeholder} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type PlainObject, useLocalModel, uses, XH} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {select, textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {wait} from '@xh/hoist/promise';
import {type KeyboardEvent, useEffect, useRef} from 'react';
import {action, observableRef} from '@xh/hoist/mobx';
import {isEmpty, isPlainObject, omit, omitBy, pick, pickBy} from 'lodash';
import {
    type BlueprintDesignModel,
    FIELD_OVERRIDE_SCHEMA,
    type DatasetDef,
    type FieldInstance,
    isFieldInstance,
    type JoinDecl,
    type SourceDecl,
    variableTypeMatches
} from '../../../../blueprint';
import './ElementInspector.scss';
import {joinFields, type JoinField} from '../../../../blueprint/impl/joins';
import {ConfigEditorModel} from './impl/ConfigEditorModel';
import {
    CLS,
    countLabel,
    issueRows,
    labelled,
    listOf,
    nodeOf,
    onItemDelete,
    type Option,
    pageBar,
    propertyRow,
    refocusAdd
} from './impl/ConfigEditors';

export interface SourcesEditorProps extends HoistProps {
    designModel: BlueprintDesignModel;
    /** True inside `blueprintInspector`, which draws the header in place of the editor's own. */
    framed?: boolean;
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
    render({designModel, framed, className}) {
        const impl = useLocalModel(() => new SourceEditorModel(designModel));
        impl.framed = !!framed;
        return sourcesBody({model: impl, className});
    }
});

/** @internal */
export class SourceEditorModel extends ConfigEditorModel {
    /** The join or field instance whose page shows in place of the source's settings, or null. */
    @observableRef accessor page: {source: string; list: 'joins' | 'instances'; key: string} = null;

    @action
    setPage(page: {list: 'joins' | 'instances'; key: string}) {
        this.page = page ? {source: this.name, ...page} : null;
    }

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

    /**
     * Point the source at another dataset. If that breaks widgets that name the old dataset's
     * fields, offer to remove them in the same edit, or say which to change first.
     */
    async setDatasetAsync(dataset: string) {
        const {name, designModel} = this;
        if (dataset === this.values.dataset) return;
        const {breaks} = designModel.describeDatasetChange(name, dataset);
        if (!breaks.length) {
            this.refuseOn('dataset', designModel.changeSourceDataset(name, dataset));
            return;
        }
        const list = listOf(breaks),
            ok = await XH.confirm({
                title: 'Change dataset',
                message: `${list} read fields that ${dataset} lacks. Remove ${breaks.length > 1 ? 'them' : 'it'} with the change?`,
                confirmProps: {text: 'Remove and change', intent: 'danger'}
            });
        if (ok) {
            this.refuseOn(
                'dataset',
                designModel.changeSourceDataset(name, dataset, {removeBreaking: true})
            );
        } else {
            this.refuse(
                'dataset',
                `Change or remove ${list} first: they read fields that ${dataset} lacks.`
            );
        }
    }

    /** Add an instance of a parameterized field, named for it, with parameters to start from. */
    addInstance(field: string) {
        const fields = this.values.fields ?? {};
        let n = 1;
        while (Object.hasOwn(fields, `${field}${n}`)) n++;
        // Each param bound to a variable of its type, the one of the same name first, or unset.
        const params = Object.fromEntries(
            this.fieldParams(field)
                .map(([pn, pd]) => {
                    const fitting = this.paramVariables(pd.type);
                    return [pn, fitting.includes(pn) ? pn : fitting[0]];
                })
                .filter(([, v]) => v)
                .map(([pn, v]) => [pn, {$var: v}])
        );
        this.commit('fields', {
            ...fields,
            [`${field}${n}`]: {field, ...(isEmpty(params) ? {} : {params})}
        });
    }

    /** The dataset sources this one can join: any other that neither joins nor is joined. */
    get joinSourceOptions(): string[] {
        const sources = this.designModel.blueprintModel.blueprint?.sources ?? {},
            joined = Object.values(sources).flatMap(it => (it.joins ?? []).map(j => j.source));
        return Object.keys(sources).filter(
            it =>
                it !== this.name &&
                sources[it].dataset &&
                isEmpty(sources[it].joins) &&
                (!joined.includes(it) || (this.values.joins ?? []).some(j => j.source === it))
        );
    }

    /** Join another source, on the fields of its key that this source has, of the same type. */
    addJoin(source: string) {
        const own = this.dataset,
            other = this.datasetOf(source),
            on = Object.fromEntries(
                (other?.key ?? [])
                    .filter(it => own?.fields[it]?.type === other.fields[it]?.type)
                    .map(it => [it, it])
            );
        this.commit('joins', [...(this.values.joins ?? []), {source, on, fields: []}]);
    }

    /** Change keys of a join, removing each given as null or empty. */
    setJoin(idx: number, changes: Partial<JoinDecl>) {
        this.commit(
            'joins',
            (this.values.joins ?? []).map((it, i) =>
                i === idx
                    ? (omitBy(
                          {...it, ...changes},
                          v => v == null || (isPlainObject(v) && isEmpty(v))
                      ) as unknown as JoinDecl)
                    : it
            )
        );
    }

    removeJoin(idx: number) {
        const next = (this.values.joins ?? []).filter((_, i) => i !== idx);
        this.commit('joins', next.length ? next : undefined);
    }

    /** Each field a join brings, with how it reaches this source's rows. */
    joinModes(idx: number): Pick<JoinField, 'name' | 'field' | 'mode' | 'reduce'>[] {
        const join = this.values.joins?.[idx];
        if (!join) return [];
        return joinFields(join, this.dataset, this.datasetOf(join.source)).map(it =>
            pick(it, 'name', 'field', 'mode', 'reduce')
        );
    }

    /** The joined source's fields a join can bring: any it does not join on. */
    joinFieldOptions(idx: number): Option[] {
        const join = this.values.joins?.[idx],
            other = this.datasetOf(join?.source),
            on = Object.values(join?.on ?? {});
        return Object.values(other?.fields ?? {})
            .filter(it => !on.includes(it.name))
            .map(it => ({value: it.name, label: it.label ?? it.name}));
    }

    /** The joined source's dimensions a field of this source can pair with: those of its type. */
    onOptions(idx: number, field: string): Option[] {
        const other = this.datasetOf(this.values.joins?.[idx]?.source),
            type = this.dataset?.fields[field]?.type;
        return Object.values(other?.fields ?? {})
            .filter(it => it.isDimension && it.type === type)
            .map(it => ({value: it.name, label: it.label ?? it.name}));
    }

    /** This source's dimensions, to join on. */
    get onFieldOptions(): Option[] {
        return Object.values(this.dataset?.fields ?? {})
            .filter(it => it.isDimension)
            .map(it => ({value: it.name, label: it.label ?? it.name}));
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
        return this.datasetOf(this.name);
    }

    private datasetOf(source: string): DatasetDef {
        const name = this.designModel.blueprintModel.blueprint?.sources?.[source]?.dataset;
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
        const {name, readOnly: disabled} = impl,
            ref = useRef<HTMLDivElement>(null),
            pageKey = impl.page ? `${impl.page.list}/${impl.page.key}` : null;
        // A page takes focus as it opens or steps, so its keys work at once.
        useEffect(() => {
            // After the key or click that opened it, so its activation never lands on Back.
            wait().then(() => {
                const page = ref.current?.querySelector<HTMLElement>(`.${CLS}__page`);
                if (page && !page.contains(document.activeElement)) {
                    page.querySelector<HTMLElement>('button')?.focus();
                }
            });
        }, [pageKey]);
        return div({
            ref,
            className,
            children: [
                impl.framed
                    ? null
                    : hbox({
                          className: `${CLS}__header`,
                          children: [
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
    if (impl.page?.source === impl.name) {
        const page = sourcePage(impl, instances, overrides, commitFields);
        if (page) return page;
    }
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
                onCommit: (it: string) => impl.setDatasetAsync(it)
            }),
            impl.issuesFor('dataset'),
            null,
            'The Data Catalog dataset the source requests.'
        ),
        labelled(
            'Parameters',
            div({
                className: `${CLS}__group`,
                children: impl.params.map(([pn, pd]) =>
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
            impl.issuesFor('params'),
            null,
            'The variable each parameter takes. A starred one is required.'
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
        labelled(
            'Field instances',
            instancesEditor(impl, instances, overrides, commitFields),
            [],
            null,
            'A parameterized field, such as a return over a window, with its parameters bound.'
        ),
        labelled(
            'Joins',
            joinsEditor(impl),
            impl.issuesFor('joins'),
            null,
            'Fields from another source, matched on shared keys.'
        )
    ];
}

// Each join as a row, its source and what it pairs and brings, opened on its page. Delete on a row
// removes the join.
function joinsEditor(impl: SourceEditorModel) {
    const disabled = impl.readOnly,
        joins = impl.values.joins ?? [];
    return div({
        className: `${CLS}__list ${CLS}__field-list`,
        onKeyDown: (e: KeyboardEvent) =>
            !disabled &&
            onItemDelete(e, key => impl.removeJoin(joins.findIndex(it => it.source === key))),
        children: [
            ...joins.map(join =>
                itemRow(
                    join.source,
                    join.source,
                    [
                        Object.keys(join.on ?? {}).length
                            ? `on ${Object.keys(join.on).join(', ')}`
                            : null,
                        join.fields?.length ? countLabel(join.fields.length, 'field') : null
                    ],
                    () => impl.setPage({list: 'joins', key: join.source})
                )
            ),
            select({
                value: null,
                options: impl.joinSourceOptions.filter(it => !joins.some(j => j.source === it)),
                placeholder: 'Join a source…',
                disabled,
                width: '100%',
                onCommit: (source: string) => source && impl.addJoin(source)
            })
        ]
    });
}

// A join's settings: the fields it pairs, the fields it brings, and their names here.
function joinBody(impl: SourceEditorModel, join: PlainObject, idx: number) {
    const disabled = impl.readOnly;
    return [
        labelled(
            'On',
            div({
                className: `${CLS}__group`,
                children: Object.entries<string>(join.on ?? {}).map(([own, other]) =>
                    hbox({
                        key: own,
                        children: [
                            select({
                                value: own,
                                options: impl.onFieldOptions,
                                disabled,
                                flex: 1,
                                onCommit: (f: string) =>
                                    impl.setJoin(idx, {on: {...omit(join.on, own), [f]: other}})
                            }),
                            select({
                                value: other,
                                options: impl.onOptions(idx, own),
                                disabled,
                                flex: 1,
                                onCommit: (f: string) =>
                                    impl.setJoin(idx, {on: {...join.on, [own]: f}})
                            })
                        ]
                    })
                )
            })
        ),
        labelled(
            'Fields',
            select({
                value: join.fields ?? [],
                options: impl.joinFieldOptions(idx),
                enableMulti: true,
                placeholder: 'Fields to bring…',
                disabled,
                width: '100%',
                onCommit: (fields: string[]) => impl.setJoin(idx, {fields})
            })
        ),
        ...impl.joinModes(idx).map(it =>
            labelled(
                `${it.field}: ${it.mode}${it.reduce ? ', reduced' : ''}`,
                textInput({
                    value: join.as?.[it.field] ?? '',
                    placeholder: 'Name it here as…',
                    disabled,
                    width: '100%',
                    onCommit: (name: string) =>
                        impl.setJoin(idx, {
                            as: name ? {...join.as, [it.field]: name} : omit(join.as, it.field)
                        })
                })
            )
        )
    ];
}

// A list item's row: its label, chips of what it sets, and › to its page.
function itemRow(key: string, label: string, chips: string[], openPage: () => void) {
    return hbox({
        key,
        className: `${CLS}__item-header`,
        tabIndex: 0,
        ...({'data-row-key': key} as object),
        onKeyDown: (e: KeyboardEvent) => {
            // Its › opens the page on its own click.
            if ((e.key !== 'Enter' && e.key !== ' ') || e.target !== e.currentTarget) return;
            e.preventDefault();
            openPage();
        },
        children: [
            div({className: `${CLS}__column-label`, children: label}),
            ...chips
                .filter(Boolean)
                .map((it, idx) => div({key: idx, className: `${CLS}__chip-text`, children: it})),
            button({
                className: `${CLS}__page-link`,
                icon: Icon.chevronRight(),
                minimal: true,
                small: true,
                title: `All settings of ${label}`,
                'aria-label': `All settings of ${label}`,
                onClick: openPage
            })
        ]
    } as object);
}

// The page of the join or field instance open, or null if it is gone.
function sourcePage(
    impl: SourceEditorModel,
    instances: Record<string, FieldInstance>,
    overrides: PlainObject,
    commitFields: (fields: PlainObject) => void
) {
    const {list, key} = impl.page,
        isJoin = list === 'joins',
        keys = isJoin ? (impl.values.joins ?? []).map(it => it.source) : Object.keys(instances),
        index = keys.indexOf(key);
    if (index < 0) return null;
    const back = () => impl.setPage(null);
    return [
        div({
            key: 'page',
            className: `${CLS}__page`,
            onKeyDown: (e: KeyboardEvent) => {
                if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    const to = keys[index + (e.key === 'ArrowUp' ? -1 : 1)];
                    if (to) impl.setPage({list, key: to});
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    back();
                }
            },
            children: [
                pageBar({
                    listLabel: isJoin ? 'Joins' : 'Field instances',
                    title: key,
                    index,
                    count: keys.length,
                    onStep: by => keys[index + by] && impl.setPage({list, key: keys[index + by]}),
                    onBack: back
                }),
                ...(isJoin
                    ? joinBody(impl, impl.values.joins[index], index)
                    : instanceBody(impl, key, instances, overrides, commitFields))
            ]
        })
    ];
}

// Instances of the dataset's parameterized fields, each a row opened on its page, plus a way to
// add one. Delete on a row removes it.
function instancesEditor(
    impl: SourceEditorModel,
    instances: Record<string, FieldInstance>,
    overrides: PlainObject,
    commitFields: (fields: PlainObject) => void
) {
    const disabled = impl.readOnly;
    return div({
        className: `${CLS}__list ${CLS}__field-list ${CLS}__instances`,
        onKeyDown: (e: KeyboardEvent) =>
            !disabled &&
            onItemDelete(e, name => commitFields({...overrides, ...omit(instances, name)})),
        children: [
            ...Object.entries(instances).map(([name, inst]) =>
                itemRow(
                    name,
                    name,
                    [
                        inst.field,
                        Object.keys(inst.params ?? {}).length
                            ? `${Object.keys(inst.params).length} set`
                            : null
                    ],
                    () => impl.setPage({list: 'instances', key: name})
                )
            ),
            select({
                key: Object.keys(instances).length,
                placeholder: 'Add an instance of…',
                options: impl.parameterizedFields,
                disabled: disabled || !impl.parameterizedFields.length,
                width: '100%',
                onCommit: (field: string) => {
                    if (!field) return;
                    impl.addInstance(field);
                    refocusAdd(document.querySelector(`.${CLS}__instances`));
                }
            })
        ]
    });
}

// A field instance's settings: its field, then its parameters, each bound or set.
function instanceBody(
    impl: SourceEditorModel,
    name: string,
    instances: Record<string, FieldInstance>,
    overrides: PlainObject,
    commitFields: (fields: PlainObject) => void
) {
    const inst = instances[name],
        commitInstance = (next: FieldInstance) =>
            commitFields({...overrides, ...instances, [name]: next});
    return [
        labelled(
            'Field',
            select({
                value: inst.field,
                options: impl.parameterizedFields,
                disabled: impl.readOnly,
                width: '100%',
                onCommit: (field: string) => commitInstance({...inst, field})
            })
        ),
        ...impl.fieldParams(inst.field).map(([pn, pd]) =>
            propertyRow({
                key: pn,
                node: {
                    ...nodeOf(pn, {...impl.valueSchema(pd.type), description: pd.description}),
                    bindable: true
                },
                value: inst.params?.[pn],
                commit: v =>
                    commitInstance({
                        ...inst,
                        params: v === undefined ? omit(inst.params, pn) : {...inst.params, [pn]: v}
                    }),
                ctx: {impl, key: 'fields'}
            })
        )
    ];
}
