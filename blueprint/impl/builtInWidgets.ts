import type {PlainObject} from '@xh/hoist/core';
import type {FromExtendedSchema} from 'json-schema-to-ts';
import {castArray, compact, isEmpty, isString, mapValues, mergeWith, uniq} from 'lodash';
import type {BlueprintIssue} from '../Blueprint';
import type {BlueprintSchema, BlueprintSchemaExtension} from '../BlueprintSchema';
import type {
    ActionSpec,
    RendererSpec,
    ResolverSpec,
    WidgetDemand,
    WidgetSpec
} from '../BlueprintRegistry';
import {parentOf} from './elements';
import {templateDemand} from './template';

// Plain data and pure functions only, so a validator under plain Node can load these.

//------------------
// Widget config schemas
//------------------
const ACTION = {
    type: 'object',
    required: ['type'],
    properties: {type: {type: 'string'}}
} as const satisfies BlueprintSchema;

/** An action prop: one action, or a list of up to 8 that run as steps. */
const ACTION_PROP = {
    'x-action': true,
    anyOf: [ACTION, {type: 'array', minItems: 1, maxItems: 8, items: ACTION}]
} as const satisfies BlueprintSchema;

const EMPTY_TEXT = {
    type: 'string',
    maxLength: 200,
    description: 'Text shown while the container has no children.'
} as const satisfies BlueprintSchema;

const DASH_CANVAS_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        emptyText: EMPTY_TEXT,
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
} as const satisfies BlueprintSchema;

const TAB_CONTAINER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {emptyText: EMPTY_TEXT}
} as const satisfies BlueprintSchema;

const PANEL_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {type: 'string', maxLength: 100, 'x-binding': true},
        icon: {type: 'string', maxLength: 40, description: 'A Font Awesome icon name.'},
        style: {
            type: 'string',
            enum: ['plain', 'card'],
            default: 'plain',
            description: 'plain draws a panel with a header. card draws a bordered group.'
        },
        intent: {
            type: 'string',
            enum: ['none', 'primary', 'success', 'warning', 'danger'],
            description: "Colors a card style panel's border and title."
        },
        collapsible: {type: 'boolean', default: false},
        collapsed: {type: 'boolean', default: false},
        compactHeader: {type: 'boolean', default: false},
        emptyText: EMPTY_TEXT
    }
} as const satisfies BlueprintSchema;

const BOX_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        direction: {type: 'string', enum: ['column', 'row'], default: 'column'},
        fill: {
            type: 'boolean',
            default: true,
            description: 'True to fill its parent. False to take the size of its children.'
        },
        gap: {type: 'integer', minimum: 0, maximum: 64, description: 'Pixels between children.'},
        align: {
            type: 'string',
            enum: ['stretch', 'start', 'center', 'end'],
            default: 'stretch',
            description: 'Where children sit across the direction.'
        }
    }
} as const satisfies BlueprintSchema;

const MARKDOWN_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
        source: {
            type: 'string',
            'x-source': true,
            description: 'The source an undotted reference reads a field of.'
        },
        text: {type: 'string', maxLength: 10000, 'x-template': true}
    }
} as const satisfies BlueprintSchema;

const CALLOUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
        source: MARKDOWN_SCHEMA.properties.source,
        intent: {
            type: 'string',
            enum: ['primary', 'success', 'warning', 'danger', 'none'],
            default: 'primary',
            description: 'none is neutral, with no icon.'
        },
        title: {type: 'string', maxLength: 200, 'x-template': true},
        text: MARKDOWN_SCHEMA.properties.text
    }
} as const satisfies BlueprintSchema;

const LABEL = {type: 'string', maxLength: 40, description: 'Shown beside the input.'} as const;

const SELECT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {label: LABEL, placeholder: {type: 'string', maxLength: 60}}
} as const satisfies BlueprintSchema;

const DATE_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {label: LABEL}
} as const satisfies BlueprintSchema;

const DATE_RANGE_PICKER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        label: LABEL,
        presets: {
            type: 'array',
            items: {type: 'string'},
            maxItems: 20,
            description:
                "The preset tokens to offer, such as mtd and ytd. Default Hoist's usual set. Its variable's preset is offered too."
        },
        asOf: {
            type: 'string',
            'x-binding': true,
            description: 'The date, as YYYY-MM-DD, that its ranges run to. Default today.'
        }
    }
} as const satisfies BlueprintSchema;

const NUMBER_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        label: LABEL,
        min: {type: 'number'},
        max: {type: 'number'},
        precision: {type: 'integer', minimum: 0, maximum: 8}
    }
} as const satisfies BlueprintSchema;

const TEXT_INPUT_SCHEMA = SELECT_SCHEMA;

const SWITCH_INPUT_SCHEMA = DATE_INPUT_SCHEMA;

const SLIDER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['min', 'max'],
    properties: {
        label: LABEL,
        min: {type: 'number'},
        max: {type: 'number'},
        step: {type: 'number', minimum: 0.000001, default: 1}
    }
} as const satisfies BlueprintSchema;

const FILTER_CHOOSER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['source'],
    properties: {
        source: {type: 'string', 'x-source': true},
        label: LABEL,
        fields: {
            type: 'array',
            items: {type: 'string'},
            'x-field': 'dimension',
            description: "The dimensions to offer. Default all of the source's."
        }
    }
} as const satisfies BlueprintSchema;

const TOOLBAR_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        vertical: {type: 'boolean', default: false},
        overflowMenu: {
            type: 'boolean',
            default: true,
            description: 'True to put the children that do not fit in a menu at its end.'
        }
    }
} as const satisfies BlueprintSchema;

const SEPARATOR_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {label: {type: 'string', maxLength: 60}}
} as const satisfies BlueprintSchema;

const SPACER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        size: {
            type: 'integer',
            minimum: 1,
            maximum: 400,
            description: 'Pixels along its parent. Leave unset to take all the room left.'
        }
    }
} as const satisfies BlueprintSchema;

