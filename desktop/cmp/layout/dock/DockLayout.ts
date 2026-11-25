import {div} from '@xh/hoist/cmp/layout';
import {elementFactory, hoistCmp, type HoistProps, useLocalModel} from '@xh/hoist/core';
import {logDebug} from '@xh/hoist/utils/js';
import classNames from 'classnames';
import {
    type DragEvent,
    type KeyboardEvent,
    type ReactElement,
    useEffect,
    useLayoutEffect,
    useRef,
    useState
} from 'react';
import {type OverlayBox, overlayHost, OVERLAY_LAYERS} from '../overlay';
import {
    Group,
    type GroupImperativeHandle,
    type GroupProps,
    type Layout,
    Panel,
    type PanelProps,
    Separator,
    type SeparatorProps
} from 'react-resizable-panels';
import './DockLayout.scss';
import {
    type DockDrop,
    DockLayoutModel,
    type DockLayoutProps,
    refusalNoteAt,
    tabIndexAt,
    zoneAt
} from './DockLayoutModel';
import type {DockItem, DockTarget} from './dockTree';

// Named apart from Hoist's own panel and separator.
const splitGroup = elementFactory<GroupProps>(Group),
    splitPanel = elementFactory<PanelProps>(Panel),
    splitSeparator = elementFactory<SeparatorProps>(Separator);

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
        const impl = useLocalModel(DockLayoutModel),
            {className, layout, active, overlay} = props;

        useShowActive(impl, active);
        usePreviewMarks(impl);
        useEffect(() => impl.followDrags(), [impl]);
        useRestoreFocus(impl);

        const body = div({
            ref: (el: HTMLDivElement) => {
                impl.rootEl = el;
            },
            className: classNames(className, impl.dragging && `${CLS}--dragging`),
            onDragOver: e => onRootDragOver(impl, e),
            onDragLeave: e => {
                // An external drag leaving the layout drops nothing here.
                const to = e.relatedTarget as Node;
                if (!impl.dragging && !(to && impl.rootEl?.contains(to))) impl.endDrag();
            },
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
            ids = children.map(keyOf),
            orientation: GroupProps['orientation'] =
                split.type === 'column' ? 'vertical' : 'horizontal';

        // Controlled: a new tree's sizes reach the group, which otherwise keeps its own.
        useEffect(() => {
            const current = ref.current?.getLayout() ?? {};
            if (ids.some((id, idx) => Math.abs((current[id] ?? 0) - sizes[idx]) > 0.1)) {
                try {
                    ref.current?.setLayout(
                        Object.fromEntries(ids.map((id, idx) => [id, sizes[idx]]))
                    );
                } catch (e) {
                    // A group still registering its panels takes the sizes on its next draw.
                    logDebug(['Sizes not yet applied', e], 'DockLayout');
                }
            }
        });

        return splitGroup({
            className: `${CLS}__split`,
            orientation,
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
                idx
                    ? splitSeparator({
                          key: `sep-${ids[idx]}`,
                          className: `${CLS}__separator`,
                          disabled: !impl.props.editable
                      })
                    : null,
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
        const {editable, viewRenderer, viewTitle, tabProps} = impl.props,
            views = (stack.content ?? []).map(it => it.id),
            active = impl.activeOf(stack),
            drawn = views.filter(id => id === active || impl.mounted.includes(id)),
            first = views[0],
            setEl = (el: HTMLElement) => {
                if (el) impl.stackEls.set(first, el);
                else impl.stackEls.delete(first);
            };

        return div({
            ref: setEl,
            className: `${CLS}__stack`,
            ...{'data-dock-stack': first},
            children: [
                div({
                    key: 'tabs',
                    className: `${CLS}__tabs`,
                    role: 'tablist',
                    onDragOver: e => onTabsDragOver(impl, e, first),
                    onDrop: e => onDrop(impl, e),
                    children: views.map(id =>
                        div({
                            ...tabProps?.(id),
                            key: id,
                            className: classNames(
                                `${CLS}__tab`,
                                id === active && `${CLS}__tab--active`,
                                impl.dragging === id && `${CLS}__tab--dragging`
                            ),
                            role: 'tab',
                            id: tabId(impl, id),
                            'aria-controls': drawn.includes(id) ? panelId(impl, id) : null,
                            tabIndex: id === active ? 0 : -1,
                            draggable: !!editable,
                            'aria-selected': id === active,
                            ...{'data-dock-view': id},
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
                    children: drawn.map(id =>
                        div({
                            key: id,
                            className: `${CLS}__view`,
                            role: 'tabpanel',
                            id: panelId(impl, id),
                            'aria-labelledby': tabId(impl, id),
                            hidden: id !== active,
                            children: viewRenderer(id)
                        })
                    )
                })
            ]
        });
    }
});

// Ids that tie each view's panel to its tab, unique to the layout.
const tabId = (impl: DockLayoutModel, view: string) => `${impl.xhId}-tab-${view}`,
    panelId = (impl: DockLayoutModel, view: string) => `${impl.xhId}-panel-${view}`;

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
    if (!impl.stacks.length) return {zone: 'root'};
    const {clientX: x, clientY: y} = e;
    if (x - r.left < ROOT_EDGE) return {zone: 'root-left'};
    if (r.right - x < ROOT_EDGE) return {zone: 'root-right'};
    if (y - r.top < ROOT_EDGE) return {zone: 'root-top'};
    if (r.bottom - y < ROOT_EDGE) return {zone: 'root-bottom'};
    return null;
}

function allow(impl: DockLayoutModel, e: DragEvent, target: DockTarget, barX?: number) {
    if ((!impl.dragging && !impl.external) || !target) return;
    if (!impl.dragging && impl.props.acceptsDragAt?.(e.nativeEvent) === false) return;
    e.stopPropagation();
    const el = 'view' in target ? impl.stackEls.get(target.view) : impl.rootEl,
        r = el?.getBoundingClientRect(),
        point = r ? {x: e.clientX - r.left, y: e.clientY - r.top} : null;
    // Left refused, the browser draws its not-allowed cursor.
    if (impl.dragOver(target, barX, point)) {
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
    if (!impl.dragging && !impl.external) return;
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

// Focus a tab a keyboard move asked to keep focused, once the layout has drawn again.
function useRestoreFocus(impl: DockLayoutModel) {
    useLayoutEffect(() => {
        const id = impl.pendingFocus;
        if (!id) return;
        const el = impl.rootEl?.querySelector<HTMLElement>(`[role=tab][data-dock-view="${id}"]`);
        if (!el) return;
        impl.pendingFocus = null;
        if (document.activeElement !== el) el.focus();
    });
}

// Draw the drop a drag would make, above design marks.
function usePreviewMarks(impl: DockLayoutModel) {
    useEffect(
        () =>
            impl.overlay.addMarks(`dock-${impl.xhId}`, () => {
                const {drop} = impl,
                    showRefused = !!impl.props.showRefusedZones;
                if (!drop || (drop.refusal && !showRefused && !drop.reason)) return [];
                const el =
                    'view' in drop.target ? impl.stackEls.get(drop.target.view) : impl.rootEl;
                if (!el) return [];
                return [
                    {
                        key: `dock-preview-${impl.xhId}`,
                        target: el,
                        layer: OVERLAY_LAYERS.dock,
                        render: box =>
                            drop.refusal && !showRefused ? refusalNote({drop, box}) : preview(drop)
                    }
                ];
            }),
        [impl]
    );
}

// A refusal's reason, beside the pointer, which shows the browser's not-allowed cursor. Measured
// once drawn, so it flips to stay within what the overlay shows.
const refusalNote = hoistCmp.factory<HoistProps & {drop: DockDrop; box: OverlayBox}>({
    displayName: 'DockRefusalNote',
    model: false,
    render({drop, box}) {
        const ref = useRef<HTMLDivElement>(null),
            [size, setSize] = useState({width: 0, height: 0});
        useLayoutEffect(() => {
            const el = ref.current;
            if (el && (el.offsetWidth !== size.width || el.offsetHeight !== size.height)) {
                setSize({width: el.offsetWidth, height: el.offsetHeight});
            }
        });
        return div({
            ref,
            className: `${CLS}__refusal`,
            style: refusalNoteAt(drop.point, size, box),
            children: drop.reason
        });
    }
});

function preview({target, refusal, barX}: DockDrop): ReactElement {
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
