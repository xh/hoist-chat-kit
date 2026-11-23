import classNames from 'classnames';
import {box, div, placeholder} from '@xh/hoist/cmp/layout';
import {mask} from '@xh/hoist/cmp/mask';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import {panel} from '@xh/hoist/desktop/cmp/panel';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import type React from 'react';
import type {ReactNode} from 'react';
import {uniq} from 'lodash';
import {
    type BlueprintSelection,
    type BlueprintWidgetModel,
    variableLabel,
    type WidgetSpec
} from '../../../../blueprint';
import {getOwn} from '../../../../blueprint/impl/pointer';
import {variableText} from '../../../../blueprint/impl/variableText';
import {contextMenu} from '@xh/hoist/desktop/cmp/contextmenu';
import {showContextMenu} from '@xh/hoist/kit/blueprint';
import {altHold} from '../design/impl/altHold';
import {designMenu} from '../design/impl/designActions';
import {selectionDragProps} from '../design/impl/elementDrag';
import type {BlueprintViewModel} from './BlueprintViewModel';
import {GRID_RESIZE_HANDLE} from '../../layout';
import {missingModules} from './highchartsModules';

const DESIGN_ELEMENT = 'xh-blueprint-view__design-element';

const listOf = (items: string[]) =>
    items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0];

interface ElementHostProps extends HoistProps {
    id: string;
    /** Not `viewModel`, which a `DashCanvasView` passes to its content as its own model. */
    blueprintViewModel: BlueprintViewModel;
}

/** Renders one element of a blueprint with its widget's component and model. */
export const [ElementHost, elementHost] = hoistCmp.withFactory<ElementHostProps>({
    displayName: 'BlueprintElementHost',
    model: false,
    render({id, blueprintViewModel: viewModel}) {
        const content = renderContent(id, viewModel),
            {designModel} = viewModel;
        if (!designModel) return content;
        // A designer wraps each element in run mode too, so switching modes neither remounts a
        // widget nor moves it. Only design mode marks it and takes the pointer.
        const isDesign = viewModel.blueprintModel.mode === 'design',
            // The innermost element under the pointer is the one it hovers or selects.
            innermost = (e: React.MouseEvent<HTMLElement>, flag: 'xhSelected' | 'xhHovered') => {
                const native = e.nativeEvent as MouseEvent & Record<string, boolean>;
                if (native[flag]) return null;
                native[flag] = true;
                return cellElementAt(e.target as HTMLElement, e.currentTarget) ?? id;
            };
        if (!isDesign) {
            return div({
                className: DESIGN_ELEMENT,
                ...({'data-blueprint-element': id} as object),
                children: [content, null, null]
            });
        }
        return div({
            className: classNames(
                DESIGN_ELEMENT,
                designModel.readerIds.includes(id) && `${DESIGN_ELEMENT}--reader`,
                viewModel.haloIds.includes(id) && `${DESIGN_ELEMENT}--halo`,
                designModel.showAddTarget &&
                    (designModel.addTarget?.of ?? designModel.addTarget?.parent) === id &&
                    `${DESIGN_ELEMENT}--add-target`,
                viewModel.getWidgetModel(id)?.isTooNarrow && `${DESIGN_ELEMENT}--too-narrow`
            ),
            // Read by cellElementAt, by a selection that scrolls into view, and by the overlay.
            ...({'data-blueprint-element': id} as object),
            // The selection drags by its body, onto any container.
            ...selectionDragProps(designModel, id),
            onClick: e => {
                if (designModel.interaction === 'interact') return;
                // Alt held passes one click through to the widget, and past the elements around it.
                const native = e.nativeEvent as MouseEvent & {xhPassed?: boolean};
                if (native.xhPassed) return;
                // The key's state on the click itself too, in case its key-up was lost.
                if (altHold.active || e.altKey) {
                    native.xhPassed = true;
                    altHold.consume();
                    return;
                }
                // A click on a canvas cell's header or grip selects its view.
                const view = viewAt(e.target as HTMLElement, e.currentTarget),
                    target = innermost(e, 'xhSelected');
                if (!target) return;
                designModel.select(view ? {kind: 'view', ...view} : {kind: 'element', id: target});
            },
            onMouseOver: e => {
                if (designModel.interaction === 'interact' || altHold.active || e.altKey) return;
                const target = innermost(e, 'xhHovered');
                if (target) designModel.setHovered(target);
            },
            onMouseLeave: () => {
                if (designModel.hoveredId === id) designModel.setHovered(null);
            },
            // In Edit, a right-click opens the design menu for what it lands on, before a widget's
            // own menu, which it keeps for Interact and an Alt click.
            onContextMenuCapture: (e: React.MouseEvent) => {
                const native = e.nativeEvent as MouseEvent & {xhMenu?: boolean};
                if (
                    native.xhMenu ||
                    designModel.interaction === 'interact' ||
                    altHold.active ||
                    e.altKey
                ) {
                    return;
                }
                native.xhMenu = true;
                const target = e.target as HTMLElement,
                    view = viewAt(target, e.currentTarget as HTMLElement),
                    el = target.closest<HTMLElement>('[data-blueprint-element]'),
                    sel: BlueprintSelection = view
                        ? {kind: 'view', ...view}
                        : {kind: 'element', id: el?.dataset.blueprintElement ?? id},
                    items = designMenu(designModel, sel);
                if (!items.length) return;
                e.preventDefault();
                e.stopPropagation();
                designModel.select(sel);
                showContextMenu(contextMenu({menuItems: items}), {left: e.clientX, top: e.clientY});
            },
            children: [content, designEmpty(id, viewModel), null]
        });
    }
});