const CUBE_GRID_SCHEMA = {
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
                'Columns in display order: a field name, or an object with field and optional width, hidden and pinned. Only state: how a column shows goes in columns. The field group names the tree column.',
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
                            pinned: {
                                enum: ['left', 'right']
                            }
                        }
                    }
                ]
            }
        },
        columns: {
            type: 'object',
            'x-field': 'any',
            description:
                'How each column shows, keyed by field, or group for the tree column. Keep the defaults unless the user asks.',
            additionalProperties: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    headerName: {
                        type: 'string',
                        maxLength: 100,
                        description: 'The header text. Default the field label.'
                    },
                    headerTooltip: {
                        type: 'string',
                        maxLength: 500,
                        description: 'The header tooltip. Default the field description.'
                    },
                    headerAlign: {
                        enum: ['left', 'center', 'right'],
                        description: 'How the header aligns. Default as its cells.'
                    },
                    align: {
                        enum: ['left', 'center', 'right'],
                        description: 'How the cells align. Default right for a number, else left.'
                    },
                    tooltip: {
                        type: 'boolean',
                        description: 'Show the value on hover, for a column too narrow for it.'
                    },
                    highlightOnChange: {
                        type: 'boolean',
                        description: 'Flash a cell when its value changes, as in a live grid.'
                    },
                    minWidth: {
                        type: 'integer',
                        minimum: 20,
                        maximum: 800,
                        description: 'The narrowest a user or a flex column may make it, in pixels.'
                    },
                    maxWidth: {
                        type: 'integer',
                        minimum: 20,
                        maximum: 2000,
                        description: 'The widest a user or a flex column may make it, in pixels.'
                    },
                    flex: {
                        anyOf: [{type: 'boolean'}, {type: 'number', minimum: 0, maximum: 10}],
                        description:
                            'Stretch to fill the grid, sharing the width with other flex columns in proportion.'
                    },
                    chooserName: {
                        type: 'string',
                        maxLength: 100,
                        description: "The column's name in the column chooser. Default its header."
                    },
                    chooserGroup: {
                        type: 'string',
                        maxLength: 100,
                        description:
                            "The column chooser's group for it. Default the field's category."
                    },
                    chooserDescription: {
                        type: 'string',
                        maxLength: 500,
                        description:
                            'The text the column chooser shows for it. Default the field description.'
                    },
                    exportName: {
                        type: 'string',
                        maxLength: 100,
                        description: 'Its header in an export. Default its header.'
                    },
                    format: {
                        'x-format': true,
                        anyOf: [{type: 'string'}, {type: 'object'}],
                        description: "Its number or date format, over the field's own."
                    },
                    renderer: {
                        'x-renderer': true,
                        anyOf: [
                            {type: 'string'},
                            {
                                type: 'object',
                                required: ['name'],
                                properties: {name: {type: 'string'}}
                            }
                        ],
                        description: "How its cells draw, in place of the field's renderer."
                    }
                }
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
            description: 'A Hoist filter applied in the browser.',
            type: 'object'
        },
        expandLevel: {
            type: 'integer',
            minimum: 0,
            maximum: 6
        },
        summaryRow: {
            type: 'boolean',
            default: false
        },
        treeStyle: {
            enum: [
                'highlights',
                'colors',
                'borders',
                'highlightsAndBorders',
                'colorsAndBorders',
                'none'
            ],
            default: 'highlights',
            description:
                'How group rows stand out: highlighted, colored, set off by borders, or both.'
        },
        stripeRows: {
            type: 'boolean',
            default: true,
            description: 'Alternate the background of rows.'
        },
        rowBorders: {
            type: 'boolean',
            default: true,
            description: 'Draw a border between rows.'
        },
        cellBorders: {
            type: 'boolean',
            default: false,
            description: 'Draw a border between cells.'
        },
        showHover: {
            type: 'boolean',
            default: false,
            description: 'Highlight the row under the pointer.'
        },
        sizingMode: {
            enum: ['tiny', 'compact', 'standard', 'large'],
            description: "The size of the grid's text and rows. Default the app's sizing mode."
        },
        showGroupRowCounts: {
            type: 'boolean',
            default: true,
            description: 'Show the count of rows in each group row.'
        },
        hideHeaders: {
            type: 'boolean',
            default: false,
            description: 'Hide the row of column headers.'
        },
        emptyText: {
            type: 'string',
            maxLength: 200,
            default: 'No data',
            description: 'Text to show when the grid has no rows.'
        },
        groupRowHeight: {
            type: 'integer',
            minimum: 16,
            maximum: 100,
            description:
                'The height of a group row in pixels, in place of its sizing mode. Default by sizing mode.'
        }
    }
} as const satisfies BlueprintSchema;

// The top-level Highcharts options a chart's `highchartsConfig` may set.
const HIGHCHARTS_KEYS = [
    'title',
    'subtitle',
    'legend',
    'tooltip',
    'xAxis',
    'yAxis',
    'plotOptions',
    'chart'
];

const CHART_SCHEMA = {
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
        xTitle: {
            type: 'string',
            maxLength: 100,
            'x-binding': true,
            description: "Title of the x-axis. Default the x field's label."
        },
        yTitle: {
            type: 'string',
            maxLength: 100,
            'x-binding': true,
            description: "Title of the y-axis. Default the y field's label, if there is one y."
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
            'x-binding': true,
            type: 'object'
        },
        sortBy: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]+(\\|(asc|desc))?$'
        },
        top: {
            type: 'integer',
            minimum: 1,
            maximum: 100
        },
        highchartsConfig: {
            type: 'object',
            description: `Highcharts options merged over the chart's own: ${HIGHCHARTS_KEYS.join(', ')}. No markup, functions, events or series data.`
        }
    }
} as const satisfies BlueprintSchema;

