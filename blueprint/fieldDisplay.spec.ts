import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, describe, expect, it, onTestFinished} from 'vitest';
import {
    ARTIFACTS,
    loadBlueprint,
    portfolioCatalog,
    scenarioRegistry
} from '../test/blueprintFixtures';
import type {Blueprint} from './Blueprint';
import {BlueprintModel} from './BlueprintModel';
import {BlueprintSource} from './BlueprintSource';
import {DataCatalog} from './DataCatalog';
import {FakeBlueprintDataProvider} from './demo/FakeBlueprintDataProvider';
import {formatValue, resolveFieldDisplay, resolveFormat} from './formats';
import {fieldUsages} from './usages';
import {validateBlueprint} from './validateBlueprint';

/**
 * How a field shows, in layers: the catalog's field, then a source's override of it, then a
 * widget's own entry. An override changes only how the field shows, for every widget over the
 * source.
 */
describe('field display', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const withOverride = (override: object): Blueprint => {
        const bp = loadBlueprint('p2-linked-dashboard.json');
        bp.sources.positions.fields = {mktVal: override as any};
        return bp;
    };

    it('takes each setting from the most specific layer, and merges formats in order', () => {
        const field = {
            name: 'v',
            type: 'number',
            label: 'Value',
            description: 'From the catalog.',
            align: 'left' as const,
            width: 90
        };
        expect(
            resolveFieldDisplay(
                field,
                {label: 'Source', align: 'center', format: {precision: 1}},
                {label: 'Column', format: 'thousands'}
            )
        ).toEqual({
            label: 'Column',
            description: 'From the catalog.',
            align: 'center',
            width: 90,
            formats: [{precision: 1}, 'thousands'],
            renderer: null
        });
        expect(resolveFieldDisplay(field).label).toBe('Value');
    });

    describe('a source override', () => {
        const validate = (bp: Blueprint) =>
            validateBlueprint(bp, {
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                artifacts: ARTIFACTS
            });

        it('takes the display settings of a field the dataset has', () => {
            expect(
                validate(
                    withOverride({
                        label: 'Value',
                        description: 'At the close.',
                        align: 'center',
                        width: 120,
                        format: {precision: 0},
                        renderer: 'bar'
                    })
                )
            ).toEqual([]);
        });

        it('refuses a field the dataset does not have, and any setting but display', () => {
            const bp = loadBlueprint('p2-linked-dashboard.json');
            bp.sources.positions.fields = {
                nope: {label: 'Nope'},
                mktVal: {label: 'Value', aggregator: 'MAX'} as any
            };
            expect(validate(bp).map(it => [it.code, it.path])).toEqual(
                expect.arrayContaining([
                    ['source.unknownField', '/sources/positions/fields/nope'],
                    ['source.badOverride', '/sources/positions/fields/mktVal/aggregator']
                ])
            );
        });

        it("names the field for every widget, and leaves the source's data and Cube as they are", () => {
            const model = new BlueprintModel({
                blueprint: withOverride({label: 'Value', align: 'center'}),
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            });
            onTestFinished(() => model.destroy());
            const source = model.getSource('positions');
            expect(source.fieldLabel('mktVal')).toBe('Value');
            expect(source.displayOf('mktVal')).toMatchObject({
                label: 'Value',
                align: 'center',
                description: 'Value at the close of the as-of date.'
            });
            expect(source.fields.mktVal.label).toBe('Market Value');
            expect(
                BlueprintSource.cubeKey(withOverride({label: 'Value'}).sources.positions)
            ).toEqual(
                BlueprintSource.cubeKey(loadBlueprint('p2-linked-dashboard.json').sources.positions)
            );
        });

        it('applies to a field instance, which takes the same display settings', () => {
            const bp = loadBlueprint('p3-morning-report.json');
            Object.assign(bp.sources.positions.fields.retYtd, {
                description: 'Return since the start of the year.',
                align: 'center',
                format: {precision: 1}
            });
            expect(
                validateBlueprint(bp, {
                    catalog: portfolioCatalog,
                    registry: scenarioRegistry(),
                    artifacts: ARTIFACTS
                })
            ).toEqual([]);
            const model = new BlueprintModel({
                blueprint: bp,
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'design',
                access: 'write'
            });
            onTestFinished(() => model.destroy());
            expect(model.getSource('positions').displayOf('retYtd')).toMatchObject({
                description: 'Return since the start of the year.',
                align: 'center',
                formats: [{precision: 1}]
            });

            (bp.sources.positions.fields.retYtd as any).aggregator = 'MAX';
            expect(
                validateBlueprint(bp, {
                    catalog: portfolioCatalog,
                    registry: scenarioRegistry(),
                    artifacts: ARTIFACTS
                }).map(it => [it.code, it.path])
            ).toEqual([['source.badOverride', '/sources/positions/fields/retYtd/aggregator']]);
        });

        it('counts as a use of its field', () => {
            expect(
                fieldUsages(withOverride({label: 'Value'}), portfolioCatalog).positions.mktVal.map(
                    it => it.path
                )
            ).toContain('/sources/positions/fields/mktVal');
        });
    });
});

