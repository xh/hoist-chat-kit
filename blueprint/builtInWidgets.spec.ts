import {difference} from 'lodash';
import {describe, expect, it} from 'vitest';
import {SETTING_GROUPS} from './BlueprintSchema';
import {BUILT_IN_WIDGETS} from './builtInWidgets';

// Sections that show more than four common settings, each with its reason.
const CROWDED_SECTIONS: Record<string, string> = {
    'statCard.content':
        "Label and format, then the change's field, format and label, which read as one group."
};

const WIDGETS = BUILT_IN_WIDGETS.filter(it => !it.reserved),
    propsOf = (spec: (typeof WIDGETS)[number]) =>
        Object.entries<any>((spec.config?.properties as object) ?? {});

// Every property of a schema, nested and in list items included, by its path.
function allProps(schema: any, path: string, out: [string, any][] = []): [string, any][] {
    if (!schema || typeof schema !== 'object') return out;
    Object.entries<any>(schema.properties ?? {}).forEach(([key, prop]) => {
        out.push([`${path}.${key}`, prop]);
        allProps(prop, `${path}.${key}`, out);
    });
    if (schema.items) allProps(schema.items, `${path}[]`, out);
    if (typeof schema.additionalProperties === 'object') {
        allProps(schema.additionalProperties, `${path}{}`, out);
    }
    schema.anyOf?.forEach((it: any) => allProps(it, path, out));
    return out;
}

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

    it('give each list item its groups, its common settings and its summary', () => {
        const grid = WIDGETS.find(it => it.name === 'cubeGrid').config as any,
            columnState = grid.properties.columnState.items.anyOf[1],
            items: [string, any, object?][] = [
                ['cubeGrid.columns', grid.properties.columns.additionalProperties, columnState],
                [
                    'cubeGrid.columns.styles',
                    grid.properties.columns.additionalProperties.properties.styles.items
                ],
                ['cubeGrid.rowStyles', grid.properties.rowStyles.items],
                ['cubeGrid.rowActions', grid.properties.rowActions.items],
                ...['propertyTable.fields', 'buttonGroup.buttons', 'buttonGroupInput.options'].map(
                    path => {
                        const [name, key] = path.split('.'),
                            prop = (WIDGETS.find(it => it.name === name).config as any).properties[
                                key
                            ];
                        return [path, prop.items.anyOf?.[1] ?? prop.items] as [string, any];
                    }
                )
            ];
        for (const [path, item, sibling] of items) {
            const props = {...(sibling as any)?.properties, ...item.properties},
                keys = Object.keys(props),
                groups = item['x-groups']?.map((it: any) => it.id);
            expect(item['x-common'], path).toBeDefined();
            expect(item['x-summary'], path).toBeDefined();
            expect(difference(item['x-common'], keys), path).toEqual([]);
            expect(difference(item['x-summary'], keys), path).toEqual([]);
            if (groups) {
                const ungrouped = keys.filter(
                    k => k !== 'field' && !groups.includes(props[k]['x-group'])
                );
                expect(ungrouped, path).toEqual([]);
            }
        }
    });

    it('describe every property, in list items too', () => {
        const undescribed = WIDGETS.flatMap(spec =>
            allProps(spec.config, spec.name)
                .filter(([, prop]) => !prop?.description)
                .map(([path]) => path)
        );
        expect(undescribed).toEqual([]);
    });
});
