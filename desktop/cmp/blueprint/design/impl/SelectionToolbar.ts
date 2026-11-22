import {div, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps, type MenuItemLike} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {menuButton} from '@xh/hoist/desktop/cmp/menu';
import {Icon} from '@xh/hoist/icon';
import {wait} from '@xh/hoist/promise';
import {useRef} from 'react';
import type {BlueprintDesignModel, BlueprintIssue} from '../../../../../blueprint';
import {addWidgetAt, duplicateElement, removeElementAsync} from './designActions';

interface SelectionToolbarProps extends HoistProps {
    designModel: BlueprintDesignModel;
    id: string;
}

/**
 * The selected element's toolbar on the canvas: select its parent, its name, then for a writer
 * duplicate, add, more and delete. Its clicks never reach the canvas, which would select again.
 */
export const selectionToolbar = hoistCmp.factory<SelectionToolbarProps>({
    displayName: 'BlueprintSelectionToolbar',
    className: 'xh-blueprint-selection-toolbar',
    model: false,
    render({designModel, id, className}) {
        const ref = useRef<HTMLDivElement>(null),
            // Back to the canvas once an action settles, so the design keys keep working, and a
            // dialog it opens, such as a confirm, keeps focus until then. The canvas is found
            // first, as the action can take the toolbar away.
            after = (result: unknown) => {
                const surface = ref.current?.closest<HTMLElement>('.xh-panel__content[tabindex]');
                return Promise.resolve(result).finally(() => wait().then(() => surface?.focus()));
            },
            withRefocus = (items: MenuItemLike[]): MenuItemLike[] =>
                items.map(it =>
                    typeof it === 'object' && 'text' in it
                        ? {
                              ...it,
                              ...(it.actionFn
                                  ? {
                                        actionFn: (...args) => {
                                            after(it.actionFn(...args));
                                        }
                                    }
                                  : {}),
                              ...(it.items ? {items: withRefocus(it.items)} : {})
                          }
                        : it
                ),
            {blueprintModel} = designModel,
            {registry} = blueprintModel,
            labelOf = (component: string) => registry.widgets[component]?.label ?? component,
            component = blueprintModel.blueprint?.elements?.[id]?.component,
            parent = designModel.pathTo(id).at(-1) ?? null,
            canEdit = blueprintModel.mode === 'design' && blueprintModel.access === 'write',
            refuse = (issues: BlueprintIssue[]) => {
                const error = issues.find(it => it.severity === 'error');
                if (error) blueprintModel.showRefusal(error);
            },
            addItems = (): MenuItemLike[] => {
                const places = designModel.addPlacesFor(id),
                    itemsOf = ({place, widgets}: (typeof places)[number]): MenuItemLike[] =>
                        widgets.map(it => ({
                            text: labelOf(it),
                            actionFn: () => addWidgetAt(designModel, it, place)
                        }));
                return places.flatMap(it => [{heading: it.label}, ...itemsOf(it)]);
            },
            moreItems = (): MenuItemLike[] => [
                {
                    text: 'Move earlier',
                    icon: Icon.arrowUp(),
                    disabled: !designModel.siblingOf(id, -1),
                    actionFn: () => refuse(designModel.reorder(id, -1).issues)
                },
                {
                    text: 'Move later',
                    icon: Icon.arrowDown(),
                    disabled: !designModel.siblingOf(id, 1),
                    actionFn: () => refuse(designModel.reorder(id, 1).issues)
                },
                {
                    text: 'Move to',
                    disabled: !parent,
                    items: designModel.slotsFor(id).map(({slot, of}) => ({
                        text: `${of ?? parent} ${slot === 'headerItems' ? 'header' : slot}`,
                        actionFn: () => refuse(designModel.moveToSlot(id, slot, of).issues)
                    }))
                },
                {
                    text: 'Wrap in panel',
                    disabled: !parent,
                    actionFn: () => refuse(designModel.wrapInPanel(id).issues)
                },
                '-',
                {
                    text: 'Copy id',
                    icon: Icon.copy(),
                    actionFn: () => navigator.clipboard?.writeText(id)
                }
            ];
        return div({
            className,
            ref,
            onClick: e => e.stopPropagation(),
            children: [
                button({
                    icon: Icon.arrowUp(),
                    title: 'Select the parent (Esc)',
                    'aria-label': 'Select the parent (Esc)',
                    minimal: true,
                    disabled: !parent,
                    onClick: () => after(designModel.select({kind: 'element', id: parent}))
                }),
                span({
                    className: `${CLS}__name`,
                    children: component ? `${id} · ${labelOf(component)}` : id
                }),
                ...(canEdit
                    ? [
                          button({
                              icon: Icon.copy(),
                              title: 'Duplicate (Ctrl+D)',
                              'aria-label': 'Duplicate (Ctrl+D)',
                              minimal: true,
                              disabled: !parent,
                              onClick: () => after(duplicateElement(designModel, id))
                          }),
                          designModel.addPlacesFor(id).length
                              ? menuButton({
                                    className: `${CLS}__menu`,
                                    icon: Icon.add(),
                                    title: 'Add',
                                    'aria-label': 'Add',
                                    minimal: true,
                                    menuItems: () => withRefocus(addItems())
                                })
                              : null,
                          menuButton({
                              className: `${CLS}__menu`,
                              icon: Icon.ellipsisVertical(),
                              title: 'More',
                              'aria-label': 'More',
                              minimal: true,
                              menuItems: () => withRefocus(moreItems())
                          }),
                          button({
                              icon: Icon.delete(),
                              title: 'Delete (Del)',
                              'aria-label': 'Delete (Del)',
                              intent: 'danger',
                              minimal: true,
                              onClick: () => after(removeElementAsync(designModel, id).then(refuse))
                          })
                      ]
                    : [])
            ]
        });
    }
});

const CLS = 'xh-blueprint-selection-toolbar';
