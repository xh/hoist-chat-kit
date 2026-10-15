import {div} from '@xh/hoist/cmp/layout';
import {hoistCmp, HoistModel, type HoistProps, managed, useLocalModel, uses} from '@xh/hoist/core';
import {panel, PanelModel} from '@xh/hoist/desktop/cmp/panel';
import {useHotkeys} from '@xh/hoist/desktop/hooks';
import {debounce} from 'lodash';
import {useComposedRefs} from '@xh/hoist/utils/react';
import {type ReactElement, type RefCallback, useCallback} from 'react';
import {ChatAssistantModel} from '../../../assist';
import {classNames} from '../../../impl/ClassNames';
import '../../../styles/vars.scss';
import {getChatHotkeys} from '../../impl/ChatShortcuts';
import './ChatAssistant.scss';
import {chatAssistantView, type ChatAssistantViewProps} from './ChatAssistantView';

/** Props for {@link ChatAssistantContainer}. */
export interface ChatAssistantContainerProps extends HoistProps<ChatAssistantModel> {
    /** Icon of the helper. Default `ChatKit.defaults.assistantIcon`. */
    assistantIcon?: ReactElement;

    /** Props for the helper, when it docks here. */
    viewProps?: Omit<ChatAssistantViewProps, 'model' | 'modelConfig' | 'modelRef'>;
}

/**
 * The body of a component with a helper. Put it in the component's `Panel`, around the content
 * under the header, as its `item` or `items` - and the helper's {@link ChatAssistantButton} last in the header's items:
 *
 * ```ts
 * panel({
 *     title: 'Positions',
 *     headerItems: [refreshButton(), chatAssistantButton({model: assistantModel})],
 *     item: chatAssistantContainer({
 *         model: assistantModel,
 *         items: [toolbar(...), grid({model: gridModel})]
 *     })
 * });
 * ```
 *
 * At the helper model's `dockMinWidth` or wider - 740 px by default - the open helper docks on the
 * right, under the header, with a splitter. It takes 360 to 420 px from the component, not from
 * the page, and its width persists per kind of component. Narrower, the helper opens in a
 * popover from its button. The container measures its own box, so a grid in a dialog or a
 * dashboard widget decides by its own width, not the window's, and switches mode live without
 * losing the conversation.
 *
 * With focus anywhere inside, Ctrl/Cmd+I opens or closes the helper - see
 * `ChatKit.defaults.shortcuts.openHelper`.
 *
 * Hoist's `Panel` has no side slot under its header, which puts its toolbars across the full
 * width, so the container lays out the content and the helper itself.
 */
export const [ChatAssistantContainer, chatAssistantContainer] =
    hoistCmp.withFactory<ChatAssistantContainerProps>({
        displayName: 'ChatAssistantContainer',
        model: uses(ChatAssistantModel),
        className: 'xh-chat-assistant-container',

        render({model, className, children, assistantIcon, viewProps}, ref) {
            const impl = useLocalModel(ChatAssistantContainerLocalModel),
                rootRef = useComposedRefs(ref, useComponentWidth(model));
            impl.ensureDockModel(model.kind);

            return useHotkeys(
                div({
                    ref: rootRef,
                    className: classNames(className, {
                        [`${className}--docked`]: model.isDockOpen
                    }),
                    items: [
                        div({
                            key: 'body',
                            className: `${className}__body`,
                            item: children
                        }),
                        model.isDockOpen
                            ? panel({
                                  key: 'dock',
                                  model: impl.dockModel,
                                  className: `${className}__dock`,
                                  item: chatAssistantView({model, assistantIcon, ...viewProps})
                              })
                            : null
                    ]
                }),
                model.isEnabled ? impl.getHotkeys(model) : []
            );
        }
    });

//------------------
// Implementation
//------------------
class ChatAssistantContainerLocalModel extends HoistModel {
    override xhImpl = true;

    /** The docked helper's resizable panel - its width persists per kind of component. */
    @managed dockModel: PanelModel = null;

    ensureDockModel(kind: string) {
        if (this.dockModel) return;
        this.dockModel = new PanelModel({
            side: 'right',
            defaultSize: DOCK_WIDTH,
            minSize: DOCK_MIN_WIDTH,
            maxSize: DOCK_MAX_WIDTH,
            collapsible: false,
            resizable: true,
            persistWith: {localStorageKey: `xhChatAssistant.${kind}`, path: 'dock'}
        });
    }

    getHotkeys(model: ChatAssistantModel) {
        return getChatHotkeys({openHelper: () => model.toggle()});
    }
}

// The docked helper's width, which the user can resize within the bounds.
const DOCK_WIDTH = 380,
    DOCK_MIN_WIDTH = 360,
    DOCK_MAX_WIDTH = 420;

/**
 * A callback ref that reports the element's width to the helper model, as it mounts and on each
 * resize - at once, and again once a burst settles.
 */
function useComponentWidth(model: ChatAssistantModel): RefCallback<HTMLElement> {
    return useCallback(
        (node: HTMLElement) => {
            if (!node) return undefined;
            // A hidden element measures 0 wide. It keeps its last width until it shows again.
            const report = (width: number) => {
                if (width > 0) model.setComponentWidth(width);
            };
            report(node.getBoundingClientRect().width);

            const onResize = debounce(
                    (entries: ResizeObserverEntry[]) =>
                        report(entries[entries.length - 1].contentRect.width),
                    100,
                    {leading: true, trailing: true}
                ),
                observer = new ResizeObserver(onResize);
            observer.observe(node);
            return () => {
                observer.disconnect();
                onResize.cancel();
            };
        },
        [model]
    );
}
