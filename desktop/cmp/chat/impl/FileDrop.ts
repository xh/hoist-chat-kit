import {createContext, type DragEvent, type ReactNode} from 'react';
import {div, span} from '@xh/hoist/cmp/layout';
import {elementFactory, HoistModel} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {action, observable} from '@xh/hoist/mobx';
import type {ChatComposerModel} from '../../../../core';
import classNames from 'classnames';
import {isEmpty} from 'lodash';
import './FileDrop.scss';

/**
 * True if a drag carries files from outside the page.
 * @internal
 */
export function hasFiles(e: DragEvent): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Refuse a file dragged over or dropped on a chat surface that does not take files. Without this,
 * a file dropped a few pixels off the composer lands on the page, and the browser opens it in
 * place of the app. Leaves alone an event that a drop zone within - the composer - has handled.
 * A surface inside a drop zone, such as a message list in a `ChatPanel`, leaves files to the zone.
 * @internal
 */
export function refuseFileDrop(e: DragEvent) {
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none';
}

/**
 * True within a component that takes file drops for its composer, as `ChatPanel` does. The
 * composer and the message list then leave dragged files to it, so that one zone and one hint
 * show.
 * @internal
 */
export const FileDropZoneContext = createContext(false);

/** @internal */
export const fileDropZoneProvider = elementFactory(FileDropZoneContext.Provider);

/**
 * The hint shown over a drop zone while files are dragged over it: an icon and a line of text,
 * with an optional tip below, such as the composer's attachment rules. Each zone sizes and
 * arranges them to suit its own area.
 * @internal
 */
export function fileDropHint(className: string, tip: string = null): ReactNode {
    return div({
        key: 'dropHint',
        className: classNames('xh-chat-drop-hint', className),
        children: [
            div({className: 'xh-chat-drop-hint__icon', children: Icon.paperclip()}),
            span({className: 'xh-chat-drop-hint__text', children: 'Drop files to attach'}),
            tip ? span({className: 'xh-chat-drop-hint__tip', children: tip}) : null
        ]
    });
}

/**
 * A zone that takes dropped files for a composer: its drag handlers, and whether files are over
 * it. Adds the files to the composer if it takes attachments, and otherwise refuses the drop, so
 * that the browser never opens the file in place of the app. Ignores a drag with no files, such
 * as one of text, and an event that a drop zone within it has handled, such as an app's own file
 * chooser in a reply.
 * @internal
 */
export class FileDropModel extends HoistModel {
    override xhImpl = true;

    /** True while files are dragged over the zone, for a composer that takes them. (observable) */
    @observable accessor isDragging = false;

    /** @param getComposerModel - returns the composer to add files to, read on each event. */
    constructor(private readonly getComposerModel: () => ChatComposerModel) {
        super();
    }

    /** The drag handlers, to spread on the zone's element. */
    get handlers() {
        const {onDragEnter, onDragOver, onDragLeave, onDrop} = this;
        return {onDragEnter, onDragOver, onDragLeave, onDrop};
    }

    onDragEnter = (e: DragEvent) => {
        if (!hasFiles(e) || e.defaultPrevented) return;
        e.preventDefault();
        if (!this.enabled) return;
        if (!this.entered.includes(e.target)) this.entered.push(e.target);
        this.setDragging(true);
    };

    onDragOver = (e: DragEvent) => {
        if (!hasFiles(e) || e.defaultPrevented) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = this.enabled ? 'copy' : 'none';
    };

    onDragLeave = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        // An element removed mid-drag, as a streaming reply re-renders, never reports its leave
        // to the zone. Forget any that have left the zone's tree, or the hint would stick.
        const zone = e.currentTarget;
        this.entered = this.entered.filter(it => it !== e.target && zone.contains(it as Node));
        if (isEmpty(this.entered)) this.setDragging(false);
    };

    onDrop = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        this.entered = [];
        this.setDragging(false);
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (!this.enabled) return;

        const composerModel = this.getComposerModel();
        composerModel.addFilesAsync(Array.from(e.dataTransfer.files)).catchDefault();
        composerModel.focus();
    };

    //------------------
    // Implementation
    //------------------
    // Drag events fire on every child crossed, so the drag has left once every element it
    // entered has reported a leave.
    private entered: EventTarget[] = [];

    private get enabled(): boolean {
        return !!this.getComposerModel()?.enableAttachments;
    }

    @action
    private setDragging(isDragging: boolean) {
        this.isDragging = isDragging;
    }
}
