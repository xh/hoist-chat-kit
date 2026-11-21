import {div} from '@xh/hoist/cmp/layout';
import {
    hoistCmp,
    HoistModel,
    type HoistProps,
    type PlainObject,
    useLocalModel
} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {select} from '@xh/hoist/desktop/cmp/input';
import {action, observable} from '@xh/hoist/mobx';
import type React from 'react';
import {groupBy, isString, upperFirst} from 'lodash';
import type {BlueprintDesignModel, BlueprintIssue} from '../../../../blueprint';
import {getOwn} from '../../../../blueprint/impl/pointer';
import {paletteDrag} from '../impl/paletteDrag';
import './WidgetPalette.scss';

export interface WidgetPaletteProps extends HoistProps {
    designModel: BlueprintDesignModel;
}

/**
 * The registry's widgets by category, for a designer to add one: into the selected container, or
 * beside the selected element, or into the root. The new element is then selected.
 */
export const [WidgetPalette, widgetPalette] = hoistCmp.withFactory<WidgetPaletteProps>({
    displayName: 'BlueprintWidgetPalette',
    className: 'xh-blueprint-widget-palette',
    model: false,
    render({designModel, className}) {
        const impl = useLocalModel(() => new WidgetPaletteModel(designModel));
        return div({
            className,
            children: [
                impl.target && !impl.readOnly
                    ? div({className: `${CLS}__target`, children: impl.target})
                    : null,
                ...impl.groups.map(({category, widgets}) =>
                    div({
                        key: category,
                        className: `${CLS}__group`,
                        children: [
                            div({className: `${CLS}__category`, children: upperFirst(category)}),
                            ...widgets.map(it =>
                                div({
                                    key: it.name,
                                    draggable: !impl.readOnly,
                                    onDragStart: (e: React.DragEvent) => {
                                        e.dataTransfer.setData('text/plain', it.name);
                                        impl.dragStart(it.name);
                                    },
                                    onDragEnd: () => impl.dragEnd(),
                                    children: button({
                                        text: it.label,
                                        title: it.title,
                                        minimal: true,
                                        disabled: impl.readOnly,
                                        onClick: () => impl.add(it.name)
                                    })
                                })
                            )
                        ]
                    })
                ),
                impl.needsSource
                    ? div({
                          className: `${CLS}__source`,
                          children: [
                              div(
                                  `The ${impl.labelOf(impl.needsSource)} reads a source. Add one over:`
                              ),
                              select({
                                  value: null,
                                  options: impl.datasetOptions,
                                  placeholder: 'Dataset…',
                                  width: '100%',
                                  onCommit: (it: string) => impl.addOver(it)
                              })
                          ]
                      })
                    : null,
                impl.message ? div({className: `${CLS}__message`, children: impl.message}) : null
            ]
        });
    }
});

/** @internal */
export class WidgetPaletteModel extends HoistModel {
    /** Why the last widget asked for was not added, until the next one is. */
    @observable accessor message: string = null;

    /** A widget asked for that needs a source first, which the palette offers to add. */
    @observable accessor needsSource: string = null;

    constructor(readonly designModel: BlueprintDesignModel) {
        super();
    }

    /** The widgets a designer can add, by category, in registry order. */
    get groups(): {category: string; widgets: {name: string; label: string; title: string}[]}[] {
        const widgets = Object.values(this.designModel.blueprintModel.registry.widgets).filter(
                it => !it.reserved
            ),
            byCategory = groupBy(widgets, it => it.category ?? 'other');
        return Object.entries(byCategory).map(([category, specs]) => ({
            category,
            widgets: specs.map(it => ({
                name: it.name,
                label: it.label ?? it.name,
                title: it.guidance?.split('. ')[0] ?? null
            }))
        }));
    }

    /** Where a click adds a widget, as a designer reads it. */
    get target(): string {
        const {designModel} = this,
            target = designModel.addTarget,
            {blueprint} = designModel.blueprintModel;
        if (!target) return blueprint?.root ? null : 'Adds as the root';
        const nameOf = (id: string) => {
            const title = getOwn(blueprint.elements, id)?.config?.title;
            return isString(title) && title ? title : id;
        };
        return target.after
            ? `Adds after ${nameOf(target.after)}, in ${nameOf(target.parent)}`
            : `Adds into ${nameOf(target.parent)}`;
    }

    labelOf(component: string): string {
        return this.designModel.blueprintModel.registry.widgets[component]?.label ?? component;
    }

    get readOnly(): boolean {
        const {mode, access} = this.designModel.blueprintModel;
        return mode !== 'design' || access !== 'write';
    }

    /** The datasets a source for {@link needsSource} can read. */
    get datasetOptions(): {value: string; label: string}[] {
        return this.designModel.blueprintModel.catalogs.flatMap(cat =>
            Object.values(cat.datasets).map(it => ({value: it.name, label: it.label ?? it.name}))
        );
    }

    @action
    add(component: string) {
        this.done(component, this.designModel.addWidget(component));
    }

    /** Add a widget dropped on a canvas, where it fell, with its siblings as the drop left them. */
    @action
    drop(component: string, canvasId: string, child: PlainObject, siblings: PlainObject[]) {
        this.done(component, this.designModel.addWidget(component, canvasId, {child, siblings}));
    }

    /** Start dragging a widget, for a canvas to take. */
    dragStart(component: string) {
        const size = this.designModel.blueprintModel.registry.widgets[component]?.size?.default;
        paletteDrag.start({
            component,
            size: {w: size?.w ?? 4, h: size?.h ?? 2},
            drop: (canvasId, child, siblings) => this.drop(component, canvasId, child, siblings)
        });
    }

    dragEnd() {
        paletteDrag.end();
    }

    private done(component: string, {id, issues}: {id?: string; issues: BlueprintIssue[]}) {
        const {designModel} = this,
            error = issues.find(it => it.severity === 'error');
        this.needsSource = error && designModel.needsSource(component) ? component : null;
        this.message = this.needsSource ? null : (error?.message ?? null);
        if (!error) designModel.select({kind: 'element', id});
    }

    /** Add a source over a dataset, with prompts for what it needs, then the widget waiting on it. */
    @action
    addOver(dataset: string) {
        const component = this.needsSource,
            error = this.designModel
                .addSource(dataset, {addVariables: true})
                .issues.find(it => it.severity === 'error');
        if (error) {
            this.message = error.message;
            return;
        }
        this.add(component);
    }
}

//------------------
// Implementation
//------------------
const CLS = 'xh-blueprint-widget-palette';