const PROPERTY_TABLE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'fields'],
    properties: {
        source: {type: 'string', 'x-source': true},
        title: {type: 'string', maxLength: 100, 'x-binding': true},
        fields: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            items: {
                anyOf: [
                    {type: 'string', 'x-field': 'any'},
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['field'],
                        properties: {
                            field: {type: 'string', 'x-field': 'any'},
                            label: {type: 'string', maxLength: 60},
                            format: {'x-format': true, anyOf: [{type: 'string'}, {type: 'object'}]},
                            renderer: {
                                'x-renderer': true,
                                anyOf: [{type: 'string'}, {type: 'object'}]
                            }
                        }
                    }
                ]
            }
        },
        filter: {'x-filter': true, 'x-binding': true, type: 'object'},
        columns: {type: 'integer', minimum: 1, maximum: 4, default: 1},
        labelSide: {enum: ['left', 'top'], default: 'left'}
    }
} as const satisfies BlueprintSchema;

const HEATMAP_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'x', 'y', 'value'],
    properties: {
        source: {type: 'string', 'x-source': true},
        title: {type: 'string', maxLength: 100, 'x-binding': true},
        x: {type: 'string', 'x-field': 'dimension', description: 'The dimension across.'},
        y: {type: 'string', 'x-field': 'dimension', description: 'The dimension down.'},
        value: {type: 'string', 'x-field': 'measure', description: 'Colors each cell.'},
        colorMode: {
            enum: ['diverging', 'sequential'],
            default: 'diverging',
            description: 'diverging colors below zero red and above green, as for P&L.'
        },
        filter: {'x-filter': true, 'x-binding': true, type: 'object'}
    }
} as const satisfies BlueprintSchema;

const TREEMAP_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'value'],
    properties: {
        source: {type: 'string', 'x-source': true},
        title: {type: 'string', maxLength: 100, 'x-binding': true},
        groupBy: {
            type: 'array',
            items: {type: 'string'},
            minItems: 1,
            maxItems: 4,
            'x-field': 'dimension',
            'x-binding': true,
            description: 'The dimensions that nest the nodes, outermost first.'
        },
        value: {type: 'string', 'x-field': 'measure', description: 'Sizes each node.'},
        heat: {
            type: 'string',
            'x-field': 'measure',
            description: 'Colors each node: green above zero, red below. Default value.'
        },
        colorMode: {enum: ['linear', 'wash', 'none'], default: 'linear'},
        maxDepth: {
            type: 'integer',
            minimum: 1,
            maximum: 4,
            description: 'How many levels of groupBy to draw. Default all.'
        },
        filter: {'x-filter': true, 'x-binding': true, type: 'object'}
    }
} as const satisfies BlueprintSchema;

const FORMAT_PROP = {
    'x-format': true,
    anyOf: [{type: 'string'}, {type: 'object'}]
} as const satisfies BlueprintSchema;

const STAT_CARD_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['source'],
    properties: {
        source: {type: 'string', 'x-source': true},
        field: {type: 'string', 'x-field': 'measure'},
        label: {type: 'string', maxLength: 40},
        format: FORMAT_PROP,
        agg: {enum: ['count', 'SUM', 'AVG', 'MIN', 'MAX', 'UNIQUE']},
        deltaField: {type: 'string', 'x-field': 'measure'},
        deltaFormat: FORMAT_PROP,
        deltaLabel: {type: 'string', maxLength: 40},
        invert: {type: 'boolean'},
        intent: {enum: ['none', 'primary', 'success', 'warning', 'danger']},
        trend: {
            type: 'string',
            'x-field': 'any',
            description:
                'A series field to draw as a sparkline under the figure, where the source has one row.'
        }
    }
} as const satisfies BlueprintSchema;

const TILE_FRAME_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {type: 'string', maxLength: 100, 'x-binding': true},
        minTileWidth: {type: 'integer', minimum: 20, maximum: 2000},
        maxTileWidth: {type: 'integer', minimum: 20, maximum: 2000},
        minTileHeight: {type: 'integer', minimum: 20, maximum: 2000},
        maxTileHeight: {type: 'integer', minimum: 20, maximum: 2000},
        desiredRatio: {
            type: 'number',
            minimum: 0.1,
            maximum: 10,
            default: 1,
            description: 'Tile width over height.'
        },
        spacing: {type: 'integer', minimum: 0, maximum: 64, default: 0},
        emptyText: EMPTY_TEXT
    }
} as const satisfies BlueprintSchema;

const GROUPING_CHOOSER_SCHEMA = {
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
} as const satisfies BlueprintSchema;

const BUTTON_GROUP_SCHEMA = {
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
                    action: ACTION_PROP
                }
            }
        }
    }
} as const satisfies BlueprintSchema;

const BUTTON_GROUP_INPUT_SCHEMA = {
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
} as const satisfies BlueprintSchema;

/** The config of a `dashCanvas` widget, with bindings resolved. */
export type DashCanvasWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof DASH_CANVAS_SCHEMA
>;

/** The config of a `tabContainer` widget, with bindings resolved. */
export type PanelWidgetConfig = FromExtendedSchema<BlueprintSchemaExtension, typeof PANEL_SCHEMA>;

export type BoxWidgetConfig = FromExtendedSchema<BlueprintSchemaExtension, typeof BOX_SCHEMA>;

export type MarkdownWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof MARKDOWN_SCHEMA
>;

export type CalloutWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof CALLOUT_SCHEMA
>;

export type SelectWidgetConfig = FromExtendedSchema<BlueprintSchemaExtension, typeof SELECT_SCHEMA>;

export type DateInputWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof DATE_INPUT_SCHEMA
>;

export type DateRangePickerWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof DATE_RANGE_PICKER_SCHEMA
>;

export type NumberInputWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof NUMBER_INPUT_SCHEMA
>;

export type TextInputWidgetConfig = SelectWidgetConfig;

export type SwitchInputWidgetConfig = DateInputWidgetConfig;

export type SliderWidgetConfig = FromExtendedSchema<BlueprintSchemaExtension, typeof SLIDER_SCHEMA>;

export type FilterChooserWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof FILTER_CHOOSER_SCHEMA
>;

export type ToolbarWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof TOOLBAR_SCHEMA
>;

export type SeparatorWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof SEPARATOR_SCHEMA
>;

