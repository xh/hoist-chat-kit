import {describe, expect, it} from 'vitest';
import {type DockItem, type DockTarget, insertView, moveView} from './dockTree';

/**
 * Every move in every zone, from layouts of each shape, either refuses or gives a sound tree:
 * every view once, in a stack, no empty stack or one-child split, no split inside one of its own
 * direction, sizes summing to 100, and no deeper than a blueprint allows.
 */
describe('dock tree moves, exhaustively', () => {
    const v = (id: string): DockItem => ({type: 'view', id}),
        stack = (...ids: string[]): DockItem => ({type: 'stack', content: ids.map(v)});

    const LAYOUTS: Record<string, DockItem[]> = {
        'one stack': [stack('a', 'b', 'c')],
        'a row of stacks': [
            {
                type: 'row',
                content: [
                    {...stack('a', 'b'), width: 60},
                    {...stack('c'), width: 40}
                ]
            }
        ],
        'bare views in a row': [{type: 'row', content: [v('a'), v('b'), v('c')]}],
        'a bare view at the root': [v('a')],
        nested: [
            {
                type: 'row',
                content: [
                    {...stack('a'), width: 30},
                    {
                        type: 'column',
                        width: 70,
                        content: [
                            {...stack('b', 'c'), height: 50},
                            {
                                type: 'row',
                                height: 50,
                                content: [stack('d'), stack('e')]
                            }
                        ]
                    }
                ]
            }
        ],
        'sizes missing': [{type: 'column', content: [stack('a'), stack('b'), stack('c')]}]
    };

    const ZONES = ['center', 'left', 'right', 'top', 'bottom'] as const,
        ROOT = ['root-left', 'root-right', 'root-top', 'root-bottom'] as const;

    Object.entries(LAYOUTS).forEach(([name, layout]) => {
        it(`keeps the tree sound for every move in ${name}`, () => {
            const ids = viewIds(layout),
                targets: DockTarget[] = [
                    ...ids.flatMap(view => [
                        ...ZONES.map(zone => ({view, zone})),
                        ...[0, 1, 2, 5].map(index => ({view, zone: 'tab' as const, index}))
                    ]),
                    ...ROOT.map(zone => ({zone}))
                ];
            ids.forEach(id =>
                targets.forEach(target => {
                    const label = `${id} → ${JSON.stringify(target)}`;
                    let next: DockItem[];
                    expect(() => (next = moveView(layout, id, target)), label).not.toThrow();
                    if (next) expectSound(next, ids, label);
                })
            );
            targets.forEach(target => {
                const label = `new → ${JSON.stringify(target)}`;
                let next: DockItem[];
                expect(() => (next = insertView(layout, 'new', target)), label).not.toThrow();
                if (next) expectSound(next, [...ids, 'new'], label);
            });
        });
    });

    it('moves a bare view as one in a stack of its own', () => {
        const next = moveView(LAYOUTS['bare views in a row'], 'c', {view: 'a', zone: 'center'});
        expect(next).not.toBeNull();
        expect(stacksIds(next)).toEqual([['a', 'c'], ['b']]);
    });

    it('refuses a move that would nest deeper than a blueprint allows', () => {
        let layout: DockItem[] = [stack('a', 'b')];
        const zones = ['right', 'bottom'] as const;
        // Alternate directions so each split nests inside the last.
        for (let i = 0; i < 12 && layout; i++) {
            const id = `n${i}`,
                next = insertView(layout, id, {view: 'b', zone: zones[i % 2]});
            if (!next) break;
            layout = next;
        }
        expect(depthOf(layout)).toBeLessThanOrEqual(6);
    });

    //------------------
    // Test support
    //------------------
    function expectSound(layout: DockItem[], ids: string[], label: string) {
        expect(viewIds(layout).sort(), label).toEqual([...ids].sort());
        expect(depthOf(layout), label).toBeLessThanOrEqual(6);
        const check = (item: DockItem, parent: DockItem) => {
            if (item.type === 'view') {
                expect(parent?.type, `${label}: a view outside a stack`).toBe('stack');
                return;
            }
            expect(item.content?.length, `${label}: an empty ${item.type}`).toBeGreaterThan(0);
            if (item.type === 'stack') {
                item.content.forEach(it => expect(it.type, label).toBe('view'));
            } else {
                expect(item.content.length, `${label}: a one-child split`).toBeGreaterThan(1);
                const key = item.type === 'row' ? 'width' : 'height';
                item.content.forEach(it =>
                    expect(it.type, `${label}: a split in its own direction`).not.toBe(item.type)
                );
                const sum = item.content.reduce((t, it) => t + (it[key] ?? NaN), 0);
                expect(Math.abs(sum - 100), `${label}: sizes sum to ${sum}`).toBeLessThan(0.02);
            }
            item.content.forEach(it => check(it, item));
            expect(item.content.length, label).toBeLessThanOrEqual(20);
        };
        layout.forEach(it => check(it, null));
    }

    function viewIds(layout: DockItem[]): string[] {
        return layout.flatMap(it => (it.type === 'view' ? [it.id] : viewIds(it.content ?? [])));
    }

    function stacksIds(layout: DockItem[]): string[][] {
        return layout.flatMap(it =>
            it.type === 'stack'
                ? [it.content.map(c => c.id)]
                : it.type === 'view'
                  ? [[it.id]]
                  : stacksIds(it.content ?? [])
        );
    }

    function depthOf(layout: DockItem[]): number {
        return Math.max(0, ...layout.map(it => 1 + depthOf(it.content ?? [])));
    }
});
