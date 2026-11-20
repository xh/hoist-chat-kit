import {render, screen, waitFor} from '@testing-library/react';
import {wait} from '@xh/hoist/promise';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {beforeAll, describe, expect, it, onTestFinished, vi} from 'vitest';
import {
    type Blueprint,
    type BlueprintElement,
    BlueprintModel,
    type BlueprintWidgetModel,
    FakeBlueprintDataProvider,
    type VariableDecl
} from '../../../blueprint';
import {portfolioCatalog, scenarioRegistry} from '../../../test/blueprintFixtures';
import {blueprintView} from './BlueprintView';
import {
    DateInputWidgetModel,
    DateRangePickerWidgetModel,
    FilterChooserWidgetModel,
    NumberInputWidgetModel,
    SelectWidgetModel,
    SliderWidgetModel,
    SwitchInputWidgetModel,
    TextInputWidgetModel
} from './InputWidgets';

/**
 * Each input shows the value of the variable whose `setBy` names it, and sets that variable as a
 * user changes it. It holds no value of its own. A toolbar holds inputs, separators and spacers.
 */
describe('input widgets', () => {
    beforeAll(async () => {
        await initTestAppAsync();
    });

    function open(variable: VariableDecl, el: BlueprintElement, extra: Partial<Blueprint> = {}) {
        const blueprint: Blueprint = {
                schema: {blueprint: 1},
                ...extra,
                variables: {...extra.variables, v: {...variable, setBy: {element: 'input'}}},
                root: 'input',
                elements: {input: el}
            },
            model = new BlueprintModel({
                blueprint,
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'run'
            });
        onTestFinished(() => model.destroy());
        return model;
    }

    function widget<T extends BlueprintWidgetModel>(
        Cls: new (c: any) => T,
        model: BlueprintModel
    ): T {
        const ret = new Cls({blueprintModel: model, id: 'input', renderElement: () => null});
        onTestFinished(() => ret.destroy());
        return ret;
    }

    const valueOf = (model: BlueprintModel) => model.getVariable('v').value;

    it('selects one option of its variable, or several for a list variable', () => {
        const one = open(
                {type: 'string', options: {values: ['EU', 'US']}, default: {value: 'EU'}},
                {component: 'select', config: {label: 'Region'}}
            ),
            single = widget(SelectWidgetModel, one);
        expect(single.inputProps).toMatchObject({
            options: ['EU', 'US'],
            value: 'EU',
            enableMulti: false
        });
        single.inputProps.onChange('US');
        expect(valueOf(one)).toBe('US');

        const many = open(
                {type: 'string[]', options: {values: ['EU', 'US']}, default: {value: []}},
                {component: 'select', config: {}}
            ),
            multi = widget(SelectWidgetModel, many);
        expect(multi.inputProps.enableMulti).toBe(true);
        multi.inputProps.onChange(['EU', 'US']);
        expect(valueOf(many)).toEqual(['EU', 'US']);
    });

    it("offers the values of a source's field, loaded with that source's params", async () => {
        const model = open(
                {type: 'string', options: {source: 'funds', field: 'fund'}},
                {component: 'select', config: {}},
                {
                    variables: {
                        asOf: {type: 'localDate', setBy: 'prompt', default: {value: '2026-03-02'}}
                    },
                    sources: {funds: {dataset: 'fundSummary', params: {asOf: {$var: 'asOf'}}}}
                }
            ),
            input = widget(SelectWidgetModel, model);
        await vi.waitFor(() => expect(input.inputProps.options.length).toBeGreaterThan(1));
        const {options} = input.inputProps;
        expect(options).toEqual([...new Set(options)].sort());
        expect(options.every((it: unknown) => typeof it === 'string')).toBe(true);
    });

    it('edits a local date as its ISO string', () => {
        const model = open(
                {type: 'localDate', default: {value: '2026-03-02'}},
                {component: 'dateInput', config: {}}
            ),
            input = widget(DateInputWidgetModel, model);
        expect((input.inputProps.value as LocalDate).isoString).toBe('2026-03-02');
        input.inputProps.onCommit(LocalDate.get('2026-03-05'));
        expect(valueOf(model)).toBe('2026-03-05');
        input.inputProps.onCommit(null);
        expect(valueOf(model)).toBeNull();
    });

    it('edits a number within its bounds, a text and a switch', () => {
        const num = open(
                {type: 'number', default: {value: 5}},
                {component: 'numberInput', config: {min: 0, max: 10, precision: 1}}
            ),
            numInput = widget(NumberInputWidgetModel, num);
        expect(numInput.inputProps).toMatchObject({value: 5, min: 0, max: 10, precision: 1});
        numInput.inputProps.onCommit(7);
        expect(valueOf(num)).toBe(7);

        const text = open({type: 'string'}, {component: 'textInput', config: {}}),
            textInput = widget(TextInputWidgetModel, text);
        textInput.inputProps.onCommit('Oak');
        expect(valueOf(text)).toBe('Oak');

        const flag = open({type: 'bool', default: {value: false}}, {component: 'switchInput'}),
            switchInput = widget(SwitchInputWidgetModel, flag);
        switchInput.inputProps.onChange(true);
        expect(valueOf(flag)).toBe(true);
    });

    it('slides without setting its variable, and sets it on release', () => {
        const model = open(
                {type: 'number', default: {value: 2}},
                {component: 'slider', config: {min: 0, max: 10, step: 1}}
            ),
            slider = widget(SliderWidgetModel, model);
        // Five labels across its range, however fine its step.
        expect(slider.inputProps.labelStepSize).toBe(2.5);
        slider.inputProps.onChange(6);
        expect(slider.inputProps.value).toBe(6);
        expect(valueOf(model)).toBe(2);
        slider.release();
        expect(valueOf(model)).toBe(6);
        expect(slider.inputProps.value).toBe(6);
    });

    it("chooses a filter over its source's dimensions, and sets its variable to the filter", async () => {
        const model = open(
                {type: 'filter'},
                {component: 'filterChooser', config: {source: 'positions'}},
                {
                    variables: {asOf: {type: 'localDate', default: {value: '2026-03-02'}}},
                    sources: {positions: {dataset: 'positions', params: {asOf: {$var: 'asOf'}}}}
                }
            ),
            chooser = widget(FilterChooserWidgetModel, model),
            fields = chooser.chooserModel.fieldSpecs.map(it => it.field);
        expect(fields).toContain('sector');
        expect(fields).not.toContain('mktVal');

        chooser.chooserModel.setValue({field: 'sector', op: '=', value: 'Energy'});
        await wait();
        expect(valueOf(model)).toEqual({field: 'sector', op: '=', value: 'Energy'});

        model.setVariable('v', {field: 'region', op: '=', value: 'EU'});
        await wait();
        expect(chooser.chooserModel.value?.toJSON()).toEqual({
            field: 'region',
            op: '=',
            value: 'EU'
        });
    });

    it('picks a date range among the presets it offers, and sets its variable', async () => {
        const model = open(
                {type: 'dateRange', default: {value: 'mtd'}},
                {component: 'dateRangePicker', config: {presets: ['mtd', 'ytd']}}
            ),
            picker = widget(DateRangePickerWidgetModel, model);
        expect(picker.pickerModel.value).toEqual({kind: 'preset', token: 'mtd'});
        expect(picker.pickerModel.presets.map(it => it.token)).toEqual(['mtd', 'ytd']);

        picker.pickerModel.setValue('ytd');
        await wait();
        expect(valueOf(model)).toEqual({kind: 'preset', token: 'ytd'});

        model.setVariable('v', {kind: 'relative', count: 3, unit: 'months'});
        await wait();
        expect(picker.pickerModel.value).toMatchObject({kind: 'relative', count: 3});
        expect(() => model.setVariable('v', 'nope')).toThrow();

        // Its picker keeps its value when the variable has none, as when a blueprint is replaced.
        const warn = vi.spyOn(console, 'warn');
        model.setVariable('v', null);
        await wait();
        expect(warn.mock.calls.flat().join(' ')).not.toContain('invalid value');
    });

    it("offers its variable's preset too, and ranges as of its asOf", () => {
        const model = open(
                {type: 'dateRange', default: {value: 'ytd'}},
                {component: 'dateRangePicker', config: {presets: ['mtd'], asOf: {$var: 'asOf'}}},
                {
                    variables: {
                        asOf: {type: 'localDate', setBy: 'prompt', default: {value: '2026-03-02'}}
                    }
                }
            ),
            picker = widget(DateRangePickerWidgetModel, model);
        expect(picker.pickerModel.presets.map(it => it.token)).toEqual(['mtd', 'ytd']);
        expect(picker.pickerModel.value).toEqual({kind: 'preset', token: 'ytd'});
        expect(picker.pickerModel.anchorDate.isoString).toBe('2026-03-02');
        model.setVariable('asOf', '2026-03-05');
        expect(picker.pickerModel.anchorDate.isoString).toBe('2026-03-05');
    });

    it("anchors a prompted date range's picker on its asOf", () => {
        const model = new BlueprintModel({
            blueprint: {
                schema: {blueprint: 1},
                variables: {
                    asOf: {type: 'localDate', setBy: 'prompt', default: {value: '2026-03-02'}},
                    range: {
                        type: 'dateRange',
                        setBy: 'prompt',
                        default: {value: 'mtd'},
                        asOf: {$var: 'asOf'}
                    }
                },
                root: 'note',
                elements: {note: {component: 'markdown', config: {text: 'x'}}}
            },
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: null,
            mode: 'run'
        });
        onTestFinished(() => model.destroy());
        const {container} = render(blueprintView({model})),
            picker = container.querySelector('.xh-blueprint-view__toolbar .xh-date-range-picker');
        expect(picker.textContent).toContain('2026-03-01');
        expect(picker.textContent).toContain('2026-03-02');
    });

    it('follows an asOf its date range gains once its picker is built', async () => {
        const model = new BlueprintModel({
            blueprint: {
                schema: {blueprint: 1},
                variables: {
                    asOf: {type: 'localDate', setBy: 'prompt', default: {value: '2026-03-02'}},
                    range: {type: 'dateRange', setBy: 'prompt', default: {value: 'mtd'}}
                },
                root: 'note',
                elements: {note: {component: 'markdown', config: {text: 'x'}}}
            },
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: null,
            mode: 'design',
            access: 'write'
        });
        onTestFinished(() => model.destroy());
        const {container} = render(blueprintView({model})),
            text = () =>
                container.querySelector('.xh-blueprint-view__toolbar .xh-date-range-picker')
                    .textContent;
        model.applyEdit({
            ops: [{op: 'set', path: '/variables/range/asOf', value: {$var: 'asOf'}}]
        });
        await waitFor(() => expect(text()).toContain('2026-03-02'));
    });

    it('prompts for a date range with a picker, and for a period as text', async () => {
        const model = new BlueprintModel({
            blueprint: {
                schema: {blueprint: 1},
                variables: {
                    range: {type: 'dateRange', label: 'Range', setBy: 'prompt'},
                    window: {type: 'period', label: 'Window', setBy: 'prompt'}
                },
                root: 'note',
                elements: {note: {component: 'markdown', config: {text: 'x'}}}
            },
            catalog: portfolioCatalog,
            registry: scenarioRegistry(),
            dataProvider: null,
            mode: 'run'
        });
        onTestFinished(() => model.destroy());
        const {container} = render(blueprintView({model}));
        expect(
            container.querySelector('.xh-blueprint-view__toolbar .xh-date-range-picker')
        ).toBeTruthy();
        expect(screen.getByText('Window')).toBeTruthy();
        expect(() => model.setVariable('window', '3m')).toThrow();
        model.setVariable('window', '3M');
        expect(model.getVariable('window').value).toBe('3M');
    });

    it('draws its label beside its input', () => {
        const model = open(
            {type: 'string', options: {values: ['EU', 'US']}},
            {component: 'select', config: {label: 'Region'}}
        );
        render(blueprintView({model}));
        expect(screen.getByText('Region')).toBeTruthy();
    });

    describe('toolbar', () => {
        function show(elements: Record<string, BlueprintElement>, variables = {}, sources = {}) {
            const model = new BlueprintModel({
                blueprint: {schema: {blueprint: 1}, variables, sources, root: 'bar', elements},
                catalog: portfolioCatalog,
                registry: scenarioRegistry(),
                dataProvider: new FakeBlueprintDataProvider({catalog: portfolioCatalog}),
                mode: 'run'
            });
            onTestFinished(() => model.destroy());
            return {model, ...render(blueprintView({model}))};
        }

        it('never puts its only child in an overflow menu', () => {
            show(
                {
                    bar: {component: 'toolbar', config: {}, children: [{id: 'flag'}]},
                    flag: {component: 'switchInput', config: {label: 'Live'}}
                },
                {live: {type: 'bool', setBy: {element: 'flag'}}}
            );
            expect(screen.getByText('Live')).toBeTruthy();
        });

        it('lays out its inputs in a row, with a toolbar separator and a filler', () => {
            const {container} = show(
                {
                    bar: {
                        component: 'toolbar',
                        config: {overflowMenu: false},
                        children: [{id: 'region'}, {id: 'rule'}, {id: 'gap'}, {id: 'flag'}]
                    },
                    region: {component: 'select', config: {label: 'Region'}},
                    rule: {component: 'separator', config: {}},
                    gap: {component: 'spacer', config: {}},
                    flag: {component: 'switchInput', config: {label: 'Live'}}
                },
                {
                    region: {
                        type: 'string',
                        options: {values: ['EU']},
                        setBy: {element: 'region'}
                    },
                    live: {type: 'bool', setBy: {element: 'flag'}}
                }
            );
            const bar = container.querySelector('.xh-toolbar');
            expect(bar).toBeTruthy();
            expect(bar.querySelector('.xh-toolbar__separator')).toBeTruthy();
            expect(bar.querySelector('.xh-blueprint-spacer--fill')).toBeTruthy();
            expect(screen.getByText('Live')).toBeTruthy();
        });

        it('scrolls what does not fit into a menu, and gives a filter chooser a fixed width', () => {
            const {model} = show(
                {
                    bar: {
                        component: 'toolbar',
                        config: {},
                        children: [{id: 'chooser'}, {id: 'flag'}]
                    },
                    chooser: {component: 'filterChooser', config: {source: 'positions'}},
                    flag: {component: 'switchInput', config: {label: 'Live'}}
                },
                {
                    asOf: {type: 'localDate', default: {value: '2026-03-02'}},
                    f: {type: 'filter', setBy: {element: 'chooser'}},
                    live: {type: 'bool', setBy: {element: 'flag'}}
                },
                {positions: {dataset: 'positions', params: {asOf: {$var: 'asOf'}}}}
            );
            expect(document.querySelector('.xh-toolbar--overflow')).toBeTruthy();
            const chooser = new FilterChooserWidgetModel({
                blueprintModel: model,
                id: 'chooser',
                renderElement: () => null
            });
            onTestFinished(() => chooser.destroy());
            expect(chooser.inputProps).toMatchObject({width: 250, flex: 'none'});
        });

        it('refuses a widget that is not an input, separator or spacer', () => {
            expect(() =>
                show({
                    bar: {component: 'toolbar', config: {}, children: [{id: 'note'}]},
                    note: {component: 'markdown', config: {text: 'x'}}
                })
            ).toThrow(
                /toolbar cannot hold 'note'.* It takes input widgets, separator and spacer\./
            );
        });

        it("draws in a panel's top or bottom bar, and only a toolbar may", () => {
            show({
                bar: {
                    component: 'panel',
                    config: {title: 'Page'},
                    children: [{id: 'top', slot: 'tbar'}, {id: 'body'}]
                },
                top: {
                    component: 'toolbar',
                    config: {overflowMenu: false},
                    children: [{id: 'flag'}]
                },
                flag: {component: 'switchInput', config: {label: 'Live'}},
                body: {component: 'markdown', config: {text: 'Body'}}
            });
            const tbar = document.querySelector('.xh-panel .xh-toolbar');
            expect(tbar?.textContent).toContain('Live');
            expect(screen.getByText('Body')).toBeTruthy();

            // A card holds its bars around a body that fills the rest.
            const {container} = show({
                bar: {
                    component: 'panel',
                    config: {style: 'card'},
                    children: [{id: 'top', slot: 'tbar'}, {id: 'body'}]
                },
                top: {component: 'toolbar', config: {}, children: []},
                body: {component: 'markdown', config: {text: 'Card body'}}
            });
            const content = container.querySelector('.xh-card__content');
            expect(content.querySelector(':scope > .xh-toolbar')).toBeTruthy();
            expect(content.querySelector(':scope > .xh-blueprint-panel__body')?.textContent).toBe(
                'Card body'
            );

            expect(() =>
                show({
                    bar: {component: 'panel', config: {}, children: [{id: 'top', slot: 'tbar'}]},
                    top: {component: 'markdown', config: {text: 'x'}}
                })
            ).toThrow(/only a toolbar/);
        });
    });
});
