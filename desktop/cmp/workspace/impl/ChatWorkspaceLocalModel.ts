import {HoistModel, lookup} from '@xh/hoist/core';
import {action, observable} from '@xh/hoist/mobx';
import {wait} from '@xh/hoist/promise';
import {createObservableRef} from '@xh/hoist/utils/react';
import {ChatWorkspaceModel} from '../ChatWorkspaceModel';

/**
 * Local model for a ChatWorkspace: the history popover of a narrow workspace, and focus moves
 * between the rail and the sidebar's search.
 *
 * @internal
 */
export class ChatWorkspaceLocalModel extends HoistModel {
    override xhImpl = true;

    @lookup(ChatWorkspaceModel) private model: ChatWorkspaceModel;

    /** True while the history popover is open. (observable) */
    @observable accessor isHistoryOpen = false;

    /** The sidebar's search input. */
    readonly searchInputRef = createObservableRef<HTMLInputElement>();

    override onLinked() {
        // Choosing a thread, or starting one, closes the history popover.
        this.addReaction({
            track: () => this.model.threadsModel.selectedThreadId,
            run: () => this.setHistoryOpen(false)
        });
    }

    @action
    setHistoryOpen(isOpen: boolean) {
        this.isHistoryOpen = isOpen;
    }

    /** Expand the sidebar from its rail, and focus its search input. */
    openSearch() {
        this.model.expandSidebar();
        wait().then(() => this.searchInputRef.current?.focus());
    }
}
