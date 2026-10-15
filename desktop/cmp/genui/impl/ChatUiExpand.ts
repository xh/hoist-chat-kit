import type {ReactNode} from 'react';
import {hoistCmp, HoistModel, type HoistProps, XH} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {dialog} from '@xh/hoist/kit/blueprint';
import {action, observableRef, untracked} from '@xh/hoist/mobx';
import {
    type ChatChartRequest,
    type ChatSidePanelHost,
    type ChatTableRequest,
    isChatSidePanelHost
} from '../../../../core';
import type {ChatArtifactRegistry} from '../../../../genui';
import {chatUiChartView} from '../ChatUiChartView';
import {chatUiTableView} from '../ChatUiTableView';
import './ChatUiExpand.scss';

/** A request a result card opens in the side panel, or in a dialog. @internal */
export type ChatUiExpandRequest = ChatTableRequest | ChatChartRequest;

/**
 * The local model of a card that opens its full tier: in the side panel of the chat when one is
 * in model context with room, else in a dialog (D69). The card shows its request as
 * open while the panel shows it.
 * @internal
 */
export class ChatUiExpandModel extends HoistModel {
    override xhImpl = true;

    /** The request open in a dialog, or null. */
    @observableRef accessor dialogRequest: ChatUiExpandRequest = null;

    /** The request this card last opened in the side panel, or null. */
    @observableRef accessor panelRequest: ChatUiExpandRequest = null;

    /** The side panel in model context, or null. */
    sidePanel: ChatSidePanelHost = null;

    /** True while the side panel shows this card's request. */
    get isOpenInPanel(): boolean {
        const {panelRequest, sidePanel} = this;
        return panelRequest != null && sidePanel?.request === panelRequest;
    }

    override onLinked() {
        this.sidePanel = untracked(() =>
            this.lookupModel(isChatSidePanelHost)
        ) as unknown as ChatSidePanelHost;
    }

    /** Open a request in the side panel if it can show it now, else in a dialog. */
    @action
    expand(request: ChatUiExpandRequest, opener: HTMLElement = null) {
        const {sidePanel} = this;
        if (sidePanel?.canOpen(request)) {
            sidePanel.open(request, opener);
            this.panelRequest = request;
        } else {
            this.dialogRequest = request;
        }
    }

    @action
    closeDialog() {
        this.dialogRequest = null;
    }

    override destroy() {
        XH.safeDestroy(this.ownedRegistry);
        super.destroy();
    }

    //------------------
    // Implementation
    //------------------
    // The registry the card made for rows written inline, if any - see `setInlineRegistry()`.
    private ownedRegistry: ChatArtifactRegistry = null;

    /**
     * Take a registry made for rows written inline, in place of the last. The last is destroyed,
     * unless the side panel or the dialog still shows it - then with this model. An inline
     * registry has no data source, so a view may still read its rows once it is destroyed.
     */
    protected setInlineRegistry(registry: ChatArtifactRegistry): ChatArtifactRegistry {
        const prior = this.ownedRegistry;
        this.ownedRegistry = registry;
        if (prior) {
            const isShown = [this.dialogRequest, this.sidePanel?.request].some(
                it => it != null && 'registry' in it && it.registry === prior
            );
            if (isShown) {
                this.markManaged(prior);
            } else {
                prior.destroy();
            }
        }
        return registry;
    }
}

/**
 * The dialog that shows a card's full tier where the chat has no side panel.
 * @internal
 */
export const chatUiExpandDialog = hoistCmp.factory<
    HoistProps & {request: ChatUiExpandRequest; onClose: () => void}
>({
    displayName: 'ChatUiExpandDialog',
    model: false,

    render({request, onClose}) {
        const isTable = request.type === 'table',
            title = request.title || (isTable ? 'Table' : 'Chart');
        return dialog({
            className: 'xh-chat-ui-expand-dialog',
            title,
            icon: isTable ? Icon.grid() : Icon.chartLine(),
            isOpen: true,
            canOutsideClickClose: true,
            onClose,
            item: isTable
                ? chatUiTableView({request: request as ChatTableRequest})
                : chatUiChartView({request: request as ChatChartRequest})
        });
    }
});

/** The dialog of a card's model, if one is open - for the card to render. @internal */
export function expandDialog(model: ChatUiExpandModel): ReactNode {
    const {dialogRequest} = model;
    return dialogRequest
        ? chatUiExpandDialog({request: dialogRequest, onClose: () => model.closeDialog()})
        : null;
}
