import {render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {uniq} from 'lodash';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {BlueprintDesignModel, BlueprintModel, isIncomplete} from '../../../blueprint';
import {exampleBlueprintOf, FakeBlueprintDataProvider} from '../../../blueprint/demo';
import {portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {blueprintView} from './BlueprintView';

/**
 * A person may leave a widget unfinished in design mode. Each built-in then draws a note naming
 * what it lacks, never a crash or a half-drawn widget.
 */
describe('unfinished widgets', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const registry = scenarioRegistry(),
        // Each built-in with an example, and each property whose absence leaves it unfinished:
        // a required one, its source aside, which has a note of its own, or a list with a minimum.
        cases = Object.values(registry.widgets)
            .filter(it => !it.reserved && !it.name.includes('.') && it.example)
            .flatMap(spec => {
                const props = (spec.config?.properties ?? {}) as Record<string, any>,
                    keys = uniq([
                        ...((spec.config?.required ?? []) as string[]).filter(k => k !== 'source'),
                        // A pair, such as a dashboard's gap, is never emptied, only unset.
                        ...Object.keys(props).filter(
                            k => props[k]?.minItems > 0 && props[k].minItems !== props[k].maxItems
                        )
                    ]);
                return keys.map(key => [spec.name, key]);
            })
            // A card's field is unfinished by its widget's own check, not its schema.
            .concat([['statCard', 'field']]);

    it('covers the widgets that can be left unfinished', () => {
        expect(cases.map(([name]) => name)).toEqual(
            expect.arrayContaining(['chart', 'heatmap', 'treemap', 'gauge'])
        );
    });

    // An author previewing the draft as a reader sees the same notes, with no way to set them.
    const modes = cases.flatMap(([name, key]) => [
        [name, key, 'design'],
        [name, key, 'run']
    ]);

    it.each(modes)(
        'draws a %s with no %s as unfinished in %s mode, naming it',
        async (name, key, mode) => {
            const {blueprint} = exampleBlueprintOf(registry.widgets[name], portfolioCatalog),
                config = blueprint.elements[name].config,
                schema = (registry.widgets[name].config.properties as Record<string, any>)[key];
            if (schema?.minItems > 0) {
                config[key] = [];
            } else {
                delete config[key];
            }
            const model = new BlueprintModel({
                    blueprint,
                    catalog: portfolioCatalog,
                    registry,
                    dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                    mode: mode as 'design' | 'run',
                    access: 'write'
                }),
                design = new BlueprintDesignModel({blueprintModel: model}),
                // jsdom has no layout: a dashboard waits for a measured width before it draws cells.
                spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
            onTestFinished(() => {
                spy.mockRestore();
                design.destroy();
                model.destroy();
            });
            expect(model.issues.filter(isIncomplete).map(it => it.path)).toContain(
                `/elements/${name}/config/${key}`
            );
            const {container} = render(blueprintView({model, designModel: design}) as ReactElement),
                notice = () =>
                    container.querySelector(
                        `[data-blueprint-element="${name}"] .xh-blueprint-view__notice`
                    );
            await vi.waitFor(() => expect(notice()).not.toBeNull());
            const note = notice();
            expect(note?.textContent).toMatch(/ has no .* yet\./);
        }
    );
});
