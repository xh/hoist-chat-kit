import type {FocusEvent, KeyboardEvent as ReactKeyboardEvent} from 'react';
import {HoistModel} from '@xh/hoist/core';
import {action, observable, observableRef} from '@xh/hoist/mobx';
import {createObservableRef} from '@xh/hoist/utils/react';
import {chatAnnouncer} from '../../../../core';
import {ChatStepAnnouncer} from './ChatStepAnnouncer';

/** Below this width, in pixels, a timeline drops its step count and shortens its words. */
export const TIMELINE_NARROW_WIDTH = 480;

/** Least time a running line holds its text before it changes, in milliseconds. */
export const TIMELINE_STAGE_HOLD_MS = 1000;

/** Quiet time after which a running timeline announces what it waits on, in milliseconds. */
export const TIMELINE_QUIET_ANNOUNCE_MS = 120_000;

/**
 * Local model for a ChatTimeline: what the user opened, the block's width, the roving focus of
 * its rows, and its announcements.
 * @internal
 */
export class ChatTimelineLocalModel extends HoistModel {
    override xhImpl = true;

    /** True while the user has the block open. Collapsed by default, and never opened for them. */
    @observable accessor isExpanded = false;

    /** Rows the user opened or closed, by id - others follow their default. */
    @observableRef accessor openRows: Record<string, boolean> = {};

    /** Width of the block, in pixels, once measured. */
    @observable accessor width: number = null;

    /** Id of the row that holds the tree's one tab stop, or null for the first row. */
    @observable accessor focusId: string = null;

    readonly treeRef = createObservableRef<HTMLElement>();

    get isNarrow(): boolean {
        return this.width != null && this.width < TIMELINE_NARROW_WIDTH;
    }

    @action
    toggle() {
        this.isExpanded = !this.isExpanded;
    }

    @action
    setWidth(width: number) {
        this.width = width;
    }

    isRowOpen(id: string, defaultOpen: boolean = false): boolean {
        return this.openRows[id] ?? defaultOpen;
    }

    @action
    setRowOpen(id: string, isOpen: boolean) {
        this.openRows = {...this.openRows, [id]: isOpen};
    }

    @action
    setFocusId(id: string) {
        this.focusId = id;
    }

    //------------------
    // Running line
    //------------------
    /**
     * The text for the running line: the latest stage, once the text shown has held for a second.
     * The line re-renders each second while it runs, so a held change shows on the next tick.
     */
    holdStage(stage: string, now: number): string {
        if (stage === this.shownStage) return stage;
        if (this.shownStage == null || now - this.shownAt >= TIMELINE_STAGE_HOLD_MS) {
            this.shownStage = stage;
            this.shownAt = now;
        }
        return this.shownStage;
    }

    //------------------
    // Announcements
    //------------------
    /** Announces the block's steps as they finish - see {@link ChatStepAnnouncer}. */
    readonly steps = new ChatStepAnnouncer();

    /** Announce once, after two minutes with no event, what a running block waits on. */
    noteQuiet(quietMs: number, waitingOn: string) {
        if (quietMs == null || quietMs < TIMELINE_QUIET_ANNOUNCE_MS) {
            this.isQuietAnnounced = false;
            return;
        }
        if (this.isQuietAnnounced) return;
        this.isQuietAnnounced = true;
        chatAnnouncer.announce(waitingOn ? `Still waiting on ${waitingOn}.` : 'Still waiting.');
    }

    //------------------
    // Keyboard
    //------------------
    /**
     * Keys for the tree of rows: Up and Down move between rows, Right opens a row or enters its
     * first child, Left closes it or goes to its parent, Home and End jump to the ends, and Enter
     * or Space toggle. Escape inside a row's details returns to the row.
     */
    onTreeKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
        const target = e.target as HTMLElement,
            row = target.closest<HTMLElement>('[role="treeitem"]');
        if (!row) return;

        if (target !== row) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.focusRow(row);
            }
            return;
        }

        const rows = this.getRows(),
            idx = rows.indexOf(row),
            id = row.dataset.id,
            expanded = row.getAttribute('aria-expanded');
        let next: HTMLElement = null;
        switch (e.key) {
            case 'ArrowDown':
                next = rows[idx + 1];
                break;
            case 'ArrowUp':
                next = rows[idx - 1];
                break;
            case 'Home':
                next = rows[0];
                break;
            case 'End':
                next = rows[rows.length - 1];
                break;
            case 'ArrowRight':
                if (expanded === 'false') {
                    this.setRowOpen(id, true);
                } else if (expanded === 'true') {
                    next = row.querySelector<HTMLElement>('[role="group"] [role="treeitem"]');
                }
                break;
            case 'ArrowLeft':
                if (expanded === 'true') {
                    this.setRowOpen(id, false);
                } else {
                    next = row.parentElement?.closest<HTMLElement>('[role="treeitem"]');
                }
                break;
            case 'Enter':
            case ' ':
                if (expanded == null) return;
                this.setRowOpen(id, expanded !== 'true');
                break;
            default:
                return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (next) this.focusRow(next);
    };

    /** Keep the tab stop on the row that has focus, however it got there. */
    onTreeFocus = (e: FocusEvent<HTMLElement>) => {
        const target = e.target as HTMLElement;
        if (target.getAttribute('role') === 'treeitem') this.setFocusId(target.dataset.id);
    };

    focusRow(row: HTMLElement) {
        this.setFocusId(row.dataset.id);
        row.focus();
    }

    //------------------
    // Implementation
    //------------------
    private shownStage: string = null;
    private shownAt = 0;
    private isQuietAnnounced = false;

    private getRows(): HTMLElement[] {
        return Array.from(
            this.treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []
        );
    }
}