export type SpacerWidgetConfig = FromExtendedSchema<BlueprintSchemaExtension, typeof SPACER_SCHEMA>;

export type TabContainerWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof TAB_CONTAINER_SCHEMA
>;

/** The keys of a `cubeGrid` config that style the grid, each a `GridConfig` option of the same name. */
export const CUBE_GRID_STYLES = [
    'treeStyle',
    'stripeRows',
    'rowBorders',
    'cellBorders',
    'showHover',
    'sizingMode',
    'showGroupRowCounts',
    'hideHeaders',
    'emptyText',
    'groupRowHeight'
] as const;

/** The config of a `cubeGrid` widget, with bindings resolved. */
export type CubeGridWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof CUBE_GRID_SCHEMA
>;

/** The config of a `chart` widget, with bindings resolved. */
export type ChartWidgetConfig = FromExtendedSchema<BlueprintSchemaExtension, typeof CHART_SCHEMA>;

export type PropertyTableWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof PROPERTY_TABLE_SCHEMA
>;

export type HeatmapWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof HEATMAP_SCHEMA
>;

export type TreemapWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof TREEMAP_SCHEMA
>;

export type StatCardWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof STAT_CARD_SCHEMA
>;

export type TileFrameWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof TILE_FRAME_SCHEMA
>;

/** The config of a `groupingChooser` widget, with bindings resolved. */
export type GroupingChooserWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof GROUPING_CHOOSER_SCHEMA
>;

/** The config of a `buttonGroup` widget, with bindings resolved. */
export type ButtonGroupWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof BUTTON_GROUP_SCHEMA
>;

/** The config of a `buttonGroupInput` widget, with bindings resolved. */
export type ButtonGroupInputWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof BUTTON_GROUP_INPUT_SCHEMA
>;

//------------------
// Widgets
//------------------
const CHILD_ID_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {id: {type: 'string'}}
} as const satisfies BlueprintSchema;

