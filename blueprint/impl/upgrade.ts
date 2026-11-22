import type {PlainObject} from '@xh/hoist/core';
import {isEmpty, omit} from 'lodash';
import type {BlueprintElement} from '../Blueprint';
import {upgradeSlots} from './elements';

/**
 * A blueprint in the current format, from one written in an older form. The same blueprint if it
 * needs nothing.
 */
export function upgradeBlueprint<T extends {elements?: Record<string, BlueprintElement>}>(
    bp: T
): T {
    return upgradeSummaryRow(upgradeSlots(bp));
}

//------------------
// Implementation
//------------------
// A grid's `summaryRow: true` became `showSummary: 'top'`, as Hoist's GridModel names it.
function upgradeSummaryRow<T extends {elements?: Record<string, BlueprintElement>}>(bp: T): T {
    const old = (el: BlueprintElement) =>
        el.component === 'cubeGrid' && el.config && 'summaryRow' in el.config;
    if (!Object.values(bp?.elements ?? {}).some(old)) return bp;
    const elements = Object.fromEntries(
        Object.entries(bp.elements).map(([id, el]) => {
            if (!old(el)) return [id, el];
            const {summaryRow} = el.config as PlainObject,
                config: PlainObject = omit(el.config, 'summaryRow');
            if (summaryRow === true) config.showSummary = 'top';
            else if (summaryRow && summaryRow !== false) config.showSummary = summaryRow;
            return [id, {...el, config: isEmpty(config) ? undefined : config}];
        })
    );
    return {...bp, elements};
}
