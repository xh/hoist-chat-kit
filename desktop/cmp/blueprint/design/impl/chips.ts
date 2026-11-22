import {span} from '@xh/hoist/cmp/layout';
import type React from 'react';

/**
 * A chip that names a part of the blueprint and selects it: a span with the role and keys of a
 * button, which stays clear of Hoist's button styling.
 */
export function selectChip({
    key,
    className,
    text,
    label,
    onSelect
}: {
    key?: string | number;
    className: string;
    text: string;
    /** Its accessible name, where more than its text. */
    label?: string;
    onSelect: () => void;
}) {
    return span({
        key,
        className,
        role: 'button',
        tabIndex: 0,
        title: label,
        'aria-label': label,
        onClick: onSelect,
        onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
            }
        },
        children: text
    } as object);
}