/**
 * A catalog format's label can follow a dataset param, as a wind speed reads in mph or m/s by the
 * source's units. The source applies it, so every widget over the source shows it.
 */
describe('a format label chosen by a param', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    const catalog = new DataCatalog({
        formats: {
            speed: {
                precision: 0,
                label: {param: 'units', values: {imperial: ' mph', metric: ' m/s'}}
            }
        },
        kinds: {speed: {base: 'number', format: 'speed', aggregator: 'AVG'}},
        datasets: {
            weather: {
                params: {units: {type: 'string', options: {values: ['imperial', 'metric']}}},
                fields: [{name: 'windSpeed', type: 'number', kind: 'speed'}]
            }
        }
    });

    it("labels values by the source's param, follows it, and yields to a widget's own label", () => {
        const model = new BlueprintModel({
            blueprint: {
                variables: {units: {type: 'string', setBy: 'prompt', default: {value: 'metric'}}},
                sources: {now: {dataset: 'weather', params: {units: {$var: 'units'}}}},
                root: 'gauge',
                elements: {
                    gauge: {
                        component: 'gauge',
                        config: {source: 'now', value: 'windSpeed', max: 40}
                    }
                }
            },
            catalog,
            registry: scenarioRegistry(),
            dataProvider: new FakeBlueprintDataProvider({catalog})
        });
        onTestFinished(() => model.destroy());
        const source = model.getSource('now'),
            field = source.fields.windSpeed,
            text = (...layers: object[]) => {
                const opts = resolveFormat(
                    field,
                    source.displayOf('windSpeed', ...layers).formats,
                    {
                        catalog,
                        blueprint: model.blueprint
                    }
                );
                return formatValue(12, field, opts, catalog, true);
            };
        expect(text()).toBe('12 m/s');
        model.setVariable('units', 'imperial');
        expect(text()).toBe('12 mph');
        expect(text({format: {label: ' knots'}})).toBe('12 knots');
    });

    it("labels a joined field by its own source's param", () => {
        const joined = new DataCatalog({
                formats: {speed: {label: {param: 'units', values: {metric: ' m/s'}}}},
                kinds: {speed: {base: 'number', format: 'speed', aggregator: 'AVG'}},
                datasets: {
                    sites: {
                        key: ['city'],
                        params: {},
                        fields: [{name: 'city', type: 'string', isDimension: true}]
                    },
                    wind: {
                        key: ['city'],
                        params: {units: {type: 'string'}},
                        fields: [
                            {name: 'city', type: 'string', isDimension: true},
                            {name: 'windSpeed', type: 'number', kind: 'speed'}
                        ]
                    }
                }
            }),
            model = new BlueprintModel({
                blueprint: {
                    variables: {units: {type: 'string', default: {value: 'metric'}}},
                    sources: {
                        w: {dataset: 'wind', params: {units: {$var: 'units'}}},
                        s: {
                            dataset: 'sites',
                            joins: [{source: 'w', on: {city: 'city'}, fields: ['windSpeed']}]
                        }
                    },
                    root: 'grid',
                    elements: {
                        grid: {
                            component: 'cubeGrid',
                            config: {source: 's', columnState: ['city', 'windSpeed']}
                        }
                    }
                },
                catalog: joined,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: joined})
            });
        onTestFinished(() => model.destroy());
        const source = model.getSource('s'),
            field = source.fields.windSpeed,
            opts = resolveFormat(field, source.displayOf('windSpeed').formats, {
                catalog: joined,
                blueprint: model.blueprint
            });
        expect(formatValue(12, field, opts, joined, true)).toBe('12 m/s');
    });
});
