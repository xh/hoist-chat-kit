import type {DragEvent} from 'react';

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
 * @internal
 */
export function refuseFileDrop(e: DragEvent) {
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none';
}