const dashCanvas: WidgetSpec = {
    name: 'dashCanvas',
    version: 1,
    label: 'Dashboard',
    terms: ['dashboard', 'canvas', 'page', 'layout'],
    guidance:
        'A 12-column grid of widgets. Each child reference gives x, y, w and h in grid units. Use it as the root of a dashboard, or as the content of a tab.',
    category: 'container',
    config: DASH_CANVAS_SCHEMA,
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
    // Room for widgets of its own, where it sits on another canvas.
    size: {
        default: {
            w: 12,
            h: 8
        },
        min: {
            w: 3,
            h: 3
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
        "Shows one child at a time, under a row of tabs. Each child reference gives the tab's title. Children are usually dashCanvas elements. Keep tab titles to one or two words. Use the label a person would say, not a raw value.",
    category: 'container',
    config: TAB_CONTAINER_SCHEMA,
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
    // Room for widgets of its own, where it sits on another canvas.
    size: {
        default: {
            w: 12,
            h: 8
        },
        min: {
            w: 3,
            h: 3
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

const panel: WidgetSpec = {
    name: 'panel',
    version: 1,
    rendersPartial: true,
    label: 'Panel',
    terms: ['panel', 'section', 'group', 'card'],
    guidance:
        'A titled section that stacks its children top to bottom. style card draws a bordered group in place of a header. Use it to title a group of widgets, or to let a user collapse one. Each child takes an equal share of its height. Put a row box inside it to place children side by side. A child reference with slot tbar or bbar draws a toolbar above or below the content.',
    category: 'container',
    config: PANEL_SCHEMA,
    presetPaths: ['/collapsed'],
    children: {
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['id'],
            properties: {
                id: {type: 'string'},
                slot: {
                    enum: ['tbar', 'bbar'],
                    description: 'Draws the child, a toolbar, above or below the content.'
                }
            }
        }
    },
    size: {default: {w: 6, h: 6}, min: {w: 2, h: 2}},
    example: {
        component: 'panel',
        config: {title: 'Exposure', style: 'card'},
        children: [{id: 'exposureGrid'}]
    }
};

const box: WidgetSpec = {
    name: 'box',
    version: 1,
    rendersPartial: true,
    label: 'Box',
    terms: ['row', 'column', 'side by side', 'stack', 'layout'],
    guidance:
        'Arranges its children in a row or a column, with no chrome. Each child reference may give flex, a share of the room left, or a fixed width or height in pixels. A child with neither takes an equal share. Use a separator to divide children, and a spacer to push them apart. Keep align stretch for grids and charts: they have no size of their own, so another align leaves them no room across the box.',
    category: 'layout',
    config: BOX_SCHEMA,
    children: {
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['id'],
            properties: {
                id: {type: 'string'},
                flex: {type: 'number', minimum: 0, maximum: 12},
                width: {type: 'integer', minimum: 1, maximum: 4000},
                height: {type: 'integer', minimum: 1, maximum: 4000}
            }
        }
    },
    size: {default: {w: 12, h: 6}, min: {w: 2, h: 1}},
    example: {
        component: 'box',
        config: {direction: 'row', gap: 8},
        children: [{id: 'posGrid', flex: 2}, {id: 'divider'}, {id: 'sectorChart', flex: 1}]
    }
};

const separator: WidgetSpec = {
    name: 'separator',
    version: 1,
    label: 'Separator',
    terms: ['separator', 'divider', 'rule', 'line'],
    guidance:
        'A rule between its siblings: vertical in a row, horizontal in a column. A label names the section after it, or says a short word such as "or".',
    category: 'layout',
    config: SEPARATOR_SCHEMA,
    size: {default: {w: 12, h: 1}, min: {w: 1, h: 1}},
    example: {component: 'separator', config: {label: 'Detail'}}
};

const spacer: WidgetSpec = {
    name: 'spacer',
    version: 1,
    label: 'Spacer',
    terms: ['spacer', 'gap', 'filler'],
    guidance:
        'Empty room between its siblings, along its parent. With no size it takes all the room left, which pushes the siblings after it to the far end.',
    category: 'layout',
    config: SPACER_SCHEMA,
    size: {default: {w: 12, h: 1}, min: {w: 1, h: 1}},
    example: {component: 'spacer', config: {size: 16}}
};

const TEMPLATE_GUIDANCE =
    "Its text reads {variable} for a variable, and {source.field} for the total of a field over a source, by the field's aggregator and format. With a source set, {field} reads a field of it. A dimension has no total, so it reads blank. Write {{ and }} for braces. Values cannot carry markdown of their own.";

const markdown: WidgetSpec = {
    name: 'markdown',
    version: 1,
    rendersPartial: true,
    label: 'Text',
    terms: ['text', 'markdown', 'note', 'commentary', 'heading', 'summary'],
    guidance: `Markdown text, such as a heading, a note or a summary with live figures. ${TEMPLATE_GUIDANCE}`,
    category: 'content',
    config: MARKDOWN_SCHEMA,
    size: {default: {w: 6, h: 3}, min: {w: 2, h: 1}},
    example: {
        component: 'markdown',
        config: {source: 'positions', text: '## {fund}\nP&L today: **{pnlDay}**'}
    }
};

const callout: WidgetSpec = {
    name: 'callout',
    version: 1,
    rendersPartial: true,
    label: 'Callout',
    terms: ['callout', 'alert', 'warning', 'note', 'highlight'],
    guidance: `A note set off by an icon and a tinted background, for a caveat, a warning or a key takeaway. intent sets its color. Its title and text are templates. ${TEMPLATE_GUIDANCE}`,
    category: 'content',
    config: CALLOUT_SCHEMA,
    size: {default: {w: 6, h: 2}, min: {w: 2, h: 1}},
    example: {
        component: 'callout',
        config: {intent: 'warning', title: 'Stale prices', text: 'Prices are as of {asOf}.'}
    }
};

const INPUT_SIZE = {default: {w: 3, h: 1}, min: {w: 2, h: 1}};

const inputSpec = (
    spec: Pick<WidgetSpec, 'name' | 'label' | 'terms' | 'guidance' | 'config' | 'value'>
): WidgetSpec => ({
    version: 1,
    category: 'input',
    size: INPUT_SIZE,
    ...spec,
    guidance: `${spec.guidance} It shows and sets the variable whose setBy names it.`,
    example: {component: spec.name, config: {label: spec.label}}
});

const select = inputSpec({
    name: 'select',
    label: 'Select',
    terms: ['select', 'dropdown', 'picker', 'choose'],
    guidance: "A dropdown of its variable's options list. A string[] variable picks several.",
    config: SELECT_SCHEMA,
    value: {type: ['string', 'string[]']}
});

const dateInput = inputSpec({
    name: 'dateInput',
    label: 'Date',
    terms: ['date', 'as of', 'calendar'],
    guidance: 'A date picker for a localDate variable.',
    config: DATE_INPUT_SCHEMA,
    value: {type: 'localDate'}
});

const dateRangePicker = inputSpec({
    name: 'dateRangePicker',
    label: 'Date range',
    terms: ['date range', 'period', 'MTD', 'YTD', 'from to', 'between dates'],
    guidance:
        'A picker for a dateRange variable: a preset such as mtd or ytd, a lookback, a month, quarter or year, or custom dates. Bind its variable to a source through the rangeStart and rangeEnd resolvers.',
    config: DATE_RANGE_PICKER_SCHEMA,
    value: {type: 'dateRange'}
});

const numberInput = inputSpec({
    name: 'numberInput',
    label: 'Number',
    terms: ['number', 'amount', 'threshold', 'limit'],
    guidance: 'A number field, within min and max.',
    config: NUMBER_INPUT_SCHEMA,
    value: {type: ['number', 'int']}
});

const textInput = inputSpec({
    name: 'textInput',
    label: 'Text',
    terms: ['text', 'search', 'name'],
    guidance: 'A one-line text field.',
    config: TEXT_INPUT_SCHEMA,
    value: {type: 'string'}
});

const switchInput = inputSpec({
    name: 'switchInput',
    label: 'Switch',
    terms: ['switch', 'toggle', 'on off', 'checkbox'],
    guidance: 'An on/off switch for a bool variable.',
    config: SWITCH_INPUT_SCHEMA,
    value: {type: 'bool'}
});

const slider = inputSpec({
    name: 'slider',
    label: 'Slider',
    terms: ['slider', 'range', 'scale'],
    guidance: 'A slider from min to max, by step. It sets its variable when the user lets go.',
    config: SLIDER_SCHEMA,
    value: {type: ['number', 'int']}
});

const filterChooser = inputSpec({
    name: 'filterChooser',
    label: 'Filter',
    terms: ['filter', 'search', 'narrow'],
    guidance:
        "A box that builds a filter from values of its source's dimensions, or of the fields it lists. Bind its filter variable as a widget's or a source's filter.",
    config: FILTER_CHOOSER_SCHEMA,
    value: {type: 'filter'}
});

const toolbar: WidgetSpec = {
    name: 'toolbar',
    version: 1,
    label: 'Toolbar',
    terms: ['toolbar', 'controls', 'bar', 'filters'],
    guidance:
        "A row of inputs, divided by separators and pushed apart by spacers. Put it in a panel's tbar or bbar slot to head or foot the panel, or place it on its own.",
    category: 'container',
    config: TOOLBAR_SCHEMA,
    children: {
        schema: CHILD_ID_SCHEMA,
        accepts: {categories: ['input'], widgets: ['separator', 'spacer']}
    },
    size: {default: {w: 12, h: 1}, min: {w: 2, h: 1}},
    example: {component: 'toolbar', children: [{id: 'regionSelect'}, {id: 'asOfInput'}]}
};

const cubeGrid: WidgetSpec = {
    name: 'cubeGrid',
    version: 1,
    label: 'Grid',
    terms: ['grid', 'table', 'pivot', 'list of positions', 'blotter'],
    guidance:
        "The one grid widget. Grouped into a tree with groupBy, or flat without it. Use it for positions, orders and any tabular data. Its selection is an output: a filter of the selected row's group path, or one field's value. A grid with groupBy is a tree: its dimensions become parent rows. treeStyle styles that tree, so a grid without groupBy shows no tree style. Keep the grid's default style unless the user asks for one, or it's a preview. Rename or align a column in columns, and rename a field across the whole blueprint on its source. Name it with its title, not a text element beside it.",
    category: 'data',
    config: CUBE_GRID_SCHEMA,
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
        'A Hoist chart. If x is a dimension, the chart aggregates its source by x. If x is a date or time field, it plots rows as they are, for a time series. Name it with its title, not a text element beside it.',
    category: 'data',
    config: CHART_SCHEMA,
    outputs: [
        {
            name: 'selection',
            type: 'filter',
            folds: true,
            description:
                'The point clicked, as a filter of its x value, and of its groupBy value if any. Only a chart whose x is a dimension has one. A second click clears it.'
        }
    ],
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

const propertyTable: WidgetSpec = {
    name: 'propertyTable',
    version: 1,
    label: 'Properties',
    terms: ['properties', 'details', 'key values', 'facts', 'summary table'],
    guidance:
        "A list of labeled values: the totals of the rows its filter leaves, or one row's own values where its filter leaves one, such as the details of a fund or a position. Each field may take a label, a format and a renderer.",
    category: 'data',
    config: PROPERTY_TABLE_SCHEMA,
    size: {default: {w: 4, h: 4}, min: {w: 2, h: 2}},
    example: {
        component: 'propertyTable',
        config: {
            source: 'positions',
            fields: ['mktVal', {field: 'pnlDay', label: 'Today'}],
            filter: {field: 'fund', op: '=', value: {$var: 'fund'}}
        }
    }
};

const heatmap: WidgetSpec = {
    name: 'heatmap',
    version: 1,
    label: 'Heatmap',
    terms: ['heatmap', 'heat map', 'matrix', 'grid of colors'],
    guidance:
        'A grid of cells, one per pair of x and y values, each colored by the total of value over its rows, such as P&L by sector and strategy. Its selection is an output: a filter of the cell clicked.',
    category: 'data',
    config: HEATMAP_SCHEMA,
    outputs: [
        {
            name: 'selection',
            type: 'filter',
            folds: true,
            description:
                'The cell clicked, as a filter of its x and y values. A second click clears it.'
        }
    ],
    size: {default: {w: 6, h: 6}, min: {w: 3, h: 3}},
    example: {
        component: 'heatmap',
        config: {source: 'positions', x: 'sector', y: 'strategy', value: 'pnlDay'}
    }
};

const treemap: WidgetSpec = {
    name: 'treemap',
    version: 1,
    label: 'Treemap',
    terms: ['treemap', 'heat map of positions', 'map', 'boxes by size'],
    guidance:
        'Nested boxes, one per group of groupBy, each sized by value and colored by heat. Use it to show where exposure or P&L sits, such as positions by sector and symbol. Its selection is an output: a filter of the node clicked.',
    category: 'data',
    config: TREEMAP_SCHEMA,
    presetPaths: ['/groupBy', '/colorMode'],
    outputs: [
        {
            name: 'selection',
            type: 'filter',
            folds: true,
            description:
                'The node clicked, as a filter of its group path. A second click clears it.'
        }
    ],
    size: {default: {w: 6, h: 6}, min: {w: 3, h: 3}},
    example: {
        component: 'treemap',
        config: {
            source: 'positions',
            groupBy: ['sector', 'symbol'],
            value: 'mktVal',
            heat: 'pnlDay'
        }
    }
};

const statCard: WidgetSpec = {
    name: 'statCard',
    version: 1,
    label: 'Stat card',
    terms: ['stat card', 'KPI', 'headline number', 'metric', 'tile', 'figure'],
    guidance:
        'One headline number: the total of a field over the source. With agg count and no field, it counts rows. Its value always comes from a source, never from config. It shows a change from its deltaField, rolled up as its field is, with an arrow in color: green up, red down, or the reverse with invert for a figure where up is bad. deltaFormat formats it (default its format), and deltaLabel says what it compares against, such as "vs last month". intent outlines it to flag it, such as danger for a breached limit. Lay cards out in a tileFrame, or in a row box.',
    category: 'data',
    config: STAT_CARD_SCHEMA,
    size: {default: {w: 3, h: 2}, min: {w: 2, h: 2}},
    example: {component: 'statCard', config: {source: 'positions', field: 'mktVal'}}
};

const tileFrame: WidgetSpec = {
    name: 'tileFrame',
    version: 1,
    label: 'Tiles',
    terms: ['tiles', 'stat cards', 'KPIs', 'headline numbers'],
    guidance:
        'Lays out its children as equal tiles that fill it, wrapping to more rows as needed. Use it for a set of stat cards, or for small charts or notes side by side. It holds content and data widgets only. Its title heads its cell on a dashboard.',
    category: 'container',
    config: TILE_FRAME_SCHEMA,
    children: {schema: CHILD_ID_SCHEMA, accepts: {categories: ['content', 'data']}},
    size: {default: {w: 12, h: 2}, min: {w: 3, h: 2}},
    example: {
        component: 'tileFrame',
        config: {maxTileHeight: 100},
        children: [{id: 'mktValCard'}, {id: 'pnlDayCard'}]
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
    config: GROUPING_CHOOSER_SCHEMA,
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
    config: BUTTON_GROUP_SCHEMA,
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
    config: BUTTON_GROUP_INPUT_SCHEMA,
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

const placeholder: WidgetSpec = {
    name: 'placeholder',
    version: 1,
    label: 'Placeholder',
    guidance: 'Stands in for an element of a chat answer that is still arriving.',
    category: 'data',
    reserved: true,
    config: {type: 'object', additionalProperties: false, properties: {component: {type: 'string'}}}
};

const fallback: WidgetSpec = {
    name: 'fallback',
    version: 1,
    label: 'Fallback',
    guidance: 'Stands in for an element of a chat answer that has errors, and lists them.',
    category: 'data',
    reserved: true,
    config: {
        type: 'object',
        additionalProperties: false,
        properties: {errors: {type: 'array', items: {type: 'string'}}, input: {type: 'string'}}
    }
};

const WIDGET_SPECS: WidgetSpec[] = [
    placeholder,
    fallback,
    dashCanvas,
    tabContainer,
    panel,
    box,
    separator,
    spacer,
    markdown,
    callout,
    toolbar,
    select,
    dateInput,
    dateRangePicker,
    numberInput,
    textInput,
    switchInput,
    slider,
    filterChooser,
    cubeGrid,
    chart,
    tileFrame,
    statCard,
    propertyTable,
    heatmap,
    treemap,
    groupingChooser,
    buttonGroup,
    buttonGroupInput
];

//------------------
// Widget demand
//------------------
// Names a grid's tree column in `columnState` and `sortBy`.
const TREE_COLUMN = 'group';

const SOURCE_DEMANDS: Record<string, (config: PlainObject) => WidgetDemand> = {
    cubeGrid: cfg => ({
        fields: fieldNames([
            ...castArray(cfg.columnState ?? []).map(it => (isString(it) ? it : it?.field)),
            ...Object.keys(cfg.columns ?? {}),
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
    statCard: cfg => ({
        fields: fieldNames([cfg.field, cfg.deltaField, cfg.trend]),
        groupBy: []
    }),
    propertyTable: cfg => ({
        fields: fieldNames([
            ...castArray(cfg.fields ?? []).map(it => (isString(it) ? it : it?.field)),
            ...filterFields(cfg.filter)
        ]),
        groupBy: []
    }),
    heatmap: cfg => ({
        fields: fieldNames([cfg.x, cfg.y, cfg.value, ...filterFields(cfg.filter)]),
        groupBy: compact([cfg.x, cfg.y])
    }),
    treemap: cfg => ({
        fields: fieldNames([
            ...castArray(cfg.groupBy ?? []),
            cfg.value,
            cfg.heat,
            ...filterFields(cfg.filter)
        ]),
        groupBy: castArray(cfg.groupBy ?? [])
    })
};

// A widget over one source demands only from its `source`.
const DEMANDS: Record<string, (config: PlainObject) => Record<string, WidgetDemand>> = {
    ...mapValues(
        SOURCE_DEMANDS,
        demand =>
            (cfg: PlainObject): Record<string, WidgetDemand> =>
                cfg.source ? {[cfg.source]: demand(cfg)} : {}
    ),
    markdown: cfg => templateDemand(cfg.text, cfg.source),
    callout: cfg =>
        mergeDemands(templateDemand(cfg.title, cfg.source), templateDemand(cfg.text, cfg.source))
};

function mergeDemands(
    a: Record<string, WidgetDemand>,
    b: Record<string, WidgetDemand>
): Record<string, WidgetDemand> {
    return mergeWith({...a}, b, (x: WidgetDemand, y: WidgetDemand) =>
        x && y ? {fields: uniq([...x.fields, ...y.fields]), groupBy: []} : undefined
    );
}

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
// Highcharts sanitizes text, but still allows links and styles in labels and format templates, so
// no string may hold markup. renderTo would draw into another element of the page.
const HIGHCHARTS_REFUSED = ['renderTo', 'useHTML', 'events', 'series', 'data'],
    HIGHCHARTS_MAX_LENGTH = 20000,
    HIGHCHARTS_MAX_DEPTH = 10;

function checkHighchartsConfig(config: PlainObject): BlueprintIssue[] {
    const ret: BlueprintIssue[] = [],
        fail = (path: string, message: string) =>
            ret.push({
                code: 'chart.highchartsConfig',
                severity: 'error',
                path: `/highchartsConfig${path}`,
                message
            });
    if (
        JSON.stringify(config).length > HIGHCHARTS_MAX_LENGTH ||
        depthOf(config) > HIGHCHARTS_MAX_DEPTH
    ) {
        fail(
            '',
            `is past its cap of ${HIGHCHARTS_MAX_LENGTH} characters and ${HIGHCHARTS_MAX_DEPTH} levels`
        );
        return ret;
    }
    const walk = (value: unknown, path: string, top: string) => {
        if (isString(value) && value.includes('<')) {
            fail(path, 'holds markup, which a chart may not show');
        } else if (Array.isArray(value)) {
            value.forEach((it, idx) => walk(it, `${path}/${idx}`, top));
        } else if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, it]) => {
                const at = `${path}/${key}`;
                // plotOptions.series holds options for every series, not series of its own.
                if (HIGHCHARTS_REFUSED.includes(key) && at !== '/plotOptions/series') {
                    fail(at, `'${key}' may not be set`);
                } else if (key === 'categories' && (top === 'xAxis' || top === 'yAxis')) {
                    fail(at, "an axis's categories come from the chart's data");
                } else if (key === 'keys' && top === 'plotOptions') {
                    fail(at, "keys would remap the chart's data");
                } else {
                    walk(it, at, top);
                }
            });
        }
    };
    Object.entries(config).forEach(([key, value]) => {
        if (HIGHCHARTS_KEYS.includes(key)) {
            walk(value, `/${key}`, key);
        } else {
            fail(
                `/${key}`,
                `'${key}' is not an option a blueprint may set: use ${HIGHCHARTS_KEYS.join(', ')}`
            );
        }
    });
    return ret;
}

function depthOf(value: unknown): number {
    if (!value || typeof value !== 'object') return 0;
    return 1 + Math.max(0, ...Object.values(value).map(depthOf));
}

const VALIDATORS: Record<string, WidgetSpec['validate']> = {
    chart: cfg => (cfg.highchartsConfig ? checkHighchartsConfig(cfg.highchartsConfig) : []),
    // groupBy may come from a preset group, which takes it out of the config.
    treemap: (cfg, {blueprint, id}) => {
        const path = `/elements/${id}/config/groupBy`,
            isPreset = Object.values(blueprint.presets ?? {}).some(it =>
                it.controls?.some(c => c.path === path)
            );
        if (!isEmpty(cfg.groupBy) || isPreset) return [];
        return [
            {
                code: 'treemap.noGroupBy',
                severity: 'error',
                path: '/groupBy',
                message: 'a treemap needs groupBy, in its config or from a preset group'
            }
        ];
    },
    separator: (cfg, {blueprint, id}) => {
        const elements = blueprint.elements ?? {};
        if (!cfg.label || elements[parentOf(elements, id)]?.component !== 'toolbar') return [];
        return [
            {
                code: 'separator.labelIgnored',
                severity: 'warning',
                path: '/label',
                message: 'a toolbar shows no separator label'
            }
        ];
    },
    statCard: cfg =>
        cfg.field || cfg.agg === 'count'
            ? []
            : [
                  {
                      code: 'statCard.noField',
                      severity: 'error',
                      path: '',
                      message: 'a stat card needs a field, unless its agg is count'
                  }
              ],
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
            type: 'object',
            required: ['variable'],
            properties: {
                variable: {
                    type: 'string',
                    'x-variable': true,
                    description:
                        'A variable whose setBy is prompt, an element without an output, or action.'
                },
                value: {description: 'A literal or {"$var": name}, matching the variable\'s type.'}
            }
        },
        describe: ({variable, value}) => `Set ${variable} to ${describeValue(value)}`
    },
    {
        name: 'resetVariable',
        params: {
            type: 'object',
            required: ['variable'],
            properties: {
                variable: {
                    type: 'string',
                    'x-variable': true,
                    description: 'As for setVariable. Restores its default.'
                }
            }
        },
        describe: ({variable}) => `Reset ${variable}`
    },
    {
        name: 'refresh',
        params: {
            type: 'object',
            properties: {
                sources: {
                    type: 'array',
                    items: {type: 'string'},
                    description: 'Sources to load again. Default all.'
                }
            }
        },
        describe: ({sources}) =>
            isEmpty(sources) ? 'Refresh all data' : `Refresh ${castArray(sources).join(', ')}`
    },
    {
        name: 'navigate',
        params: {
            type: 'object',
            required: ['route'],
            properties: {route: {type: 'string'}, params: {type: 'object'}}
        },
        describe: ({route}) => `Go to ${route}`
    },
    {
        name: 'openUrl',
        params: {
            type: 'object',
            required: ['url'],
            properties: {
                url: {type: 'string', description: "Only URLs on the app's allow list open."}
            }
        },
        describe: ({url}) => `Open ${url}`
    }
];

/** A value as text for an action's description: a filter as its clauses, a list joined. */
export function describeValue(value: unknown): string {
    if (value == null) return 'nothing';
    if (Array.isArray(value)) return value.map(describeValue).join(', ');
    if (typeof value === 'object') {
        const f = value as PlainObject;
        if (Array.isArray(f.filters)) {
            return f.filters
                .map(describeValue)
                .join(String(f.op ?? 'AND').toUpperCase() === 'OR' ? ' or ' : ' and ');
        }
        if (isString(f.field)) return `${f.field} ${f.op} ${describeValue(f.value)}`;
        return JSON.stringify(value);
    }
    return String(value);
}

//------------------
// Resolvers and renderers, without the code that runs them
//------------------
export const BUILT_IN_RESOLVER_INFO: Omit<ResolverSpec, 'resolve'>[] = [
    {
        name: 'today',
        returns: 'localDate',
        args: {}
    },
    {
        name: 'previousBusinessDay',
        returns: 'localDate',
        args: {
            from: 'localDate, optional. Default today.'
        }
    },
    {
        name: 'dateOffset',
        returns: 'localDate',
        args: {
            from: 'localDate',
            days: 'int, optional',
            months: 'int, optional',
            years: 'int, optional'
        }
    },
    {
        name: 'monthStart',
        returns: 'localDate',
        args: {
            from: 'localDate'
        }
    },
    {
        name: 'quarterStart',
        returns: 'localDate',
        args: {
            from: 'localDate',
            offset: 'int, optional. -1 for the quarter before.'
        }
    },
    {
        name: 'yearStart',
        returns: 'localDate',
        args: {
            from: 'localDate'
        }
    },
    {
        name: 'rangeStart',
        returns: 'localDate',
        args: {range: 'dateRange', asOf: 'localDate, optional. Default today.'},
        guidance: "The first day of a date range as of a date, such as a source's start param."
    },
    {
        name: 'rangeEnd',
        returns: 'localDate',
        args: {range: 'dateRange', asOf: 'localDate, optional. Default today.'},
        guidance: 'The last day of a date range as of a date.'
    },
    {
        name: 'periodStart',
        returns: 'localDate',
        args: {
            asOf: 'localDate',
            period: 'period, such as 3M',
            calendar: "'business' (default) or 'calendar'"
        },
        guidance:
            'The date one period before asOf, on a business day at or before it: where a return over the period starts.'
    },
    {
        name: 'periodEnd',
        returns: 'localDate',
        args: {
            asOf: 'localDate',
            period: 'period, such as +3M',
            calendar: "'business' (default) or 'calendar'"
        },
        guidance: 'The date one period after asOf, on a business day at or after it.'
    }
];

export const BUILT_IN_RENDERER_INFO: Omit<RendererSpec, 'render' | 'exportValue'>[] = [
    {
        name: 'bar',
        appliesTo: {
            types: ['number', 'int']
        },
        config: {
            max: 'number, the value that fills the bar. Default the largest in its column'
        }
    },
    {
        name: 'badge',
        appliesTo: {
            types: ['string']
        },
        config: {
            intents: 'object mapping a value to none, primary, success, warning or danger'
        }
    },
    {
        name: 'delta',
        appliesTo: {
            types: ['number', 'int']
        },
        config: {}
    },
    {
        name: 'sparkline',
        appliesTo: {types: ['number[]']},
        config: {
            type: "'line' (default), 'area' or 'bar'",
            colorBy: "'intent' (default), 'trend' for up or down overall, or 'sign' for each point"
        },
        guidance:
            "Draws a series as a small line, on its column's scale. A series field draws as one by default."
    }
];