/**
 * The element in the canvas cell whose header a click landed on, or null. A cell's header sits
 * outside the element's own wrapper, so the click reaches the canvas: the cell names its element.
 * A header item is an element of its own, which takes its click.
 */
export function cellElementAt(target: HTMLElement, host: HTMLElement): string {
    const header = target?.closest(CELL_CHROME),
        view = header?.closest<HTMLElement>('[data-blueprint-view]');
    return view && host.contains(view) ? view.dataset.blueprintView : null;
}

/**
 * The canvas view whose header or grip a click landed on, outside the header's own items, or
 * null.
 */
export function viewAt(target: HTMLElement, host: HTMLElement): {id: string; of: string} {
    const id = cellElementAt(target, host);
    if (!id) return null;
    const view = target.closest<HTMLElement>('[data-blueprint-view]'),
        item = target.closest('[data-blueprint-element]');
    if (item && view.contains(item)) return null;
    return {id, of: view.dataset.blueprintCanvas};
}

const CELL_CHROME = `[data-blueprint-view-header], [data-blueprint-view-grip], ${GRID_RESIZE_HANDLE}`;

// The field a widget needs set before it can draw: the variable an input sets, or a source.
function needsField(
    model: BlueprintWidgetModel,
    spec: WidgetSpec
): {key: string; text: string; action: string} {
    if (spec?.value && !model.valueVariable) {
        return {
            key: 'sets',
            text: `This ${spec.label} sets no variable yet.`,
            action: 'Pick a variable'
        };
    }
    const source = model.element?.config?.source;
    if (
        spec?.config?.properties?.source?.['x-source'] &&
        spec.config.required?.includes('source') &&
        !(typeof source === 'string' && getOwn(model.blueprintModel.blueprint?.sources, source))
    ) {
        return {
            key: 'source',
            text: `This ${spec.label} reads no source yet.`,
            action: 'Pick a source'
        };
    }
    return null;
}

function notePlaceholder(children: ReactNode) {
    return placeholder({
        className: 'xh-blueprint-view__notice',
        ...({role: 'note'} as object),
        children
    });
}

// A container with no children in design mode, with a way to fill it. The root says so plainly.
function designEmpty(id: string, viewModel: BlueprintViewModel) {
    const {blueprintModel, designModel, onAddWidget, onAskArchitect} = viewModel,
        el = blueprintModel.effective?.elements?.[id];
    if (!blueprintModel.registry.widgets[el?.component]?.children || el.children?.length) {
        return null;
    }
    const canEdit = blueprintModel.access === 'write',
        isRoot = blueprintModel.blueprint?.root === id,
        addWidget = () => {
            designModel.select({kind: 'element', id});
            onAddWidget?.({parent: id, slot: 'children'});
        };
    // A plain div, not a Hoist placeholder, whose inline `position: relative` would put it below
    // the container's own surface rather than over it.
    return div({
        key: 'design-empty',
        className: classNames(
            'xh-blueprint-view__design-empty',
            !isRoot && 'xh-blueprint-view__design-empty--quiet'
        ),
        children: [
            div({
                key: 'text',
                children: isRoot ? 'This dashboard is empty.' : 'Drag a widget here, or'
            }),
            canEdit
                ? button({
                      key: 'add',
                      text: isRoot ? 'Add a widget' : 'Add a widget to this container',
                      icon: Icon.add(),
                      minimal: true,
                      onClick: addWidget
                  })
                : null,
            canEdit && isRoot && onAskArchitect
                ? button({
                      key: 'architect',
                      text: 'Ask the Architect',
                      icon: Icon.sparkles(),
                      minimal: true,
                      onClick: () => onAskArchitect()
                  })
                : null
        ]
    });
}

