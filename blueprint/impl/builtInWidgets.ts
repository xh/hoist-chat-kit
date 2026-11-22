import type {PlainObject} from '@xh/hoist/core';
import type {FromExtendedSchema} from 'json-schema-to-ts';
import {castArray, compact, isEmpty, isString, mapValues, mergeWith, uniq} from 'lodash';
import type {BlueprintIssue} from '../Blueprint';
import type {BlueprintSchema, BlueprintSchemaExtension} from '../BlueprintSchema';
import type {
    ActionSpec,
    RendererSpec,
    ResolverSpec,
    SlotAccepts,
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

/** A title, which may read variables: "P&L for {fund}". */
const TITLE = {
    type: 'string',
    maxLength: 100,
    'x-binding': true,
    'x-template': 'variables'
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

// A GoldenLayout item, to a fixed depth as schemas here take no $ref. Only the keys a blueprint
// keeps: GoldenLayout sets a title as HTML.
function dashLayoutItem(depth: number): BlueprintSchema {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
            type: {type: 'string', enum: ['row', 'column', 'stack', 'view']},
            id: {type: 'string'},
            width: {type: 'number', minimum: 0, maximum: 100},
            height: {type: 'number', minimum: 0, maximum: 100},
            ...(depth > 1
                ? {content: {type: 'array', maxItems: 20, items: dashLayoutItem(depth - 1)}}
                : {})
        }
    };
}

const DASH_CONTAINER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        layout: {
            type: 'array',
            maxItems: 20,
            items: dashLayoutItem(6),
            description:
                "GoldenLayout's rows, columns, stacks and views: [{type: 'row', content: [{type: 'view', id: 'grid'}, ...]}]. Each view names a child. Default one stack, a tab per child."
        },
        emptyText: EMPTY_TEXT
    }
} as const satisfies BlueprintSchema;

const PANEL_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: TITLE,
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
        text: {
            type: 'string',
            maxLength: 10000,
            'x-template': true,
            examples: ['Write this text in the inspector.']
        }
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
        min: {type: 'number', default: 0},
        max: {type: 'number', default: 100},
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
            description:
                'True to put the children that do not fit in a menu at its end. A lone child never goes in one.'
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

/** A grid style: a closed set of keys, each value from a list or a strict pattern. */
const GRID_STYLE = {
    type: 'object',
    additionalProperties: false,
    properties: {
        color: {
            type: 'string',
            description: 'An intent (primary, success, warning, danger), muted, or #rrggbb.'
        },
        background: {type: 'string', description: 'An intent, or #rrggbb.'},
        fontWeight: {enum: ['bold', 'normal']},
        fontStyle: {enum: ['italic', 'normal']},
        textDecoration: {enum: ['underline', 'line-through', 'none']},
        align: {enum: ['left', 'center', 'right']},
        border: {
            enum: ['primary', 'success', 'warning', 'danger'],
            description: "A bar of the intent's color down the left edge."
        }
    }
} as const satisfies BlueprintSchema;

const STYLE_WHEN = {
    type: 'object',
    'x-filter': true,
    'x-binding': true,
    description:
        "The rows the style applies to, as a filter tested on each row: a leaf's own values, or a group row's totals."
} as const satisfies BlueprintSchema;

const CELL_STYLE_RULES = {
    type: 'array',
    items: {
        type: 'object',
        additionalProperties: false,
        required: ['when', 'style'],
        properties: {when: STYLE_WHEN, style: GRID_STYLE}
    },
    description:
        "Styles for the column's cells where a row matches, applied in order. A later match wins property by property. At most 10."
} as const satisfies BlueprintSchema;

