import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {select, textInput} from '@xh/hoist/desktop/cmp/input';
import {Icon} from '@xh/hoist/icon';
import {action, bindable, observable} from '@xh/hoist/mobx';
import classNames from 'classnames';
import type React from 'react';
import {useEffect, useRef} from 'react';
import {groupBy, isString, upperFirst} from 'lodash';
import type {BlueprintDesignModel, BlueprintIssue, WidgetSpec} from '../../../../blueprint';
import {slotLabel} from '../../../../blueprint/impl/elements';
import {getOwn} from '../../../../blueprint/impl/pointer';
import {type PaletteAddOpts, paletteDrag} from '../impl/paletteDrag';
import {widgetPreview} from '../BlueprintPreview';
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
        const impl = useLocalModel(() => new WidgetPaletteModel(designModel)),
            searchRef = useRef<HTMLInputElement>(null),
            {addRequestedAt} = designModel;
        // A request for Add, even one that opened this palette, focuses its search.
        useEffect(() => {
            if (addRequestedAt && Date.now() - addRequestedAt < 2000) searchRef.current?.focus();
        }, [addRequestedAt]);
        return div({
            className,
            onMouseEnter: () => impl.setPointerOver(true),
            onMouseLeave: () => impl.setPointerOver(false),
            children: [
                textInput({
                    model: impl,
                    bind: 'search',
                    inputRef: searchRef,
                    placeholder: 'Search widgets',
                    leftIcon: Icon.search(),
                    commitOnChange: true,
                    enableClear: true,
                    width: '100%'
                }),
                impl.target && !impl.readOnly
                    ? div({className: `${CLS}__target`, children: impl.target})
                    : null,
                ...impl.groups.map(({category, widgets}) =>
                    div({
                        key: category,
                        className: `${CLS}__group`,
                        children: [
                            div({className: `${CLS}__category`, children: upperFirst(category)}),
                            div({
                                className: `${CLS}__tiles`,
                                children: widgets.map(it => {
                                    const disabled = impl.readOnly || !!it.refusal;
                                    return div({
                                        key: it.name,
                                        className: classNames(
                                            `${CLS}__tile`,
                                            disabled && `${CLS}__tile--disabled`
                                        ),
                                        title: it.refusal ?? it.guidance,
                                        role: 'button',
                                        // Reachable when refused too, so its reason can be read.
                                        tabIndex: 0,
                                        'aria-disabled': disabled,
                                        'aria-label': it.refusal
                                            ? `${it.label}. ${it.refusal}`
                                            : it.label,
                                        draggable: !disabled,
                                        onDragStart: (e: React.DragEvent) => {
                                            e.dataTransfer.setData('text/plain', it.name);
                                            impl.dragStart(it.name);
                                        },
                                        onDragEnd: () => impl.dragEnd(),
                                        onClick: () => !disabled && impl.add(it.name),
                                        onKeyDown: (e: React.KeyboardEvent) => {
                                            if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                                                e.preventDefault();
                                                impl.add(it.name);
                                            }
                                        },
                                        children: [
                                            div({
                                                className: `${CLS}__tile-preview`,
                                                children: widgetPreview(it as any)
                                            }),
                                            div({
                                                className: `${CLS}__tile-text`,
                                                children: [
                                                    div({
                                                        className: `${CLS}__tile-label`,
                                                        children: it.label
                                                    }),
                                                    it.title
                                                        ? div({
                                                              className: `${CLS}__tile-title`,
                                                              children: it.title
                                                          })
                                                        : null
                                                ]
                                            })
                                        ]
                                    } as object);
                                })
                            })
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

    /** Text that narrows the widgets by name, label or term. */
    @bindable accessor search: string = null;

    /**
     * The widgets a designer can add, by category, in registry order, narrowed by the search. Each
     * says why the add target will not take it, if it will not.
     */
    get groups(): {category: string; widgets: PaletteTile[]}[] {
        const {designModel, search} = this,
            needle = search?.trim().toLowerCase(),
            matches = (it: WidgetSpec) =>
                !needle ||
                [it.name, it.label, ...(it.terms ?? [])].some(t =>
                    t?.toLowerCase().includes(needle)
                ),
            widgets = Object.values(designModel.blueprintModel.registry.widgets).filter(
                it => !it.reserved && matches(it)
            ),
            target = designModel.addTarget,
            byCategory = groupBy(widgets, it => it.category ?? 'other');
        return Object.entries(byCategory).map(([category, specs]) => ({
            category,
            widgets: specs.map(it => ({
                name: it.name,
                label: it.label ?? it.name,
                title: it.summary ?? firstSentence(it.guidance),
                guidance: it.guidance ?? null,
                icon: it.icon ?? null,
                preview: it.preview ?? null,
                category: it.category,
                refusal: designModel.addRefusal(it.name, target)
            }))
        }));
    }

    /** Note the pointer over the palette, for the canvas to outline where a click adds. */
    setPointerOver(over: boolean) {
        this.designModel.setShowAddTarget(over);
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
        const where =
            target.slot && target.slot !== 'children'
                ? `${nameOf(target.of ?? target.parent)}'s ${slotLabel(target.slot, !!target.of).toLowerCase()}`
                : nameOf(target.parent);
        return target.after
            ? `Adds after ${nameOf(target.after)}, in ${where}`
            : `Adds into ${where}`;
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

    /** Add a widget dropped on a container, where it fell, as one edit. */
    @action
    addAt(component: string, parentId: string, opts: PaletteAddOpts) {
        this.done(component, this.designModel.addWidget(component, parentId, opts));
    }

    /** Start dragging a widget, for a canvas to take. */
    dragStart(component: string) {
        const size = this.designModel.blueprintModel.registry.widgets[component]?.size?.default;
        paletteDrag.start({
            component,
            size: {w: size?.w ?? 4, h: size?.h ?? 2},
            add: (parentId, opts) => this.addAt(component, parentId, opts)
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

/** A widget the palette offers. */
export interface PaletteTile {
    name: string;
    label: string;
    /** Its summary, else the first sentence of its guidance. */
    title: string;
    guidance: string;
    icon: string;
    /** Its picture, as `WidgetSpec.preview` gives it. */
    preview: WidgetSpec['preview'];
    category: string;
    /** Why the add target will not take it, or null. */
    refusal: string;
}

//------------------
// Implementation
//------------------
const CLS = 'xh-blueprint-widget-palette';

// The first sentence of a text, past abbreviations such as "e.g.".
function firstSentence(text: string): string {
    return text?.match(/^.*?[.!?](?=\s+[A-Z]|$)/)?.[0] ?? text ?? null;
}
