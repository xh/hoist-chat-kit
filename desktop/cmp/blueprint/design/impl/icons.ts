import {Icon} from '@xh/hoist/icon';
import type {ReactElement} from 'react';
import type {WidgetSpec} from '../../../../../blueprint';
import {getOwn} from '../../../../../blueprint/impl/pointer';

/** A widget's icon: the one its spec names, else its category's. */
export function widgetIcon(
    spec: Pick<WidgetSpec, 'icon' | 'category'>,
    props: {className?: string} = {}
): ReactElement {
    const named = spec?.icon && getOwn(Icon, spec.icon),
        factory = named ?? (Icon as any)[CATEGORY_ICONS[spec?.category]] ?? Icon.square;
    return factory(props);
}

/** The icon of a part of a blueprint: a widget's for an element, else its kind's. */
export function partIcon(
    kind: 'element' | 'source' | 'variable' | 'preset',
    spec: Pick<WidgetSpec, 'icon' | 'category'>,
    props: {className?: string} = {}
): ReactElement {
    switch (kind) {
        case 'source':
            return Icon.database(props);
        case 'variable':
            return Icon.tag(props);
        case 'preset':
            return Icon.gear(props);
        default:
            return widgetIcon(spec, props);
    }
}

const CATEGORY_ICONS: Record<string, string> = {
    container: 'folder',
    layout: 'square',
    content: 'fileText',
    data: 'chartBar',
    input: 'edit',
    action: 'bolt'
};