const ROW_STYLE_RULES = {
    type: 'array',
    items: {
        type: 'object',
        additionalProperties: false,
        required: ['when', 'style'],
        properties: {
            when: STYLE_WHEN,
            style: GRID_STYLE,
            rows: {enum: ['all', 'leaves', 'groups'], default: 'all'}
        }
    },
    description:
        'Styles for whole rows where a row matches, applied in order. rows picks leaf rows, group rows or both. At most 10.'
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
        title: TITLE,
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
        rowStyles: ROW_STYLE_RULES,
        rowActions: {
            type: 'array',
            maxItems: 10,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['label', 'action'],
                properties: {
                    label: {type: 'string', maxLength: 40},
                    icon: {type: 'string', maxLength: 40},
                    action: ACTION_PROP
                }
            },
            description:
                'Actions on a row, in its right-click menu, the first also on a double click. An action reads the row\'s fields, and its group path\'s, with {"$row": field}.'
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
                    styles: CELL_STYLE_RULES,
                    headerName: {
                        type: 'string',
                        maxLength: 100,
                        'x-template': 'variables',
                        description:
                            'The header text, which may read variables. Default the field label.'
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
            'x-binding': true,
            type: 'integer',
            minimum: 0,
            maximum: 6
        },
        summaryRow: {
            'x-binding': true,
            type: 'boolean',
            default: false
        },
        treeStyle: {
            'x-binding': true,
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
            'x-binding': true,
            type: 'boolean',
            default: true,
            description: 'Alternate the background of rows.'
        },
        rowBorders: {
            'x-binding': true,
            type: 'boolean',
            default: true,
            description: 'Draw a border between rows.'
        },
        cellBorders: {
            'x-binding': true,
            type: 'boolean',
            default: false,
            description: 'Draw a border between cells.'
        },
        showHover: {
            'x-binding': true,
            type: 'boolean',
            default: false,
            description: 'Highlight the row under the pointer.'
        },
        sizingMode: {
            'x-binding': true,
            enum: ['tiny', 'compact', 'standard', 'large'],
            description: "The size of the grid's text and rows. Default the app's sizing mode."
        },
        showGroupRowCounts: {
            'x-binding': true,
            type: 'boolean',
            default: true,
            description: 'Show the count of rows in each group row.'
        },
        hideHeaders: {
            'x-binding': true,
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
        title: TITLE,
        type: {
            'x-binding': true,
            enum: [
                'line',
                'spline',
                'column',
                'bar',
                'area',
                'areaspline',
                'pie',
                'scatter',
                'waterfall'
            ],
            description:
                'waterfall shows each y as a step from the one before, as for P&L attribution.'
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
        y2: {
            type: 'array',
            items: {type: 'string'},
            maxItems: 4,
            'x-field': 'measure',
            'x-starter': false,
            description:
                'Measures on a second axis, on the right, where their scale differs from y.'
        },
        y2Title: {
            type: 'string',
            maxLength: 100,
            'x-binding': true,
            description: "Title of the second axis. Default the y2 field's label, if there is one."
        },
        groupBy: {
            type: 'string',
            'x-field': 'dimension',
            'x-starter': false,
            description: 'A dimension that splits the first y into one series per value.'
        },
        stacking: {
            'x-binding': true,
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
        title: TITLE,
        fields: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            'x-field': 'any',
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
        title: TITLE,
        x: {type: 'string', 'x-field': 'dimension', description: 'The dimension across.'},
        y: {type: 'string', 'x-field': 'dimension', description: 'The dimension down.'},
        value: {type: 'string', 'x-field': 'measure', description: 'Colors each cell.'},
        colorMode: {
            enum: ['diverging', 'sequential'],
            default: 'diverging',
            description:
                'diverging colors below zero red and above green, as for P&L. Use sequential only for a measure that is never negative.'
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
        title: TITLE,
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
            'x-starter': false,
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
        label: {type: 'string', maxLength: 40, 'x-template': 'variables'},
        format: FORMAT_PROP,
        agg: {enum: ['count', 'SUM', 'AVG', 'MIN', 'MAX', 'UNIQUE']},
        deltaField: {type: 'string', 'x-field': 'measure', 'x-starter': false},
        deltaFormat: FORMAT_PROP,
        deltaLabel: {type: 'string', maxLength: 40},
        invert: {type: 'boolean'},
        intent: {enum: ['none', 'primary', 'success', 'warning', 'danger']},
        trend: {
            type: 'string',
            'x-field': 'any',
            'x-starter': false,
            description:
                "A series field to draw as a sparkline under the figure: the source's one row, or the sum of its rows where the series sums."
        }
    }
} as const satisfies BlueprintSchema;

const GAUGE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'value'],
    properties: {
        source: {type: 'string', 'x-source': true},
        title: TITLE,
        value: {type: 'string', 'x-field': 'measure', description: 'The total the needle shows.'},
        min: {type: 'number', default: 0, description: 'The start of the arc.'},
        max: {type: 'number', default: 100, description: 'The end of the arc.'},
        stops: {
            type: 'array',
            maxItems: 6,
            'x-starter': false,
            description:
                'Colors the arc by how far along it the value sits, such as green to 0.7 and red from 0.9. Default one color.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['at', 'color'],
                properties: {
                    at: {
                        type: 'number',
                        minimum: 0,
                        maximum: 1,
                        description: 'From 0, at min, to 1, at max.'
                    },
                    color: {
                        type: 'string',
                        pattern: '^#[0-9a-fA-F]{6}$',
                        description: 'A hex color, such as #55bf3b.'
                    }
                }
            }
        },
        format: FORMAT_PROP,
        filter: {'x-filter': true, 'x-binding': true, type: 'object'}
    }
} as const satisfies BlueprintSchema;

const TILE_FRAME_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: TITLE,
        minTileWidth: {
            type: 'integer',
            minimum: 20,
            maximum: 2000,
            'x-unit': 'px',
            description: 'The narrowest a tile gets. More tiles wrap to a new row.'
        },
        maxTileWidth: {
            type: 'integer',
            minimum: 20,
            maximum: 2000,
            'x-unit': 'px',
            description: 'The widest a tile gets, however few there are.'
        },
        minTileHeight: {
            type: 'integer',
            minimum: 20,
            maximum: 2000,
            'x-unit': 'px',
            description: 'The shortest a tile gets.'
        },
        maxTileHeight: {
            type: 'integer',
            minimum: 20,
            maximum: 2000,
            'x-unit': 'px',
            description: 'The tallest a tile gets.'
        },
        desiredRatio: {
            type: 'number',
            minimum: 0.1,
            maximum: 10,
            default: 1,
            description: 'Tile width over height.'
        },
        spacing: {type: 'integer', minimum: 0, maximum: 64, default: 0, 'x-unit': 'px'},
        emptyText: EMPTY_TEXT
    }
} as const satisfies BlueprintSchema;

