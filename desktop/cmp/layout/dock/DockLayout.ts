import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {
    group,
    type GroupImperativeHandle,
    type Layout,
    panel as splitPanel,
    separator
} from '@xh/hoist/kit/react-resizable-panels';
import classNames from 'classnames';
import {type DragEvent, type KeyboardEvent, type ReactElement, useEffect, useRef} from 'react';
import {overlayHost, OVERLAY_LAYERS} from '../overlay';
import './DockLayout.scss';
import {DockLayoutModel, type DockLayoutProps, tabIndexAt, zoneAt} from './DockLayoutModel';
import type {DockItem, DockTarget} from './dockTree';

const CLS = 'xh-layout-dock';

// The outer band of the whole layout, in pixels, where a drop splits the whole layout.
const ROOT_EDGE = 16;

/**
 * A layout of splits and tab stacks, controlled by the tree it is given. A user resizes splits,
 * switches tabs, and, when `editable`, drags a tab into a stack, a tab strip, an edge of a stack, or
 * an edge of the whole layout. Each finished resize or move calls `onChange` once with a new tree.
 * Alt+Up and Alt+Down move a tab within its strip. Drop previews draw in an overlay.
 * @internal
 */
export const dockLayout = hoistCmp.factory<HoistProps & DockLayoutProps>({
    displayName: 'DockLayout',
    className: CLS,
    model: false,
    render(props) {
        const impl = useLocalModel(() => new DockLayoutModel()),
            {className, layout, active, onHiddenChange, overlay} = props;
        impl.props = props;

        useShowActive(impl, active);
        useReportHidden(impl, onHiddenChange);
        usePreviewMarks(impl);

        const body = div({
            ref: (el: HTMLDivElement) => {
                impl.rootEl = el;
            },
            className: classNames(className, impl.dragging && `${CLS}--dragging`),
            onDragOver: e => onRootDragOver(impl, e),
            onDrop: e => onDrop(impl, e),
            children: (layout ?? []).map((it, idx) =>
                dockItem({key: keyOf(it), impl, node: it, path: [idx]})
            )
        });
        return overlay ? body : overlayHost({model: impl.ownOverlay, children: body});
    }
});

//------------------
// Implementation
//------------------
const dockItem = hoistCmp.factory<
    HoistProps & {impl: DockLayoutModel; node: DockItem; path: number[]}
>({
    displayName: 'DockItem',
    model: false,
    render({impl, node, path}) {
        if (node.type === 'stack') return dockStack({impl, stack: node});
        if (node.type === 'view') return dockStack({impl, stack: {type: 'stack', content: [node]}});
        return dockSplit({impl, split: node, path});
    }
});

const dockSplit = hoistCmp.factory<
    HoistProps & {impl: DockLayoutModel; split: DockItem; path: number[]}
>({
    displayName: 'DockSplit',
    model: false,
    render({impl, split, path}) {
        const ref = useRef<GroupImperativeHandle>(null),
            key = split.type === 'column' ? 'height' : 'width',
            children = split.content ?? [],
            sizes = children.map(it => it[key] ?? 100 / children.length),
            ids = children.map(keyOf);

        // Controlled: a new tree's sizes reach the group, which otherwise keeps its own.
        useEffect(() => {
            const current = ref.current?.getLayout() ?? {};
            if (ids.some((id, idx) => Math.abs((current[id] ?? 0) - sizes[idx]) > 0.1)) {
                ref.current?.setLayout(Object.fromEntries(ids.map((id, idx) => [id, sizes[idx]])));
            }
        });

        return group({
            className: `${CLS}__split`,
            orientation: (split.type === 'column' ? 'vertical' : 'horizontal') as
                'vertical' | 'horizontal',
            groupRef: ref,
            disabled: !impl.props.editable,
            onLayoutChanged: (layout: Layout, meta) => {
                if (!meta?.isUserInteraction) return;
                impl.resize(
                    path,
                    ids.map(id => layout[id])
                );
                impl.overlay.layoutChanged();
            },
            children: children.flatMap((it, idx) => [
                idx ? separator({key: `sep-${ids[idx]}`, className: `${CLS}__separator`}) : null,
                splitPanel({
                    key: ids[idx],
                    id: ids[idx],
                    defaultSize: sizes[idx],
                    className: `${CLS}__pane`,
                    children: dockItem({impl, node: it, path: [...path, idx]})
                })
            ])
        });
    }
});

