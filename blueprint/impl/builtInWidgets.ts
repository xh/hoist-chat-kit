import type {PlainObject} from '@xh/hoist/core';
import {castArray, compact, isEmpty, isString, uniq} from 'lodash';
import type {ActionSpec, WidgetDemand, WidgetSpec} from '../BlueprintRegistry';

// Plain data and pure functions only, so a validator under plain Node can load these.

//------------------
// Widgets
//------------------
const dashCanvas: WidgetSpec = {
    name: 'dashCanvas',
    version: 1,
    label: 'Dashboard',
    terms: ['dashboard', 'canvas', 'page', 'layout'],
    guidance:
        'A 12-column grid of widgets. Each child reference gives x, y, w and h in grid units. Use it as the root of a dashboard, or as the content of a tab.',
    category: 'container',
    config: {
        type: 'object',
        additionalProperties: false,
        properties: {
            columns: {
                type: 'integer',
                minimum: 1,
                maximum: 24,
                description: 'Columns in the grid. Default 12.'
            },
            rowHeight: {
                type: 'integer',
                minimum: 20,
                maximum: 200,
                description: 'Height of one row in pixels. Default 50.'
            }
        }
    },
    children: {
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'x', 'y', 'w', 'h'],
            properties: {
                id: {
                    type: 'string'
                },
                x: {
                    type: 'integer',
                    minimum: 0
                },
                y: {
                    type: 'integer',
                    minimum: 0
                },
                w: {
                    type: 'integer',
                    minimum: 1
                },
                h: {
                    type: 'integer',
                    minimum: 1
                }
            }
        }
    },
    example: {
        component: 'dashCanvas',
        children: [
            {
                id: 'posGrid',
                x: 0,
                y: 0,
                w: 8,
                h: 6
            }
        ]
    }
};

const tabContainer: WidgetSpec = {
    name: 'tabContainer',
    version: 1,
    label: 'Tabs',
    terms: ['tabs', 'tab', 'pages'],
    guidance:
        "Shows one child at a time, under a row of tabs. Each child reference gives the tab's title. Children are usually dashCanvas elements.",
    category: 'container',
    config: {
        type: 'object',
        additionalProperties: false,
        properties: {}
    },
    children: {
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'title'],
            properties: {
                id: {
                    type: 'string'
                },
                title: {
                    type: 'string',
                    maxLength: 60
                },
                icon: {
                    type: 'string',
                    maxLength: 40
                }
            }
        }
    },
    example: {
        component: 'tabContainer',
        children: [
            {
                id: 'overview',
                title: 'Overview'
            },
            {
                id: 'detail',
                title: 'Detail'
            }
        ]
    }
};

const cubeGrid: WidgetSpec = {
    name: 'cubeGrid',
    version: 1,
    label: 'Grid',
    terms: ['grid', 'table', 'pivot', 'list of positions', 'blotter'],
    guidance:
        "The one grid widget. Grouped into a tree with groupBy, or flat without it. Use it for positions, orders and any tabular data. Its selection is an output: a filter of the selected row's group path, or one field's value.",
    category: 'data',
    config: {
        type: 'object',
        additionalProperties: false,
        required: ['source'],
        properties: {
            source: {
                type: 'string',
                'x-source': true
            },
            title: {
                type: 'string',
                maxLength: 100,
                'x-binding': true
            },
            groupBy: {
                type: 'array',
                items: {
                    type: 'string'
                },
                maxItems: 6,
                'x-field': 'dimension',
                'x-binding': true,
                description: 'Dimensions to group by, outermost first.'
            },
            columnState: {
                type: 'array',
                maxItems: 60,
                'x-field': 'any',
                description:
                    'Columns in display order: a field name, or an object with field and optional width, hidden, pinned, format and renderer. The field group names the tree column.',
                items: {
                    anyOf: [
                        {
                            type: 'string'
                        },
                        {
                            type: 'object',
                            additionalProperties: false,
                            required: ['field'],
                            properties: {
                                field: {
                                    type: 'string'
                                },
                                width: {
                                    type: 'integer',
                                    minimum: 30,
                                    maximum: 800
                                },
                                hidden: {
                                    type: 'boolean'
                                },
                                format: {
                                    'x-format': true
                                },
                                renderer: {
                                    'x-renderer': true
                                },
                                pinned: {
                                    enum: ['left', 'right']
                                }
                            }
                        }
                    ]
                }
            },
            sortBy: {
                anyOf: [
                    {
                        type: 'string',
                        pattern: '^[A-Za-z0-9_-]+(\\|(asc|desc))?(\\|abs)?$'
                    },
                    {
                        type: 'array',
                        items: {
                            type: 'string',
                            pattern: '^[A-Za-z0-9_-]+(\\|(asc|desc))?(\\|abs)?$'
                        },
                        maxItems: 6
                    }
                ],
                description:
                    'Hoist sort form: a field, field|desc, or field|desc|abs, or a list of them. The field group names the tree column.'
            },
            filter: {
                'x-filter': true,
                'x-binding': true,
                description: 'A Hoist filter applied in the browser.'
            },
            expandLevel: {
                type: 'integer',
                minimum: 0,
                maximum: 6
            },
            summaryRow: {
                type: 'boolean'
            }
        }
    },
    presetPaths: ['/columnState', '/sortBy'],
    outputs: [
        {
            name: 'selection',
            type: 'filter',
            folds: true,
            description:
                "The selected row's group path, as a filter, such as sector = Technology AND symbol = NVDA."
        },
        {
            name: 'selected',
            type: 'field',
            args: {
                field: "A field of the grid's source."
            },
            description:
                "One field's value on the selected row. Null unless the row has one value for it."
        }
    ],
    size: {
        default: {
            w: 6,
            h: 6
        },
        min: {
            w: 3,
            h: 3
        }
    },
    example: {
        component: 'cubeGrid',
        config: {
            source: 'positions',
            groupBy: ['region'],
            columnState: ['mktVal', 'pnlDay']
        }
    }
};

