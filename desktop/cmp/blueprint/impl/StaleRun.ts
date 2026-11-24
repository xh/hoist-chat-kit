import {hbox, span} from '@xh/hoist/cmp/layout';
import {hoistCmp, type HoistProps} from '@xh/hoist/core';
import {button} from '@xh/hoist/desktop/cmp/button';
import {Icon} from '@xh/hoist/icon';
import type React from 'react';
import type {BlueprintModel, BlueprintSource} from '../../../../blueprint';
import {parentOf} from '../../../../blueprint/impl/elements';

/**
 * A manual source's stale marker and Run button, while its rows are for inputs no longer set.
 * Draws nothing otherwise.
 * @internal
 */
export const staleRunControl = hoistCmp.factory<HoistProps & {source: BlueprintSource}>({
    displayName: 'BlueprintStaleRun',
    model: false,
    render({source, className}) {
        if (!source?.isStale || source.isLoading) return null;
        return hbox({
            className: ['xh-blueprint-view__stale', className].filter(Boolean).join(' '),
            alignItems: 'center',
            items: [
                span('Inputs changed'),
                button({
                    text: 'Run',
                    icon: Icon.play(),
                    intent: 'primary',
                    onClick: (e: React.MouseEvent) => {
                        e.stopPropagation();
                        source.reloadAsync().catchDefault();
                    }
                })
            ]
        });
    }
});

/** True for an element that draws as a dashboard cell with a header, where its header items go. */
export function hasCellHeader(blueprintModel: BlueprintModel, id: string): boolean {
    const elements = blueprintModel.effective?.elements ?? {},
        parent = elements[parentOf(elements, id)];
    if (parent?.component !== 'dashboard') return false;
    const ref = (parent.children ?? []).find(it => it.id === id);
    return !!ref && !ref.hideHeader;
}