const dockStack = hoistCmp.factory<HoistProps & {impl: DockLayoutModel; stack: DockItem}>({
    displayName: 'DockStack',
    model: false,
    render({impl, stack}) {
        const {editable, renderView, viewTitle} = impl.props,
            views = (stack.content ?? []).map(it => it.id),
            active = impl.activeOf(stack),
            first = views[0],
            setEl = (el: HTMLElement) => {
                if (el) impl.stackEls.set(first, el);
                else impl.stackEls.delete(first);
            };

        return div({
            ref: setEl,
            className: `${CLS}__stack`,
            ...({'data-dock-stack': first} as object),
            children: [
                div({
                    key: 'tabs',
                    className: `${CLS}__tabs`,
                    role: 'tablist',
                    onDragOver: e => onTabsDragOver(impl, e, first),
                    onDrop: e => onDrop(impl, e),
                    children: views.map(id =>
                        div({
                            key: id,
                            className: classNames(
                                `${CLS}__tab`,
                                id === active && `${CLS}__tab--active`,
                                impl.dragging === id && `${CLS}__tab--dragging`
                            ),
                            role: 'tab',
                            tabIndex: id === active ? 0 : -1,
                            draggable: !!editable,
                            ...({'aria-selected': id === active, 'data-dock-view': id} as object),
                            onClick: () => impl.activate(id),
                            onKeyDown: e => onTabKey(impl, e, views, id),
                            onDragStart: e => {
                                e.dataTransfer.setData('text/plain', id);
                                e.dataTransfer.effectAllowed = 'move';
                                impl.startDrag(id);
                            },
                            onDragEnd: () => impl.endDrag(),
                            children: viewTitle(id)
                        })
                    )
                }),
                div({
                    key: 'body',
                    className: `${CLS}__body`,
                    onDragOver: e => onBodyDragOver(impl, e, first),
                    onDrop: e => onDrop(impl, e),
                    children: views
                        .filter(id => id === active || impl.mounted.includes(id))
                        .map(id =>
                            div({
                                key: id,
                                className: `${CLS}__view`,
                                role: 'tabpanel',
                                hidden: id !== active,
                                children: renderView(id)
                            })
                        )
                })
            ]
        });
    }
});

function keyOf(item: DockItem): string {
    if (item.type === 'view') return item.id;
    const first = (it: DockItem): string =>
        it.type === 'view' ? it.id : first(it.content?.[0] ?? {type: 'view'});
    return `${item.type}:${first(item)}`;
}

function onTabKey(
    impl: DockLayoutModel,
    e: KeyboardEvent<HTMLElement>,
    views: string[],
    id: string
) {
    const idx = views.indexOf(id),
        focus = (next: string) => {
            impl.activate(next);
            const el = e.currentTarget.parentElement?.querySelector<HTMLElement>(
                `[data-dock-view="${next}"]`
            );
            el?.focus();
        };
    let handled = true;
    if (e.altKey && e.key === 'ArrowUp') impl.reorder(id, -1);
    else if (e.altKey && e.key === 'ArrowDown') impl.reorder(id, 1);
    else if (e.key === 'ArrowLeft') focus(views[(idx - 1 + views.length) % views.length]);
    else if (e.key === 'ArrowRight') focus(views[(idx + 1) % views.length]);
    else if (e.key === 'Home') focus(views[0]);
    else if (e.key === 'End') focus(views.at(-1));
    else handled = false;
    if (handled) {
        e.preventDefault();
        e.stopPropagation();
    }
}