const chart: WidgetSpec = {
    name: 'chart',
    version: 1,
    label: 'Chart',
    terms: ['chart', 'graph', 'plot', 'trend', 'bar chart', 'line chart'],
    guidance:
        'A Hoist chart. If x is a dimension, the chart aggregates its source by x. If x is a date or time field, it plots rows as they are, for a time series.',
    category: 'data',
    config: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'type', 'x', 'y'],
        properties: {
            source: {
                type: 'string',
                'x-source': true
            },
            title: {
                type: 'string',
                maxLength: 100,
                'x-binding': true
            },
            type: {
                enum: ['line', 'column', 'bar', 'area', 'pie', 'scatter']
            },
            x: {
                type: 'string',
                'x-field': 'any'
            },
            y: {
                type: 'array',
                items: {
                    type: 'string'
                },
                minItems: 1,
                maxItems: 8,
                'x-field': 'measure'
            },
            groupBy: {
                type: 'string',
                'x-field': 'dimension',
                description: 'A dimension that splits the first y into one series per value.'
            },
            stacking: {
                enum: ['normal', 'percent']
            },
            filter: {
                'x-filter': true,
                'x-binding': true
            },
            sortBy: {
                type: 'string',
                pattern: '^[A-Za-z0-9_-]+(\\|(asc|desc))?$'
            },
            top: {
                type: 'integer',
                minimum: 1,
                maximum: 100
            }
        }
    },
    presetPaths: ['/type'],
    size: {
        default: {
            w: 6,
            h: 5
        },
        min: {
            w: 3,
            h: 3
        }
    },
    example: {
        component: 'chart',
        config: {
            source: 'positions',
            type: 'column',
            x: 'region',
            y: ['pnlDay']
        }
    }
};

const statCardStrip: WidgetSpec = {
    name: 'statCardStrip',
    version: 1,
    label: 'Stat cards',
    terms: ['stat cards', 'KPIs', 'headline numbers', 'metrics', 'tiles'],
    guidance:
        'A row of headline numbers, each the total of a field over the source. A card with agg count and no field counts rows. Values always come from a source, never from config.',
    category: 'data',
    config: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'cards'],
        properties: {
            source: {
                type: 'string',
                'x-source': true
            },
            title: {
                type: 'string',
                maxLength: 100,
                'x-binding': true
            },
            cards: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        field: {
                            type: 'string'
                        },
                        label: {
                            type: 'string',
                            maxLength: 40
                        },
                        format: {
                            'x-format': true
                        },
                        agg: {
                            enum: ['count', 'SUM', 'AVG', 'MIN', 'MAX', 'UNIQUE']
                        }
                    }
                }
            }
        }
    },
    size: {
        default: {
            w: 12,
            h: 2
        },
        min: {
            w: 3,
            h: 2
        }
    },
    example: {
        component: 'statCardStrip',
        config: {
            source: 'positions',
            cards: [
                {
                    field: 'mktVal'
                },
                {
                    agg: 'count',
                    label: 'Positions'
                }
            ]
        }
    }
};

const groupingChooser: WidgetSpec = {
    name: 'groupingChooser',
    version: 1,
    label: 'Grouping chooser',
    terms: ['group by chooser', 'grouping picker', 'let users group'],
    guidance:
        "Lets a user choose dimensions to group by. Its value is a string[] variable that a grid's groupBy binds.",
    category: 'input',
    config: {
        type: 'object',
        additionalProperties: false,
        required: ['dimensions'],
        properties: {
            dimensions: {
                type: 'array',
                items: {
                    type: 'string'
                },
                minItems: 1,
                maxItems: 20,
                'x-field': 'dimension'
            }
        }
    },
    value: {
        type: 'string[]'
    },
    size: {
        default: {
            w: 4,
            h: 1
        }
    },
    example: {
        component: 'groupingChooser',
        config: {
            dimensions: ['fund', 'sector', 'region']
        }
    }
};