// A data widget over its source: masked while it loads, and naming the values in play when it
// has no rows.
function dataBody(model: BlueprintWidgetModel, category: string, body: ReactNode) {
    const {source, blueprintModel} = model;
    if (category !== 'data' || !source) return body;
    const noRows =
            source.hasLoaded &&
            !source.isLoading &&
            !source.isWaiting &&
            source.cube.store.count === 0,
        inPlay = uniq(
            JSON.stringify(blueprintModel.blueprint?.sources?.[source.name]?.params ?? {})
                .match(/"\$var":"([^"]+)"/g)
                ?.map(it => it.slice(8, -1)) ?? []
        )
            .map(name => {
                const v = blueprintModel.getVariable(name),
                    text = v ? variableText(v.value, v.decl.type) : '';
                return text ? `${variableLabel(name, v.decl)} ${text}` : null;
            })
            .filter(Boolean);
    return box({
        className: 'xh-blueprint-view__data',
        children: [
            noRows
                ? notePlaceholder(
                      inPlay.length ? `No rows for ${listOf(inPlay)}.` : 'No rows to show.'
                  )
                : body,
            mask({key: 'mask', isDisplayed: source.isLoading, spinner: true})
        ]
    });
}

function renderContent(id: string, viewModel: BlueprintViewModel) {
    const model = viewModel.getWidgetModel(id),
        component = viewModel.getComponent(id);
    if (!model) return null;
    const spec = model.blueprintModel.registry.widgets[model.element.component],
        missing = missingModules(spec, model.resolvedConfig),
        notice = missing.length
            ? `This needs Highcharts' ${listOf(missing)} module${missing.length > 1 ? 's' : ''}, which this app does not load.`
            : model.source?.isTooLarge
              ? 'This result has too many rows to show here.'
              : model.source?.isUnavailable
                ? 'The data for this answer is no longer available.'
                : (model.source?.joinWait ?? model.source?.selectionWait ?? null);
    if (notice) return notePlaceholder(notice);
    // A widget that needs a field set says so, and in design mode offers to set it.
    const needs = needsField(model, spec);
    if (needs) {
        const {designModel, blueprintModel} = viewModel,
            canFix =
                designModel &&
                blueprintModel.mode === 'design' &&
                blueprintModel.access === 'write';
        return notePlaceholder([
            needs.text,
            canFix
                ? button({
                      key: 'fix',
                      text: needs.action,
                      minimal: true,
                      onClick: (e: React.MouseEvent) => {
                          e.stopPropagation();
                          designModel.requestFieldFocus(id, needs.key);
                      }
                  })
                : null
        ]);
    }
    const {source} = model;
    if (source?.lastError && !source.isLoading) {
        return notePlaceholder([
            `Could not load ${source.name}.`,
            button({
                key: 'retry',
                text: 'Retry',
                icon: Icon.refresh(),
                minimal: true,
                onClick: () => source.reloadAsync().catchDefault()
            })
        ]);
    }
    if (!component) {
        return div({
            className: 'xh-blueprint-view__missing',
            children: `${model.element.component} has no desktop component yet.`
        });
    }
    // A widget that draws as a card in a reply has no height of its own as a panel there. It
    // takes the height of its content, up to that of its default size on a dashboard.
    const {blueprintModel} = model,
        rows = spec?.size?.default?.h;
    if (
        blueprintModel.isAnswer &&
        spec?.presentations?.length &&
        rows &&
        blueprintModel.presentationOf(id) === 'panel'
    ) {
        const height = Math.min(model.contentHeight ?? Infinity, rows * ANSWER_ROW_HEIGHT),
            title = blueprintModel.resolveTitle(model.element.config?.title),
            hasTitle = title != null && title !== '';
        if (viewModel.framePanel) {
            return viewModel.framePanel({
                title: hasTitle ? String(title) : null,
                contentHeight: height,
                children: component({model})
            });
        }
        // A title draws in a header, as a dashboard's cell draws it, above the content.
        return panel({
            className: 'xh-blueprint-view__answer-panel',
            title: hasTitle ? String(title) : null,
            compactHeader: true,
            height: hasTitle ? `calc(${height}px + var(--xh-title-compact-height))` : height,
            width: '100%',
            flex: 'none',
            children: component({model})
        });
    }
    return dataBody(model, spec?.category, component({model}));
}

// The height of a dashboard row, so a panel in a reply is as tall as its default size there.
const ANSWER_ROW_HEIGHT = 50;
