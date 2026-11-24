import {describe, expect, it} from 'vitest';
import {SETTING_GROUPS} from '../BlueprintSchema';
import {BUILT_IN_WIDGETS} from './builtInWidgets';

// Sections that show more than four common settings, each with its reason.
const CROWDED_SECTIONS: Record<string, string> = {
    'statCard.content':
        "Label and format, then the change's field, format and label, which read as one group."
};

const WIDGETS = BUILT_IN_WIDGETS.filter(it => !it.reserved),
    propsOf = (spec: (typeof WIDGETS)[number]) =>
        Object.entries<any>((spec.config?.properties as object) ?? {});

describe('Built-in widget schemas', () => {
    it('put every property in one of the six setting groups', () => {
        const ungrouped = WIDGETS.flatMap(spec =>
            propsOf(spec)
                .filter(([, prop]) => !SETTING_GROUPS.includes(prop['x-group']))
                .map(([key]) => `${spec.name}.${key}`)
        );
        expect(ungrouped).toEqual([]);
    });

    it('show at most four common settings in a section, unless a reason allows more', () => {
        const crowded = WIDGETS.flatMap(spec => {
            const common = propsOf(spec).filter(([, prop]) => !prop['x-advanced']);
            return SETTING_GROUPS.map(group => ({
                section: `${spec.name}.${group}`,
                count: common.filter(([, prop]) => prop['x-group'] === group).length
            }));
        }).filter(it => it.count > 4 && !CROWDED_SECTIONS[it.section]);
        expect(crowded).toEqual([]);
    });
});
