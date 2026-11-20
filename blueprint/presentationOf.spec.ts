import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {portfolioCatalog} from '../test/blueprintFixtures';
import type {Blueprint} from './Blueprint';
import {BlueprintModel} from './BlueprintModel';
import {BlueprintRegistry} from './BlueprintRegistry';

/**
 * A widget draws in the default presentation only when that presentation draws all its config.
 * A key the presentation ignores, such as a grid's grouping in a card, takes the widget's panel.
 */
describe('presentationOf', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(grids: Record<string, object>, defaultPresentation = 'card') {
        const registry = new BlueprintRegistry();
        registry.addBuiltIns({
            presentations: [
                {
                    widget: 'cubeGrid',
                    presentation: {
                        name: 'card',
                        label: 'Card',
                        guidance: 'A flat preview.',
                        component: (() => null) as any,
                        ignores: ['groupBy', 'treeStyle']
                    }
                }
            ]
        });
        const blueprint: Blueprint = {
                sources: {
                    s: {
                        inline: {
                            fields: [
                                {name: 'sector', type: 'string', isDimension: true},
                                {name: 'v', type: 'number'}
                            ],
                            rows: [{sector: 'a', v: 1}]
                        }
                    }
                },
                root: 'top',
                elements: {
                    top: {
                        component: 'tabContainer',
                        children: Object.keys(grids).map(id => ({id, title: id}))
                    },
                    ...Object.fromEntries(
                        Object.entries(grids).map(([id, config]) => [
                            id,
                            {component: 'cubeGrid', config: {source: 's', ...config}}
                        ])
                    )
                }
            },
            ret = new BlueprintModel({
                catalog: portfolioCatalog,
                registry,
                dataProvider: null,
                isAnswer: true,
                defaultPresentation
            });
        expect(ret.updateBlueprint(blueprint).filter(it => it.severity === 'error')).toEqual([]);
        onTestFinished(() => ret.destroy());
        return ret;
    }

    it('draws in the default presentation a widget whose config it draws in full', () => {
        const model = open({flat: {}, noGroups: {groupBy: []}});
        expect(model.presentationOf('flat')).toBe('card');
        expect(model.presentationOf('noGroups')).toBe('card');
    });

    it('draws as its panel a widget that sets a key the default presentation ignores', () => {
        const model = open({grouped: {groupBy: ['sector']}, styled: {treeStyle: 'colors'}});
        expect(model.presentationOf('grouped')).toBe('panel');
        expect(model.presentationOf('styled')).toBe('panel');
    });

    it('keeps a presentation the config names, and the panel with no default', () => {
        expect(
            open({named: {groupBy: ['sector'], presentation: 'card'}}).presentationOf('named')
        ).toBe('card');
        expect(open({plain: {}}, null).presentationOf('plain')).toBe('panel');
        expect(open({}).presentationOf('top')).toBe('panel');
        expect(open({}).presentationOf('nope')).toBeNull();
    });
});