function rootTarget(impl: DockLayoutModel, e: DragEvent): DockTarget {
    const r = impl.rootEl?.getBoundingClientRect();
    if (!r) return null;
    const {clientX: x, clientY: y} = e;
    if (x - r.left < ROOT_EDGE) return {zone: 'root-left'};
    if (r.right - x < ROOT_EDGE) return {zone: 'root-right'};
    if (y - r.top < ROOT_EDGE) return {zone: 'root-top'};
    if (r.bottom - y < ROOT_EDGE) return {zone: 'root-bottom'};
    return null;
}

function allow(impl: DockLayoutModel, e: DragEvent, target: DockTarget, barX?: number) {
    if (!impl.dragging || !target) return;
    e.stopPropagation();
    if (impl.dragOver(target, barX)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }
}

function onRootDragOver(impl: DockLayoutModel, e: DragEvent) {
    allow(impl, e, rootTarget(impl, e));
}

function onBodyDragOver(impl: DockLayoutModel, e: DragEvent<HTMLElement>, stack: string) {
    const root = rootTarget(impl, e);
    if (root) return allow(impl, e, root);
    allow(impl, e, {
        view: stack,
        zone: zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)
    });
}

function onTabsDragOver(impl: DockLayoutModel, e: DragEvent<HTMLElement>, stack: string) {
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')].map(it =>
            it.getBoundingClientRect()
        ),
        index = tabIndexAt(tabs, e.clientX),
        stackLeft = impl.stackEls.get(stack)?.getBoundingClientRect().left ?? 0,
        barX =
            (index < tabs.length ? tabs[index].left : (tabs.at(-1)?.right ?? stackLeft)) -
            stackLeft;
    allow(impl, e, {view: stack, zone: 'tab', index}, barX);
}

function onDrop(impl: DockLayoutModel, e: DragEvent) {
    if (!impl.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    impl.dropHere();
}

// Show the views a host asks for, each time it asks.
function useShowActive(impl: DockLayoutModel, active: string[]) {
    useEffect(() => {
        (active ?? []).forEach(id => impl.activate(id));
    }, [impl, active]);
}

// Tell a host which views no tab shows, when that changes.
function useReportHidden(impl: DockLayoutModel, onHiddenChange: (ids: string[]) => void) {
    const hidden = impl.hidden,
        key = hidden.join('\u0000'),
        last = useRef<string>(null);
    useEffect(() => {
        if (key === last.current) return;
        last.current = key;
        onHiddenChange?.(hidden);
        impl.overlay.layoutChanged();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
}

// Draw the drop a drag would make, above design marks.
function usePreviewMarks(impl: DockLayoutModel) {
    useEffect(
        () =>
            impl.overlay.addMarks(`dock-${impl.xhId}`, () => {
                const {drop} = impl;
                if (!drop) return [];
                const {target, refusal, barX} = drop,
                    el = 'view' in target ? impl.stackEls.get(target.view) : impl.rootEl;
                if (!el) return [];
                return [
                    {
                        key: `dock-preview-${impl.xhId}`,
                        target: el,
                        layer: OVERLAY_LAYERS.dock,
                        render: () => preview(target, refusal, barX)
                    }
                ];
            }),
        [impl]
    );
}

function preview(target: DockTarget, refusal: string, barX: number): ReactElement {
    const zone = target.zone,
        cls = classNames(`${CLS}__preview`, refusal && `${CLS}__preview--refused`);
    if (zone === 'tab') {
        return div({className: classNames(cls, `${CLS}__preview--bar`), style: {left: barX}});
    }
    return div({
        className: classNames(cls, `${CLS}__preview--${zone}`),
        children: refusal ? div({className: `${CLS}__preview-reason`, children: refusal}) : null
    });
}
