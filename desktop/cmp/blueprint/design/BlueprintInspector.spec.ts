import {act, fireEvent, render} from '@testing-library/react';
import {initTestAppAsync} from '@xh/hoist/test-support';
import type {ReactElement} from 'react';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    BlueprintDesignModel,
    BlueprintModel,
    FakeBlueprintDataProvider
} from '../../../../blueprint';
import {
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../../../../test/blueprintFixtures';
import {blueprintInspector, BlueprintInspectorModel, foldCrumbs} from './BlueprintInspector';

/**
 * The Inspector: one frame for whatever is selected - its path, its id and what it reads, its
 * menu and its issues - over the editor for its kind.
 */
describe('BlueprintInspector', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open() {
        const model = new BlueprintModel({
                blueprint: loadBlueprint('p3-morning-report.json'),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            }),
            design = new BlueprintDesignModel({blueprintModel: model}),
            inspector = new BlueprintInspectorModel(design);
        onTestFinished(() => {
            inspector.destroy();
            design.destroy();
            model.destroy();
        });
        return {model, design, inspector};
    }

    it("shows the selection's quick actions under its id, each one edit, with its key or why not", () => {
        const {model, design} = open();
        design.select({kind: 'element', id: 'sectorChart'});
        const {container} = render(blueprintInspector({designModel: design}) as ReactElement),
            bar = () => container.querySelector('.xh-blueprint-inspector__actions'),
            buttons = () => [...bar().querySelectorAll('.xh-button')];
        expect(buttons().map(it => it.textContent)).toEqual(['Duplicate', 'Wrap in', 'Delete']);
        expect(buttons()[0].getAttribute('title')).toBe('Duplicate · Ctrl+D');
        const edits = model.history.length;
        fireEvent.click(buttons()[0]);
        expect(model.history.length).toBe(edits + 1);
        expect(design.selectedElementId).not.toBe('sectorChart');

        // A container also offers to add a widget to it, and the root cannot be duplicated.
        act(() => design.select({kind: 'element', id: 'tabs'}));
        // A container's own action leads, in primary.
        expect(buttons()[0].textContent).toBe('Add a widget…');
        expect((buttons()[1] as HTMLButtonElement).disabled).toBe(true);
        expect(buttons()[1].getAttribute('title')).toMatch(/root/);
    });

    it('offers a container the widgets it takes in a popover, adding at its end or after a child', async () => {
        const {model, design} = open(),
            box = design.addWidget('box', 'positions').id,
            a = design.addWidget('markdown', box).id,
            bar = design.addWidget('toolbar', box).id;
        act(() => design.select({kind: 'element', id: box}));
        const {container} = render(blueprintInspector({designModel: design}) as ReactElement),
            button = (text: string) =>
                [...container.querySelectorAll('.xh-blueprint-inspector__actions .xh-button')].find(
                    it => it.textContent === text
                ),
            tile = (label: string) =>
                [
                    ...([...document.querySelectorAll('.xh-blueprint-inspector__add-panel')]
                        .at(-1)
                        ?.querySelectorAll('[role="button"]') ?? [])
                ].find(it => it.textContent.startsWith(label)),
            kids = () => model.blueprint.elements[box].children.map(it => it.id);

        fireEvent.click(button('Add a widget…'));
        await vi.waitFor(() =>
            expect(document.querySelector('.xh-blueprint-inspector__add-panel')).not.toBeNull()
        );
        await vi.waitFor(() => expect(tile('Text')).toBeTruthy());
        fireEvent.click(tile('Text'));
        expect(kids()).toHaveLength(3);
        expect(kids()[0]).toBe(a);
        await vi.waitFor(() =>
            expect(document.querySelector('.xh-blueprint-inspector__add-panel')).toBeNull()
        );

        // Beside a child, it adds right after it.
        act(() => design.select({kind: 'element', id: a}));
        fireEvent.click(button('Add a widget after'));
        await vi.waitFor(() => expect(tile('Text')).toBeTruthy());
        fireEvent.click(tile('Text'));
        expect(kids()[0]).toBe(a);
        expect(kids()).toHaveLength(4);
        expect(kids()[1]).toBe(design.selectedElementId);

        // A container that refuses a widget shows it disabled, with the reason.
        act(() => design.select({kind: 'element', id: bar}));
        fireEvent.click(button('Add a widget…'));
        await vi.waitFor(() => expect(tile('Grid')).toBeTruthy());
        expect(tile('Grid').getAttribute('aria-disabled')).toBe('true');
        expect(tile('Grid').getAttribute('title')).toEqual(expect.any(String));
    });

    it('names the selection, its path and what it reads, for every kind', () => {
        const {design, inspector} = open();
        design.select({kind: 'element', id: 'posGrid'});
        expect(inspector.breadcrumb).toEqual([
            {kind: 'element', id: 'tabs'},
            {kind: 'element', id: 'positions'},
            {kind: 'view', id: 'posGrid', of: 'positions'},
            {kind: 'element', id: 'posGrid'}
        ]);
        design.select({kind: 'view', id: 'posGrid', of: 'positions'});
        expect(inspector.breadcrumb.at(-1)).toEqual({kind: 'view', id: 'posGrid', of: 'positions'});
        expect(inspector.breadcrumb).toHaveLength(3);
        expect(inspector.subtitle).toBe('View · holds posGrid · in positions');
        design.select({kind: 'element', id: 'posGrid'});
        expect(inspector.subtitle).toBe('Grid · reads positions, grouping, pnlFilter');
        design.select({kind: 'source', id: 'prices'});
        expect(inspector.breadcrumb).toEqual([]);
        expect(inspector.subtitle).toBe('dataset prices · reads symbol, priceStart, asOf');
        design.select({kind: 'variable', id: 'yearStart'});
        expect(inspector.subtitle).toBe('Local date · computed by yearStart · reads asOf');
        design.select({kind: 'variable', id: 'asOf'});
        expect(inspector.subtitle).toBe('Local date · prompt');
        design.select({kind: 'variable', id: 'grouping'});
        expect(inspector.subtitle).toBe('List of text · set by groupChooser');
        design.select({kind: 'preset', id: 'posViews'});
        expect(inspector.subtitle).toBe('Columns');
    });

    it('shows the wiring of each kind first, each chip naming its target', () => {
        const {design, inspector} = open(),
            rows = () =>
                Object.fromEntries(
                    inspector.wiringRows.map(it => [
                        it.label,
                        it.chips?.map(c => c.text) ?? it.text
                    ])
                );
        design.select({kind: 'element', id: 'posGrid'});
        expect(rows()).toEqual({
            Reads: ['positions', 'grouping', 'pnlFilter'],
            Sets: ['selection', 'symbol'],
            Presets: ['posViews']
        });
        design.select({kind: 'variable', id: 'asOf'});
        expect(rows()['Set by']).toEqual(['prompt']);
        expect([...rows()['Read by']].sort()).toEqual(
            ['orders', 'positions', 'prices.end', 'priceStart', 'reportActions', 'yearStart'].sort()
        );
        expect(typeof rows().Now).toBe('string');
        design.select({kind: 'source', id: 'prices'});
        expect(rows()).toMatchObject({'Read by': ['priceChart'], Waits: ['symbol']});
        design.select({kind: 'preset', id: 'posViews'});
        expect(rows()).toEqual({
            Controls: ['posGrid · columnState'],
            'Shown by': ['posViewsSelector']
        });

        // A chip selects what it names.
        inspector.wiringRows[0].chips[0].select();
        expect(design.selectedElementId).toBe('posGrid');
    });

    it("frames each kind's editor under one header, with a clickable path", async () => {
        const {design, model} = open(),
            {container} = render(blueprintInspector({designModel: design}) as ReactElement);
        design.select({kind: 'element', id: 'posGrid'});
        await vi.waitFor(() =>
            expect(container.querySelector('.xh-blueprint-inspector__id')?.textContent).toBe(
                'posGrid'
            )
        );
        // The editor's own header gives way to the frame's.
        expect(container.querySelector('.xh-blueprint-element-inspector__header')).toBeNull();
        fireEvent.click(
            [
                ...container.querySelectorAll('.xh-blueprint-inspector__breadcrumb [role=button]')
            ].find(it => it.textContent === 'positions')
        );
        expect(design.selectedElementId).toBe('positions');
        design.select({kind: 'variable', id: 'asOf'});
        await vi.waitFor(() =>
            expect(container.querySelector('.xh-blueprint-inspector__id')?.textContent).toBe('asOf')
        );
        expect(container.querySelector('.xh-blueprint-variables-editor')).toBeTruthy();
        expect(model.history).toHaveLength(0);
    });

    it("ends the path with the selection's kind, after an icon on every step", async () => {
        const {design} = open(),
            {container} = render(blueprintInspector({designModel: design}) as ReactElement);
        design.select({kind: 'element', id: 'posGrid'});
        const current = await vi.waitFor(() => {
            const it = container.querySelector('.xh-blueprint-inspector__crumb--current');
            expect(it).toBeTruthy();
            return it;
        });
        expect(current.textContent).toBe('posGridGrid');
        expect(current.querySelector('.xh-blueprint-inspector__crumb-kind').textContent).toBe(
            'Grid'
        );
        expect(
            container.querySelectorAll('.xh-blueprint-inspector__breadcrumb svg').length
        ).toBeGreaterThanOrEqual(5);
    });

    it('switches between Edit and Interact from its keys, with nothing selected too', async () => {
        const {design} = open(),
            {container} = render(blueprintInspector({designModel: design}) as ReactElement),
            frame = container.querySelector<HTMLElement>('.xh-blueprint-inspector');
        expect(design.interaction).toBe('edit');
        fireEvent.keyDown(frame, {key: '`', code: 'Backquote'});
        expect(design.interaction).toBe('interact');
        act(() => design.select({kind: 'element', id: 'posGrid'}));
        fireEvent.keyDown(container.querySelector('.xh-blueprint-inspector'), {
            key: 'e',
            code: 'KeyE'
        });
        expect(design.interaction).toBe('edit');
    });

    describe('breadcrumb child menus', () => {
        const chevrons = (container: HTMLElement) => [
                ...container.querySelectorAll<HTMLElement>(
                    '.xh-blueprint-inspector__breadcrumb .xh-blueprint-inspector__crumb-sep--menu'
                )
            ],
            // The menu opened last, as one closing may linger in the page.
            lastMenu = () =>
                [...document.querySelectorAll('.bp6-menu.xh-blueprint-inspector__crumb-menu')].at(
                    -1
                ),
            menuItems = (): HTMLElement[] => [
                ...(lastMenu()?.querySelectorAll<HTMLElement>('[data-crumb-child]') ?? [])
            ],
            itemIds = () => menuItems().map(it => it.dataset.crumbChild),
            item = (id: string) => menuItems().find(it => it.dataset.crumbChild === id);

        async function show(id: string) {
            const {design, model} = open(),
                {container} = render(blueprintInspector({designModel: design}) as ReactElement);
            act(() => design.select({kind: 'element', id}));
            await vi.waitFor(() =>
                expect(
                    container.querySelector('.xh-blueprint-inspector__crumb--current')?.textContent
                ).toContain(id)
            );
            return {design, model, container};
        }

        const openMenu = (chevron: HTMLElement) =>
            act(() => {
                fireEvent.click(chevron);
            });

        it("lists the children of the step before each chevron, the containers' and the selection's own", async () => {
            const {container} = await show('overview');
            const [afterTabs, trailing] = chevrons(container);
            openMenu(afterTabs);
            await vi.waitFor(() => expect(itemIds()).toEqual(['overview', 'positions', 'orders']));
            act(() => {
                fireEvent.keyDown(document.activeElement, {key: 'Escape'});
            });
            openMenu(trailing);
            // A dashboard's cells, as views, in reading order.
            await vi.waitFor(() =>
                expect(itemIds()).toEqual([
                    'view:reportActions',
                    'view:headline',
                    'view:sectorChart',
                    'view:regionChart'
                ])
            );
            expect(item('view:headline').textContent).toContain('View');
        });

        it("opens a view step's menu of its widget and its header items", async () => {
            const {container, design} = await show('posGrid');
            act(() => design.select({kind: 'view', id: 'posGrid', of: 'positions'}));
            await vi.waitFor(() =>
                expect(
                    container.querySelector('.xh-blueprint-inspector__crumb--current').textContent
                ).toContain('posGrid')
            );
            openMenu(chevrons(container).at(-1));
            await vi.waitFor(() => expect(itemIds()).toEqual(['posGrid', 'posViewsSelector']));
            const headings = [
                ...document.querySelectorAll('.xh-blueprint-inspector__crumb-menu .bp6-menu-header')
            ].map(it => it.textContent);
            expect(headings).toEqual(['Cell content', 'Cell header']);
            act(() => {
                fireEvent.click(item('posViewsSelector'));
            });
            expect(design.selectedElementId).toBe('posViewsSelector');
        });

        it('gives a leaf no trailing chevron', async () => {
            const {container} = await show('sectorChart');
            const current = container.querySelector('.xh-blueprint-inspector__crumb--current');
            expect(current.nextElementSibling).toBeNull();
            // Its containers' and its view's chevrons still open their children.
            expect(chevrons(container)).toHaveLength(3);
        });

        it('selects a child on a click, and marks it on the dashboard while hovered', async () => {
            const {container, design} = await show('overview');
            openMenu(chevrons(container).at(-1));
            await vi.waitFor(() => expect(item('view:sectorChart')).toBeTruthy());
            fireEvent.mouseEnter(item('view:sectorChart'));
            expect(design.hoveredId).toBe('sectorChart');
            fireEvent.mouseLeave(item('view:sectorChart'));
            expect(design.hoveredId).toBeNull();
            act(() => {
                fireEvent.click(item('view:sectorChart'));
            });
            expect(design.selection).toEqual({kind: 'view', id: 'sectorChart', of: 'overview'});
        });

        it("drills into a container's children through its submenu", async () => {
            const {container} = await show('overview');
            openMenu(chevrons(container).at(-1));
            await vi.waitFor(() => expect(item('view:headline')).toBeTruthy());
            act(() => {
                fireEvent.mouseEnter(item('view:headline'));
            });
            const sub = (id: string) =>
                document.querySelector<HTMLElement>(`[data-crumb-child="${id}"]`);
            // A view's submenu holds its widget.
            await vi.waitFor(() => expect(sub('headline')).toBeTruthy(), {timeout: 2000});
            // In a portal of its own, so the menu's scrolling never clips it.
            expect(lastMenu().contains(sub('headline'))).toBe(false);
        });

        it('groups children by slot, where a widget has several, leaving out empty ones', async () => {
            const {design, container} = await show('overview');
            const panel = design.addWidget('panel', 'overview').id;
            design.addWidget('markdown', panel);
            design.addWidget('buttonGroup', panel, {slot: 'tbar'});
            act(() => design.select({kind: 'element', id: panel}));
            await vi.waitFor(() => expect(chevrons(container).length).toBe(4));
            openMenu(chevrons(container).at(-1));
            await vi.waitFor(() => expect(menuItems()).toHaveLength(2));
            const headings = [
                ...document.querySelectorAll('.xh-blueprint-inspector__crumb-menu .bp6-menu-header')
            ].map(it => it.textContent);
            expect(headings).toEqual(['Content', 'Top toolbar']);
        });

        it('offers to add to an empty container, from its trailing chevron', async () => {
            const {design, container} = await show('overview');
            const box = design.addWidget('box', 'overview').id;
            act(() => design.select({kind: 'element', id: box}));
            await vi.waitFor(() => expect(chevrons(container).length).toBe(4));
            openMenu(chevrons(container).at(-1));
            const add = await vi.waitFor(() => {
                const it = [
                    ...document.querySelectorAll<HTMLElement>(
                        '.xh-blueprint-inspector__crumb-menu .bp6-menu-item'
                    )
                ];
                expect(it.map(el => el.textContent)).toEqual(['No children', 'Add…']);
                return it[1];
            });
            const before = design.addRequestedAt;
            act(() => {
                fireEvent.click(add);
            });
            expect(design.addTarget).toEqual({parent: box});
            expect(design.addRequestedAt).toBeGreaterThan(before);
        });

        it('opens from the keyboard, and moves through its items with the arrows', async () => {
            const {container, design} = await show('overview');
            const trailing = chevrons(container).at(-1);
            expect(trailing.getAttribute('tabindex')).toBe('0');
            act(() => {
                fireEvent.keyDown(trailing, {key: 'ArrowDown'});
            });
            await vi.waitFor(() => expect(document.activeElement).toBe(item('view:reportActions')));
            act(() => {
                fireEvent.keyDown(document.activeElement, {key: 'ArrowDown'});
            });
            expect(document.activeElement).toBe(item('view:headline'));
            act(() => {
                fireEvent.keyDown(document.activeElement, {key: 'Enter'});
            });
            expect(design.selection).toEqual({kind: 'view', id: 'headline', of: 'overview'});
        });

        it("moves between a menu's own rows, never into a container's submenu", async () => {
            const {container, design} = await show('overview');
            const afterTabs = chevrons(container)[0];
            act(() => {
                afterTabs.focus();
                fireEvent.keyDown(afterTabs, {key: 'Enter'});
            });
            // Overview is a container, and its focus opens no submenu to walk into.
            await vi.waitFor(() => expect(document.activeElement).toBe(item('overview')));
            act(() => {
                fireEvent.keyDown(document.activeElement, {key: 'ArrowDown'});
            });
            expect(document.activeElement).toBe(item('positions'));
            expect(document.querySelector('[data-crumb-child="reportActions"]')).toBeNull();
            // Esc closes the menu and gives focus back to its chevron.
            act(() => {
                fireEvent.keyDown(document.activeElement, {key: 'Escape'});
            });
            await vi.waitFor(() => expect(document.activeElement).toBe(afterTabs));

            // So does picking a row, as the same chevron still follows tabs.
            act(() => {
                fireEvent.keyDown(afterTabs, {key: 'Enter'});
            });
            await vi.waitFor(() => expect(document.activeElement).toBe(item('overview')));
            act(() => {
                fireEvent.keyDown(document.activeElement, {key: 'ArrowDown'});
            });
            act(() => {
                fireEvent.keyDown(document.activeElement, {key: 'Enter'});
            });
            expect(design.selectedElementId).toBe('positions');
            await vi.waitFor(() => expect(document.activeElement).toBe(chevrons(container)[0]));
            expect(chevrons(container)[0]).toBe(afterTabs);
        });

        it('leaves room for the trailing chevron when it folds the path', () => {
            // 310px of steps fit 320px, but not with a 22px trailing chevron.
            expect(foldCrumbs([60, 95, 111], 320)).toEqual({shown: [0, 1, 2], hidden: []});
            expect(foldCrumbs([60, 95, 111], 320, true)).toEqual({shown: [0, 2], hidden: [1]});
        });
    });

    it('folds the middle of a path that does not fit, keeping its first and last steps', () => {
        // Widths of three steps, with 22px separators and a 30px fold.
        expect(foldCrumbs([60, 95, 111], 260)).toEqual({shown: [0, 2], hidden: [1]});
        expect(foldCrumbs([60, 95, 111], 400)).toEqual({shown: [0, 1, 2], hidden: []});
        // Unmeasured, it shows the whole path.
        expect(foldCrumbs([60, 95, 111], 0)).toEqual({shown: [0, 1, 2], hidden: []});
        // The steps nearest the selection come back first.
        expect(foldCrumbs([60, 80, 80, 80, 100], 340)).toEqual({
            shown: [0, 3, 4],
            hidden: [1, 2]
        });
    });

    it('sums up the blueprint when nothing is selected', async () => {
        const {design} = open(),
            {container, getByText} = render(
                blueprintInspector({
                    designModel: design,
                    documentModel: {
                        document: {name: 'Morning report', description: 'P&L and risk'}
                    } as any
                }) as ReactElement
            );
        expect(getByText('Morning report')).toBeTruthy();
        expect(getByText('P&L and risk')).toBeTruthy();
        expect(container.textContent).toContain(
            '18 elements · 3 sources · 8 variables · 1 preset group'
        );
        expect(container.textContent).not.toMatch(/Select/);
        fireEvent.click(getByText('tabs'));
        expect(design.selectedElementId).toBe('tabs');
    });

    it('renames from the header, and not once Escape cancels it', () => {
        const {design, model, inspector} = open();
        design.select({kind: 'element', id: 'posGrid'});
        inspector.setRenaming(true);
        inspector.setRenaming(false);
        // The input commits as it blurs on its way out.
        inspector.rename('nope');
        expect(model.blueprint.elements).not.toHaveProperty('nope');
        inspector.setRenaming(true);
        inspector.rename('book');
        expect(model.blueprint.elements).toHaveProperty('book');
        expect(design.selectedElementId).toBe('book');
    });
});