const PRESET_SELECTOR_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['group'],
    properties: {
        group: {type: 'string', 'x-preset': true, description: 'The preset group it switches.'},
        display: {
            enum: ['segmented', 'buttonGroup', 'select', 'toggle'],
            default: 'segmented',
            description: 'How it draws. A toggle switches between exactly two presets.'
        },
        label: LABEL
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
                        maxLength: 40,
                        // A new button refreshes, so its label says so.
                        examples: ['Refresh']
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

export type DashContainerWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof DASH_CONTAINER_SCHEMA
>;

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

export type GaugeWidgetConfig = FromExtendedSchema<BlueprintSchemaExtension, typeof GAUGE_SCHEMA>;

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
export type PresetSelectorWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof PRESET_SELECTOR_SCHEMA
>;

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

// A panel's toolbar slot takes a toolbar, or inputs, buttons, separators and spacers it draws in one.
const TOOLBAR_SLOT_ACCEPTS: SlotAccepts = {
    categories: ['input', 'action'],
    widgets: ['toolbar', 'separator', 'spacer']
};

const dashCanvas: WidgetSpec = {
    name: 'dashCanvas',
    icon: 'layout',
    sections: [
        {label: 'Content', keys: ['emptyText']},
        {label: 'Display', keys: ['columns', 'rowHeight']}
    ],
    summary: "A 12-column grid of widgets placed by x, y, w and h. A dashboard's usual root.",
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
        },
        slots: {
            headerItems: {
                description:
                    "Inputs in the cell's header, beside the widget's title, such as a preset selector.",
                terms: ['header', 'title bar', 'cell header'],
                accepts: {categories: ['input']}
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
    icon: 'folder',
    sections: [{label: 'Content', keys: ['emptyText']}],
    summary: 'Shows one child at a time, under a row of tabs.',
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
                    maxLength: 60,
                    'x-template': 'variables'
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

const dashContainer: WidgetSpec = {
    name: 'dashContainer',
    icon: 'window',
    sections: [
        {label: 'Content', keys: ['emptyText']},
        {label: 'Display', keys: ['layout']}
    ],
    summary: 'Views a user drags into tabs, stacks, rows and columns, and resizes.',
    version: 1,
    label: 'Dash container',
    terms: ['dock', 'golden layout', 'stacks', 'rearrange', 'tabs and splits'],
    guidance:
        "Views a user can drag into tabs, stacks, rows and columns, and resize. Each child reference may give the title of its tab. Its layout is GoldenLayout's own: rows and columns of stacks of views, each view naming a child. Use tabContainer for plain tabs, and this only where users rearrange.",
    category: 'container',
    config: DASH_CONTAINER_SCHEMA,
    presetPaths: ['/layout'],
    children: {
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['id'],
            properties: {
                id: {type: 'string'},
                title: {type: 'string', maxLength: 60, 'x-template': 'variables'}
            }
        }
    },
    size: {default: {w: 12, h: 8}, min: {w: 3, h: 3}},
    example: {
        component: 'dashContainer',
        config: {
            layout: [
                {
                    type: 'row',
                    content: [
                        {type: 'view', id: 'posGrid'},
                        {type: 'view', id: 'chart'}
                    ]
                }
            ]
        },
        children: [{id: 'posGrid'}, {id: 'chart'}]
    }
};

const panel: WidgetSpec = {
    name: 'panel',
    icon: 'square',
    sections: [
        {label: 'Content', keys: ['title', 'icon', 'emptyText']},
        {label: 'Display', keys: ['compactHeader', 'collapsible', 'collapsed']},
        {label: 'Style', keys: ['style', 'intent'], collapsed: true}
    ],
    summary: 'A titled section or bordered card that stacks its children, with optional toolbars.',
    version: 1,
    rendersPartial: true,
    label: 'Panel',
    terms: ['panel', 'section', 'group', 'card'],
    guidance:
        'A titled section that stacks its children top to bottom. style card draws a bordered group in place of a header. Use it to title a group of widgets, or to let a user collapse one. Each child takes an equal share of its height. Put a row box inside it to place children side by side. Its tbar and bbar slots draw toolbars above and below the content, and headerItems puts inputs in its header.',
    category: 'container',
    config: PANEL_SCHEMA,
    presetPaths: ['/collapsed'],
    children: {schema: CHILD_ID_SCHEMA},
    slots: {
        tbar: {
            description: 'A toolbar along the top of the panel, above its content.',
            terms: ['top toolbar', 'toolbar above'],
            accepts: TOOLBAR_SLOT_ACCEPTS
        },
        bbar: {
            description: 'A toolbar along the bottom of the panel, under its content.',
            terms: ['bottom toolbar', 'footer', 'toolbar below'],
            accepts: TOOLBAR_SLOT_ACCEPTS
        },
        headerItems: {
            description:
                "Inputs in the panel's header, beside its title, such as a preset selector.",
            terms: ['header', 'title bar'],
            accepts: {categories: ['input']}
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
    icon: 'cube',
    sections: [
        {label: 'Display', keys: ['direction', 'align']},
        {label: 'Style', keys: ['fill', 'gap'], collapsed: true}
    ],
    summary: 'A row or column of children, with no chrome.',
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
                flex: {
                    type: 'number',
                    minimum: 0,
                    maximum: 12,
                    description: 'A share of the room left. A child with no size takes 1.'
                },
                width: {type: 'integer', minimum: 1, maximum: 4000, 'x-unit': 'px'},
                height: {type: 'integer', minimum: 1, maximum: 4000, 'x-unit': 'px'}
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
    icon: 'bars',
    sections: [{label: 'Content', keys: ['label']}],
    summary: 'A rule between siblings, with an optional label.',
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
    icon: 'arrowsLeftRight',
    sections: [{label: 'Display', keys: ['size']}],
    summary: 'Empty room that pushes its siblings apart.',
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
    "Its text reads {variable} for a variable, and {source.field} for the total of a field over a source, by the field's aggregator and format. With a source set, {field} reads a field of it. A dimension reads its value where every row shares one, else blank. Write {{ and }} for braces. Values cannot carry markdown of their own.";

const markdown: WidgetSpec = {
    name: 'markdown',
    icon: 'fileText',
    sections: [
        {label: 'Data', keys: ['source']},
        {label: 'Content', keys: ['text']}
    ],
    summary: 'Markdown text, with live {variable} and {source.field} values.',
    version: 1,
    rendersPartial: true,
    label: 'Text',
    terms: ['text', 'markdown', 'note', 'commentary', 'heading', 'summary'],
    guidance: `Markdown text, such as a heading, a note or a summary with live figures. ${TEMPLATE_GUIDANCE}`,
    category: 'content',
    config: MARKDOWN_SCHEMA,
    size: {default: {w: 6, h: 1}, min: {w: 2, h: 1}},
    example: {
        component: 'markdown',
        config: {source: 'positions', text: '## {fund}\nP&L today: **{pnlDay}**'}
    }
};

const callout: WidgetSpec = {
    name: 'callout',
    icon: 'infoCircle',
    sections: [
        {label: 'Data', keys: ['source']},
        {label: 'Content', keys: ['title', 'text']},
        {label: 'Style', keys: ['intent'], collapsed: true}
    ],
    summary: 'A tinted note with an icon, for a caveat, a warning or a takeaway.',
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
    spec: Pick<
        WidgetSpec,
        | 'name'
        | 'label'
        | 'terms'
        | 'guidance'
        | 'summary'
        | 'config'
        | 'value'
        | 'icon'
        | 'sections'
    >
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
    icon: 'list',
    sections: [{label: 'Content', keys: ['label', 'placeholder']}],
    summary: "A dropdown that picks one or several of a variable's options.",
    label: 'Select',
    terms: ['select', 'dropdown', 'picker', 'choose'],
    guidance: "A dropdown of its variable's options list. A string[] variable picks several.",
    config: SELECT_SCHEMA,
    value: {type: ['string', 'string[]']}
});

const dateInput = inputSpec({
    name: 'dateInput',
    icon: 'calendar',
    sections: [{label: 'Content', keys: ['label']}],
    summary: 'A date picker for a localDate variable.',
    label: 'Date',
    terms: ['date', 'as of', 'calendar'],
    guidance: 'A date picker for a localDate variable.',
    config: DATE_INPUT_SCHEMA,
    value: {type: 'localDate'}
});

const dateRangePicker = inputSpec({
    name: 'dateRangePicker',
    icon: 'calendarDays',
    sections: [
        {label: 'Content', keys: ['label']},
        {label: 'Interaction', keys: ['presets', 'asOf']}
    ],
    summary: 'Picks a dateRange: a preset such as mtd, a lookback, or custom dates.',
    label: 'Date range',
    terms: ['date range', 'period', 'MTD', 'YTD', 'from to', 'between dates'],
    guidance:
        'A picker for a dateRange variable: a preset such as mtd or ytd, a lookback, a month, quarter or year, or custom dates. Bind its variable to a source through the rangeStart and rangeEnd resolvers.',
    config: DATE_RANGE_PICKER_SCHEMA,
    value: {type: 'dateRange'}
});

const numberInput = inputSpec({
    name: 'numberInput',
    icon: 'edit',
    sections: [
        {label: 'Content', keys: ['label']},
        {label: 'Interaction', keys: ['min', 'max', 'precision']}
    ],
    summary: 'A number field for a number variable.',
    label: 'Number',
    terms: ['number', 'amount', 'threshold', 'limit'],
    guidance: 'A number field, within min and max.',
    config: NUMBER_INPUT_SCHEMA,
    value: {type: ['number', 'int']}
});

const textInput = inputSpec({
    name: 'textInput',
    icon: 'edit',
    sections: [{label: 'Content', keys: ['label', 'placeholder']}],
    summary: 'A one-line text field for a string variable.',
    label: 'Text',
    terms: ['text', 'search', 'name'],
    guidance: 'A one-line text field.',
    config: TEXT_INPUT_SCHEMA,
    value: {type: 'string'}
});

const switchInput = inputSpec({
    name: 'switchInput',
    icon: 'edit',
    sections: [{label: 'Content', keys: ['label']}],
    summary: 'An on/off switch for a bool variable.',
    label: 'Switch',
    terms: ['switch', 'toggle', 'on off', 'checkbox'],
    guidance: 'An on/off switch for a bool variable.',
    config: SWITCH_INPUT_SCHEMA,
    value: {type: 'bool'}
});

const slider = inputSpec({
    name: 'slider',
    icon: 'arrowsLeftRight',
    sections: [
        {label: 'Content', keys: ['label']},
        {label: 'Interaction', keys: ['min', 'max', 'step']}
    ],
    summary: 'A slider that sets a number variable when released.',
    label: 'Slider',
    terms: ['slider', 'range', 'scale'],
    guidance: 'A slider from min to max, by step. It sets its variable when the user lets go.',
    config: SLIDER_SCHEMA,
    value: {type: ['number', 'int']}
});

const filterChooser = inputSpec({
    name: 'filterChooser',
    icon: 'filter',
    sections: [
        {label: 'Data', keys: ['source', 'fields']},
        {label: 'Content', keys: ['label']}
    ],
    summary: "Builds a filter from the values of its source's dimensions.",
    label: 'Filter',
    terms: ['filter', 'search', 'narrow'],
    guidance:
        "A box that builds a filter from values of its source's dimensions, or of the fields it lists. Bind its filter variable as a widget's or a source's filter.",
    config: FILTER_CHOOSER_SCHEMA,
    value: {type: 'filter'}
});

const toolbar: WidgetSpec = {
    name: 'toolbar',
    icon: 'bars',
    sections: [{label: 'Display', keys: ['vertical', 'overflowMenu']}],
    summary: "A row of inputs, on its own or in a panel's tbar or bbar.",
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
    icon: 'grid',
    summary: 'The grid: flat, or a tree grouped by groupBy. Its selection is an output.',
    version: 1,
    label: 'Grid',
    terms: ['grid', 'table', 'pivot', 'list of positions', 'blotter'],
    guidance:
        "The one grid widget. Grouped into a tree with groupBy, or flat without it. Use it for positions, orders and any tabular data. Its selection is an output: a filter of the selected row's group path, or one field's value. A grid with groupBy is a tree: its dimensions become parent rows. treeStyle styles that tree, so a grid without groupBy shows no tree style. Keep the grid's default style unless the user asks for one, or it's a preview. Rename or align a column in columns, and rename a field across the whole blueprint on its source. Name it with its title, not a text element beside it. Style cells by their values with a column's styles in columns, and whole rows with rowStyles: each rule a filter in when, and a style. Use them for a threshold the user names, and bind the threshold to a variable when the user might change it. Prefer intents to hex colors. Pair a color with bold, or a row background with a border, so color is never the only signal. Don't restyle what a renderer already shows, such as a delta's arrow.",
    category: 'data',
    config: CUBE_GRID_SCHEMA,
    sections: [
        {
            label: 'Data',
            keys: [
                'source',
                'groupBy',
                'sortBy',
                'filter',
                'expandLevel',
                'summaryRow',
                'showGroupRowCounts'
            ]
        },
        {label: 'Display', keys: ['title']},
        {label: 'Columns', keys: ['columnState', 'columns']},
        {label: 'Interaction', keys: ['rowActions']},
        {
            label: 'Style',
            keys: [
                'rowStyles',
                'treeStyle',
                'stripeRows',
                'rowBorders',
                'cellBorders',
                'showHover',
                'sizingMode',
                'hideHeaders',
                'groupRowHeight',
                'emptyText'
            ],
            collapsed: true
        }
    ],
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
    icon: 'chartBar',
    sections: [
        {label: 'Data', keys: ['source', 'x', 'y', 'y2', 'groupBy', 'filter', 'sortBy', 'top']},
        {label: 'Display', keys: ['title', 'type', 'stacking', 'xTitle', 'yTitle', 'y2Title']},
        {label: 'Style', keys: ['highchartsConfig'], collapsed: true}
    ],
    summary: 'A Hoist chart, grouped by a dimension x, or a time series.',
    version: 1,
    label: 'Chart',
    terms: ['chart', 'graph', 'plot', 'trend', 'bar chart', 'line chart'],
    guidance:
        'A Hoist chart. If x is a dimension, the chart aggregates its source by x. If x is a date or time field, it plots rows as they are, for a time series. Name it with its title, not a text element beside it.',
    category: 'data',
    // A waterfall comes with highcharts-more.
    modules: cfg => (cfg.type === 'waterfall' ? ['highcharts-more'] : []),
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
    icon: 'table',
    sections: [
        {label: 'Data', keys: ['source', 'fields', 'filter']},
        {label: 'Display', keys: ['title', 'columns', 'labelSide']}
    ],
    summary: "Labeled values: the totals of some rows, or one row's own values.",
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
    icon: 'grid',
    sections: [
        {label: 'Data', keys: ['source', 'x', 'y', 'value', 'filter']},
        {label: 'Display', keys: ['title']},
        {label: 'Style', keys: ['colorMode'], collapsed: true}
    ],
    summary: 'Cells colored by a value over two dimensions. Its selection is an output.',
    version: 1,
    label: 'Heatmap',
    terms: ['heatmap', 'heat map', 'matrix', 'grid of colors'],
    guidance:
        'A grid of cells, one per pair of x and y values, each colored by the total of value over its rows, such as P&L by sector and strategy. Its selection is an output: a filter of the cell clicked.',
    category: 'data',
    config: HEATMAP_SCHEMA,
    modules: ['heatmap'],
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
    icon: 'chartPie',
    sections: [
        {label: 'Data', keys: ['source', 'groupBy', 'value', 'heat', 'maxDepth', 'filter']},
        {label: 'Display', keys: ['title']},
        {label: 'Style', keys: ['colorMode'], collapsed: true}
    ],
    summary: 'Nested boxes sized by a value and colored by heat. Its selection is an output.',
    version: 1,
    label: 'Treemap',
    terms: ['treemap', 'heat map of positions', 'map', 'boxes by size'],
    guidance:
        'Nested boxes, one per group of groupBy, each sized by value and colored by heat. Use it to show where exposure or P&L sits, such as positions by sector and symbol. Its selection is an output: a filter of the node clicked.',
    category: 'data',
    config: TREEMAP_SCHEMA,
    // Its colors come from the color axis, which the heatmap module brings.
    modules: ['treemap', 'heatmap'],
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
    icon: 'info',
    sections: [
        {label: 'Data', keys: ['source', 'field', 'agg', 'trend']},
        {label: 'Content', keys: ['label', 'format', 'deltaField', 'deltaFormat', 'deltaLabel']},
        {label: 'Style', keys: ['invert', 'intent'], collapsed: true}
    ],
    summary: 'One headline number over a source, with an optional change and trend.',
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

const gauge: WidgetSpec = {
    name: 'gauge',
    icon: 'gauge',
    sections: [
        {label: 'Data', keys: ['source', 'value', 'filter']},
        {label: 'Display', keys: ['title', 'min', 'max', 'format']},
        {label: 'Style', keys: ['stops'], collapsed: true}
    ],
    summary: 'One reading on an arc from min to max, such as humidity or usage against a limit.',
    version: 1,
    label: 'Gauge',
    terms: ['gauge', 'dial', 'speedometer', 'meter', 'reading', 'against a limit', 'utilization'],
    guidance:
        "One reading, the total of value over the source, on an arc from min to max. Use it for a current reading on a known scale, such as humidity, a UV index or wind speed in a weather dashboard's current conditions, or for a figure against a limit, such as gross exposure against its limit. Use a statCard for a figure with no natural range, such as temperature or P&L. stops color the arc by how far along it the value sits. Set min and max to the scale's ends or the limit, never a guess.",
    category: 'data',
    config: GAUGE_SCHEMA,
    modules: ['highcharts-more', 'solid-gauge'],
    size: {default: {w: 3, h: 4}, min: {w: 2, h: 3}},
    example: {
        component: 'gauge',
        config: {
            source: 'positions',
            title: 'Gross exposure',
            value: 'mktVal',
            max: 1000000000,
            stops: [
                {at: 0.7, color: '#55bf3b'},
                {at: 0.9, color: '#dddf0d'},
                {at: 1, color: '#df5353'}
            ]
        }
    }
};

const tileFrame: WidgetSpec = {
    name: 'tileFrame',
    icon: 'layout',
    sections: [
        {label: 'Content', keys: ['title', 'emptyText']},
        {
            label: 'Display',
            keys: [
                'minTileWidth',
                'maxTileWidth',
                'minTileHeight',
                'maxTileHeight',
                'desiredRatio',
                'spacing'
            ]
        }
    ],
    summary: 'Equal tiles that wrap, such as a row of stat cards.',
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
    icon: 'list',
    sections: [{label: 'Data', keys: ['dimensions']}],
    summary: 'Lets a user choose the dimensions a grid groups by.',
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
    icon: 'bolt',
    sections: [{label: 'Interaction', keys: ['buttons']}],
    summary: 'A row of buttons, each running an action.',
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

const presetSelector: WidgetSpec = {
    name: 'presetSelector',
    icon: 'tag',
    sections: [
        {label: 'Data', keys: ['group']},
        {label: 'Content', keys: ['label']},
        {label: 'Display', keys: ['display']}
    ],
    summary: "Shows a preset group's presets and switches between them.",
    version: 1,
    label: 'Preset selector',
    terms: ['preset', 'view switcher', 'saved views', 'layouts'],
    guidance:
        "Shows a preset group's presets and switches the active one, such as a grid's P&L and Risk views. Put it beside the widget its group controls: in that widget's header on a canvas or in a panel. A group with no selector stays at its default. display toggle switches between exactly two presets.",
    category: 'input',
    config: PRESET_SELECTOR_SCHEMA,
    size: {default: {w: 3, h: 1}, min: {w: 2, h: 1}},
    // A group with no selector yet first, drawn to suit how many presets it has.
    starter: (config, {blueprint}) => {
        const groups = Object.entries(blueprint?.presets ?? {});
        if (!groups.length) return 'Add a preset group first, in the Presets tab.';
        const taken = new Set(
                Object.values(blueprint.elements ?? {})
                    .filter(it => it.component === 'presetSelector')
                    .map(it => it.config?.group)
            ),
            [group, decl] =
                groups.find(([name]) => name === config.group) ??
                groups.find(([name]) => !taken.has(name)) ??
                groups[0],
            count = Object.keys(decl.items ?? {}).length;
        return {
            ...config,
            group,
            display: count === 2 ? 'toggle' : count <= 4 ? 'segmented' : 'select'
        };
    },
    example: {component: 'presetSelector', config: {group: 'gridViews', display: 'segmented'}}
};

const buttonGroupInput: WidgetSpec = {
    name: 'buttonGroupInput',
    icon: 'bolt',
    sections: [{label: 'Interaction', keys: ['options']}],
    summary: 'A segmented control that picks one option of a string variable.',
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
    icon: 'question',
    version: 1,
    label: 'Placeholder',
    guidance: 'Stands in for an element of a chat answer that is still arriving.',
    category: 'data',
    reserved: true,
    config: {type: 'object', additionalProperties: false, properties: {component: {type: 'string'}}}
};

const fallback: WidgetSpec = {
    name: 'fallback',
    icon: 'warning',
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
    dashContainer,
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
    gauge,
    groupingChooser,
    buttonGroup,
    buttonGroupInput,
    presetSelector
];

//------------------
// Widget demand
//------------------
// Names a grid's tree column in `columnState` and `sortBy`.
const TREE_COLUMN = 'group';

const SOURCE_DEMANDS: Record<string, (config: PlainObject) => WidgetDemand> = {
    cubeGrid: cfg => ({
        fields: fieldNames([
            ...Object.values<PlainObject>(cfg.columns ?? {}).flatMap(it =>
                rendererFields(it?.renderer)
            ),
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
            ...castArray(cfg.y2 ?? []),
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
    gauge: cfg => ({
        fields: fieldNames([cfg.value, ...filterFields(cfg.filter)]),
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

/** The fields of a row a renderer's config reads beside its own, such as a progress bar's max. */
export function rendererFields(renderer: unknown): string[] {
    if (!renderer || typeof renderer !== 'object') return [];
    const r = renderer as PlainObject;
    return [r.maxField, r.targetField].filter(isString);
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
// plotBackgroundImage, a style's url() and the URL-named keys load from or link to a URL.
const HIGHCHARTS_REFUSED = [
        'renderTo',
        'useHTML',
        'events',
        'series',
        'data',
        'plotBackgroundImage',
        'href',
        'url',
        'libURL',
        'src'
    ],
    HIGHCHARTS_MAX_LENGTH = 20000,
    HIGHCHARTS_MAX_DEPTH = 10;

/** Problems with a chart's `highchartsConfig`: refused options, markup, URLs and bindings. */
export function checkHighchartsConfig(config: PlainObject): BlueprintIssue[] {
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
        } else if (isString(value) && /url\s*\(/i.test(value)) {
            fail(path, 'loads from a URL, which a chart may not');
        } else if (isString(value) && value.includes('\\') && /\/[a-z]*style\//i.test(path)) {
            // A CSS escape could spell url( past the check above.
            fail(path, 'holds a backslash, which a style may not');
        } else if (value && typeof value === 'object' && '$var' in value) {
            // A bound value would reach the chart unchecked.
            fail(path, 'takes no binding: write a value');
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

// Widgets that take the size their container gives them, and have none of their own.
const SIZELESS_WIDGETS = ['cubeGrid', 'chart', 'heatmap', 'treemap', 'gauge'];

const VALIDATORS: Record<string, WidgetSpec['validate']> = {
    chart: cfg => [
        ...(cfg.highchartsConfig ? checkHighchartsConfig(cfg.highchartsConfig) : []),
        ...(cfg.groupBy && !isEmpty(cfg.y2)
            ? [
                  {
                      code: 'chart.y2WithGroupBy',
                      severity: 'error' as const,
                      path: '/y2',
                      message:
                          'groupBy splits the first y alone, so a chart with groupBy takes no y2'
                  }
              ]
            : [])
    ],
    // A layout is GoldenLayout's own state, so it takes a size cap, and each view names a child.
    dashContainer: (cfg, {blueprint, id}) => {
        if (!cfg.layout) return [];
        const children = (blueprint.elements?.[id]?.children ?? []).map(it => it.id),
            issue = (code: string, path: string, message: string): BlueprintIssue => ({
                code,
                severity: 'error',
                path,
                message
            });
        if (JSON.stringify(cfg.layout).length > 20000) {
            return [
                issue(
                    'dashContainer.layoutTooLarge',
                    '/layout',
                    'the layout is past 20,000 characters'
                )
            ];
        }
        const ret: BlueprintIssue[] = [],
            walk = (items: unknown, path: string) =>
                castArray(items ?? []).forEach((it: PlainObject, idx) => {
                    const at = `${path}/${idx}`;
                    if (it?.type === 'view' && !children.includes(it.id)) {
                        ret.push(
                            issue(
                                'dashContainer.unknownView',
                                `${at}/id`,
                                `'${it.id}' is not a child`
                            )
                        );
                    }
                    walk(it?.content, `${at}/content`);
                });
        walk(cfg.layout, '/layout');
        return ret;
    },
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
    box: (cfg, {blueprint, id}) => {
        const elements = blueprint.elements ?? {},
            sizeless = (elements[id]?.children ?? []).filter(it =>
                SIZELESS_WIDGETS.includes(elements[it.id]?.component)
            );
        if (!cfg.align || cfg.align === 'stretch' || !sizeless.length) return [];
        return [
            {
                code: 'box.alignCollapses',
                severity: 'warning',
                path: '/align',
                message: `${sizeless.map(it => it.id).join(', ')} has no size of its own, so align ${cfg.align} leaves it no room across the box. Keep stretch.`
            }
        ];
    },
    tileFrame: cfg =>
        (['Width', 'Height'] as const)
            .filter(it => cfg[`minTile${it}`] > cfg[`maxTile${it}`])
            .map(it => ({
                code: 'tileFrame.minOverMax',
                severity: 'warning' as const,
                path: `/minTile${it}`,
                message: `minTile${it} is over maxTile${it}, so the tiles cannot meet both`
            })),
    presetSelector: (cfg, {blueprint}) => {
        const items = blueprint.presets?.[cfg.group]?.items;
        if (cfg.display !== 'toggle' || !items || Object.keys(items).length === 2) return [];
        return [
            {
                code: 'presetSelector.toggleNeedsTwo',
                severity: 'error',
                path: '/display',
                message: `a toggle switches between two presets, and '${cfg.group}' has ${Object.keys(items).length}`
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
    gauge: cfg =>
        (cfg.min ?? 0) < (cfg.max ?? 100)
            ? []
            : [
                  {
                      code: 'gauge.minNotUnderMax',
                      severity: 'error',
                      path: '/min',
                      message: 'min must be under max, or the gauge has no arc'
                  }
              ],
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
    },
    {
        name: 'openBlueprint',
        params: {
            type: 'object',
            required: ['blueprint'],
            properties: {
                blueprint: {
                    type: 'string',
                    'x-blueprint': true,
                    description: 'The id of a blueprint of the same type, from list_blueprints.'
                },
                as: {
                    enum: ['dialog', 'popover'],
                    default: 'dialog',
                    description: 'popover only for a small target, anchored to its button.'
                },
                title: {type: 'string', maxLength: 100, description: "Default the target's name."},
                variables: {
                    type: 'object',
                    description:
                        'Values for the variables of the target a link may set, by name: a literal, {"$var": name} or {"$row": field}.'
                }
            }
        },
        guidance:
            "Opens another blueprint over this one, such as a symbol's detail from a row of positions, passing values for the target's variables. Only in dashboards, and never from a blueprint it opened.",
        allowedIn: ['dashboards'],
        describe: ({blueprint, title, variables}) => {
            const values = Object.entries(variables ?? {}).map(
                ([name, v]) => `${name} = ${describeValue(v)}`
            );
            return `Open ${title ?? blueprint}${values.length ? ` with ${values.join(', ')}` : ''}`;
        }
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
        name: 'progress',
        appliesTo: {types: ['number', 'int']},
        config: {
            max: 'number, the value that fills the bar. Default 1',
            maxField: 'a field of the row whose value fills the bar, such as a limit',
            target: 'number, where to mark a goal on the bar',
            targetField: 'a field of the row whose value marks the goal'
        },
        guidance:
            'Draws a value as a bar filled to its share of a max, with its formatted value, such as usage against a limit.'
    },
    {
        name: 'sparkline',
        appliesTo: {types: ['number[]']},
        config: {
            type: "'line' (default), 'area' or 'bar'",
            colorBy: "'intent' (default), 'trend' for up or down overall, or 'sign' for each point"
        },
        guidance:
            "Draws a series as a small line, on its column's scale. A series field draws as one by default. A group row sums a series whose kind sums, such as daily P&L, point by point, and draws it on its own scale. Other series are blank on group rows."
    }
];
