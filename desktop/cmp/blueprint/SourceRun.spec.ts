import {fireEvent, render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {type Blueprint, BlueprintModel} from '../../../blueprint';
import {FakeBlueprintDataProvider} from '../../../blueprint/demo';
import {loadBlueprint, portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {blueprintView} from './BlueprintView';

/**
 * A manual source's widgets say when its rows are for inputs no longer set, dimmed, and offer Run:
 * in a dashboard cell's header, or over the widget where it has none.
 */
describe('a manual source in the view', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function show(blueprint: Blueprint) {
        blueprint.sources.positions.run = 'manual';
        blueprint.sources.positions.live = false;
        const provider = new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
            model = new BlueprintModel({
                blueprint,
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: provider,
                mode: 'run'
            }),
            // jsdom has no layout: a dashboard waits for a measured width before it draws cells.
            spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
        onTestFinished(() => {
            spy.mockRestore();
            model.destroy();
        });
        const {container} = render(blueprintView({model}) as ReactElement);
        return {model, provider, container, source: () => model.getSource('positions')};
    }

    it('marks a widget with no header over its body, and runs from its Run button', async () => {
        const {model, provider, container, source} = show(loadBlueprint('p1-one-grid.json')),
            marker = () => container.querySelector('.xh-blueprint-view__stale');
        await vi.waitFor(() => expect(source().hasLoaded).toBe(true));
        expect(marker()).toBeNull();

        model.setVariable('asOf', '2026-07-01');
        await vi.waitFor(() => expect(marker()?.textContent).toMatch(/Inputs changed/));
        expect(marker().classList).toContain('xh-blueprint-view__stale--floating');
        expect(container.querySelector('.xh-blueprint-view__data--stale')).not.toBeNull();

        const load = vi.spyOn(provider, 'loadAsync');
        fireEvent.click(marker().querySelector('button'));
        await vi.waitFor(() => expect(marker()).toBeNull());
        expect(source().isStale).toBe(false);
        expect(container.querySelector('.xh-blueprint-view__data--stale')).toBeNull();
        expect(load.mock.calls.at(-1)[0].params).toEqual({asOf: '2026-07-01'});
    });

    it("puts Run in a dashboard cell's header, and dims the cell's body", async () => {
        const {model, container, source} = show(loadBlueprint('p2-linked-dashboard.json'));
        await vi.waitFor(() => expect(source().hasLoaded).toBe(true));

        model.setVariable('asOf', '2026-07-01');
        await vi.waitFor(() =>
            expect(
                container.querySelector(
                    '.xh-blueprint-dashboard__cell-items .xh-blueprint-view__stale'
                )
            ).not.toBeNull()
        );
        expect(container.querySelector('.xh-blueprint-view__stale--floating')).toBeNull();
        expect(container.querySelector('.xh-blueprint-view__data--stale')).not.toBeNull();
    });
});
