import {chip} from '@xh/hoist/cmp/chip';
import type {Intent} from '@xh/hoist/core';
import classNames from 'classnames';

/** What a chip names, which sets its color. */
export type ChipKind = 'variable' | 'source' | 'element' | 'set' | 'preset';

/**
 * A Hoist chip that names a part of the blueprint in its kind's color, and selects it on a click.
 * With `onRemove`, it also takes the part away, such as a binding, from its remove button or
 * Backspace and Delete.
 */
export function selectChip({
    key,
    className,
    kind = 'element',
    text,
    label,
    onSelect,
    onRemove,
    removeHint
}: {
    key?: string | number;
    className?: string;
    kind?: ChipKind | string;
    text: string;
    /** Its accessible name and tooltip, where more than its text. */
    label?: string;
    onSelect?: () => void;
    onRemove?: () => void;
    /** What Delete does, for its name and tooltip, such as "Delete unbinds.". */
    removeHint?: string;
}) {
    const name = [label, onRemove ? (removeHint ?? 'Delete removes it.') : null]
        .filter(Boolean)
        .join(' ');
    return chip({
        key,
        className: classNames('xh-font-family-mono', className),
        minimal: true,
        size: 'compact',
        intent: INTENTS[kind] ?? null,
        // Hoist has no purple intent.
        color: kind === 'preset' ? 'var(--xh-purple)' : null,
        title: name || null,
        // Its remove button is hidden from assistive tech, so the chip says which keys remove it.
        domAttrs: {
            ...(name ? {'aria-label': name} : {}),
            ...(onRemove ? {'aria-keyshortcuts': 'Delete Backspace'} : {})
        },
        onClick: onSelect ? () => onSelect() : null,
        onRemove: onRemove ? () => onRemove() : null,
        children: text
    });
}

const INTENTS: Record<string, Intent> = {
    variable: 'primary',
    source: 'success',
    set: 'warning'
};