const buttonGroup: WidgetSpec = {
    name: 'buttonGroup',
    version: 1,
    label: 'Buttons',
    terms: ['buttons', 'button', 'action'],
    guidance: 'A row of buttons, each running an action.',
    category: 'action',
    config: {
        type: 'object',
        additionalProperties: false,
        required: ['buttons'],
        properties: {
            buttons: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['label', 'action'],
                    properties: {
                        label: {
                            type: 'string',
                            maxLength: 40
                        },
                        icon: {
                            type: 'string',
                            maxLength: 40
                        },
                        action: {
                            'x-action': true
                        }
                    }
                }
            }
        }
    },
    size: {
        default: {
            w: 4,
            h: 1
        }
    },
    example: {
        component: 'buttonGroup',
        config: {
            buttons: [
                {
                    label: 'Refresh',
                    action: {
                        type: 'refresh'
                    }
                }
            ]
        }
    }
};

const buttonGroupInput: WidgetSpec = {
    name: 'buttonGroupInput',
    version: 1,
    label: 'Toggle',
    terms: ['toggle', 'segmented control', 'switch between'],
    guidance: 'A segmented control that picks one option. Its value is a string variable.',
    category: 'input',
    config: {
        type: 'object',
        additionalProperties: false,
        required: ['options'],
        properties: {
            options: {
                type: 'array',
                minItems: 2,
                maxItems: 8,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['value', 'label'],
                    properties: {
                        value: {
                            type: 'string'
                        },
                        label: {
                            type: 'string',
                            maxLength: 30
                        }
                    }
                }
            }
        }
    },
    value: {
        type: 'string'
    },
    size: {
        default: {
            w: 3,
            h: 1
        }
    },
    example: {
        component: 'buttonGroupInput',
        config: {
            options: [
                {
                    value: 'a',
                    label: 'A'
                },
                {
                    value: 'b',
                    label: 'B'
                }
            ]
        }
    }
};

const WIDGET_SPECS: WidgetSpec[] = [
    dashCanvas,
    tabContainer,
    cubeGrid,
    chart,
    statCardStrip,
    groupingChooser,
    buttonGroup,
    buttonGroupInput
];

//------------------
// Widget demand
//------------------
// Names a grid's tree column in `columnState` and `sortBy`.
const TREE_COLUMN = 'group';

const DEMANDS: Record<string, (config: PlainObject) => WidgetDemand> = {
    cubeGrid: cfg => ({
        fields: fieldNames([
            ...castArray(cfg.columnState ?? []).map(it => (isString(it) ? it : it?.field)),
            ...castArray(cfg.sortBy ?? []).map(it => String(it).split('|')[0]),
            ...filterFields(cfg.filter),
            ...castArray(cfg.groupBy ?? [])
        ]),
        groupBy: castArray(cfg.groupBy ?? [])
    }),
    chart: cfg => ({
        fields: fieldNames([
            cfg.x,
            ...castArray(cfg.y ?? []),
            cfg.groupBy,
            ...filterFields(cfg.filter)
        ]),
        groupBy: compact([cfg.x, cfg.groupBy])
    }),
    statCardStrip: cfg => ({
        fields: fieldNames(castArray(cfg.cards ?? []).map(it => it?.field)),
        groupBy: []
    })
};

function fieldNames(names: unknown[]): string[] {
    return uniq(names.filter(it => isString(it) && it !== TREE_COLUMN)) as string[];
}

function filterFields(filter: unknown): string[] {
    if (!filter || typeof filter !== 'object') return [];
    const f = filter as PlainObject;
    if (Array.isArray(f.filters)) return f.filters.flatMap(filterFields);
    return isString(f.field) ? [f.field] : [];
}

//------------------
// Widget checks
//------------------
const VALIDATORS: Record<string, WidgetSpec['validate']> = {
    cubeGrid: (cfg, {blueprint, id}) => {
        const path = `/elements/${id}/config/columnState`,
            isPreset = Object.values(blueprint.presets ?? {}).some(it =>
                it.controls?.some(c => c.path === path)
            );
        if (!isEmpty(cfg.columnState) || isPreset) return [];
        return [
            {
                code: 'cubeGrid.noColumns',
                severity: 'warning',
                path: '',
                message: 'the grid has no columns, so it shows only its groups. Add columnState.'
            }
        ];
    }
};

export const BUILT_IN_WIDGETS: WidgetSpec[] = WIDGET_SPECS.map(it => ({
    ...it,
    ...(DEMANDS[it.name] ? {demand: DEMANDS[it.name]} : {}),
    ...(VALIDATORS[it.name] ? {validate: VALIDATORS[it.name]} : {})
}));

//------------------
// Actions
//------------------
export const BUILT_IN_ACTIONS: ActionSpec[] = [
    {
        name: 'setVariable',
        params: {
            variable: 'A variable whose setBy is prompt, an element without an output, or action.',
            value: 'A literal or {"$var": name}.'
        }
    },
    {name: 'resetVariable', params: {variable: 'As for setVariable. Restores its default.'}},
    {name: 'refresh', params: {sources: 'string[], optional. Default all sources.'}},
    {name: 'navigate', params: {route: 'string', params: 'object, optional'}},
    {name: 'openUrl', params: {url: "string. Only URLs on the app's allow list open."}}
];
