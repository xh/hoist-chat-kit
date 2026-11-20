import {type FilterChooserFieldSpecConfig, FilterChooserModel} from '@xh/hoist/cmp/filter';
import {GroupingChooserModel} from '@xh/hoist/cmp/grouping';
import {div, hbox} from '@xh/hoist/cmp/layout';
import type {FilterLike} from '@xh/hoist/data';
import {creates, hoistCmp, HoistModel, managed, type PlainObject} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {filterChooser} from '@xh/hoist/desktop/cmp/filter';
import {groupingChooser} from '@xh/hoist/desktop/cmp/grouping';
import {Icon} from '@xh/hoist/icon';
import {isEqual} from 'lodash';
import {isVarBinding} from '../../../../../blueprint';
import {joinClauses, splitClauses} from '../../../../../blueprint/design/filterClauses';

const CLS = 'xh-blueprint-element-inspector';

interface GroupingEditorProps {
    value: string[];
    dimensions: {value: string; label: string}[];
    disabled: boolean;
    onCommit: (value: string[]) => void;
}

/** A list of dimensions, ordered, with Hoist's grouping chooser. */
export const groupingEditor = hoistCmp.factory<GroupingEditorModel>({
    model: creates(() => GroupingEditorModel),
    render({model}) {
        return groupingChooser({
            model: model.chooserModel,
            disabled: model.props.disabled,
            width: '100%'
        });
    }
});

class GroupingEditorModel extends HoistModel {
    @managed readonly chooserModel = new GroupingChooserModel({
        dimensions: [],
        initialValue: [],
        allowEmpty: true,
        commitOnChange: true
    });

    get props(): GroupingEditorProps {
        return this.componentProps as GroupingEditorProps;
    }

    override onLinked() {
        this.addReaction(
            {
                track: () => this.props.dimensions,
                run: dims =>
                    this.chooserModel.setDimensions(
                        dims.map(it => ({name: it.value, displayName: it.label}))
                    ),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => this.props.value ?? [],
                run: value => this.chooserModel.setValue(value),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => this.chooserModel.value,
                run: value => {
                    if (!isEqual(value, this.props.value ?? [])) this.props.onCommit(value);
                }
            }
        );
    }
}

interface FilterEditorProps {
    value: PlainObject;
    // Called once, as building the specs reads every row of the source.
    fieldSpecs: () => FilterChooserFieldSpecConfig[];
    labelOf: (field: string) => string;
    disabled: boolean;
    onCommit: (value: PlainObject) => void;
}

/**
 * A filter, as its clauses ANDed: those that name a variable as chips a designer can remove, and
 * literal ones in Hoist's filter chooser.
 */
export const filterEditor = hoistCmp.factory<FilterEditorModel>({
    model: creates(() => FilterEditorModel),
    render({model}) {
        const {value, disabled, labelOf, onCommit} = model.props,
            {bound, literal} = splitClauses(value);
        return div({
            className: `${CLS}__filter`,
            items: [
                ...bound.map((clause, idx) =>
                    hbox({
                        key: idx,
                        className: `${CLS}__chip-row`,
                        items: [
                            div({className: `${CLS}__chip`, item: describe(clause, labelOf)}),
                            button({
                                icon: Icon.x(),
                                title: 'Remove',
                                minimal: true,
                                disabled,
                                onClick: () =>
                                    onCommit(
                                        joinClauses(
                                            bound.filter(it => it !== clause),
                                            literal
                                        )
                                    )
                            })
                        ]
                    })
                ),
                filterChooser({model: model.chooserModel, disabled, width: '100%'})
            ]
        });
    }
});

class FilterEditorModel extends HoistModel {
    @managed chooserModel: FilterChooserModel;

    get props(): FilterEditorProps {
        return this.componentProps as FilterEditorProps;
    }

    override onLinked() {
        this.chooserModel = new FilterChooserModel({fieldSpecs: this.props.fieldSpecs()});
        this.addReaction(
            {
                track: () => splitClauses(this.props.value).literal,
                run: literal => this.chooserModel.setValue(literal as FilterLike[]),
                equals: 'structural',
                fireImmediately: true
            },
            {
                track: () => literalOf(this.chooserModel.value),
                run: literal => {
                    const current = splitClauses(this.props.value);
                    if (isEqual(literal, current.literal)) return;
                    this.props.onCommit(joinClauses(current.bound, literal));
                },
                equals: 'structural'
            }
        );
    }
}

// The clauses of a filter chooser's value, in JSON form.
function literalOf(filter: {toJSON: () => PlainObject}): PlainObject[] {
    return splitClauses(filter?.toJSON() ?? null).literal;
}

function describe(clause: PlainObject, labelOf: (field: string) => string): string {
    if (isVarBinding(clause)) return clause.$var;
    if (clause.field == null) return JSON.stringify(clause);
    const value = isVarBinding(clause.value) ? clause.value.$var : JSON.stringify(clause.value);
    return `${labelOf(clause.field)} ${clause.op} ${value}`;
}
