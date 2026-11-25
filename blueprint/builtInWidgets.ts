import type {PlainObject} from '@xh/hoist/core';
import type {FromExtendedSchema} from 'json-schema-to-ts';
import {castArray, compact, isEmpty, isString, mapValues, mergeWith, uniq} from 'lodash';
import type {BlueprintIssue} from './Blueprint';
import type {BlueprintSchema, BlueprintSchemaExtension} from './BlueprintSchema';
import type {
    ActionSpec,
    RendererSpec,
    ResolverSpec,
    SlotAccepts,
    WidgetDemand,
    WidgetFit,
    WidgetSpec
} from './BlueprintRegistry';
import {DASHBOARD_COLUMNS, DASHBOARD_GAP, DASHBOARD_ROW_HEIGHT} from './dashboardCells';
import {filterFields} from './impl/bindings';
import {parentOf} from './impl/elements';
import {listOf} from './impl/labels';
import {templateDemand} from './impl/template';
import {getOwn} from './impl/pointer';

// Plain data and pure functions only, so a validator under plain Node can load these.

//------------------
// Widget config schemas
//------------------

// A grid column's alignment while unset, as the grid draws it.
const ALIGN_BY_TYPE = {number: 'right', int: 'right', '*': 'left'};
const ACTION = {
    type: 'object',
    required: ['type'],
    properties: {
        type: {
            type: 'string',
            description: "The action's name, such as setVariable or openBlueprint."
        }
    }
} as const satisfies BlueprintSchema;

/** An action prop: one action, or a list of up to 8 that run as steps. */
const ACTION_PROP = {
    'x-action': true,
    description: 'What runs: one action, or up to 8 that run in order as steps.',
    anyOf: [ACTION, {type: 'array', minItems: 1, maxItems: 8, items: ACTION}]
} as const satisfies BlueprintSchema;

/** A title, which may read variables: "P&L for {fund}". */
const TITLE = {
    'x-group': 'content',
    description: 'The title in its header. It can read variables, as "P&L for {fund}".',
    type: 'string',
    maxLength: 100,
    'x-binding': true,
    'x-template': 'variables',
    'x-unset': 'No title'
} as const satisfies BlueprintSchema;

const EMPTY_TEXT = {
    'x-group': 'content',
    type: 'string',
    maxLength: 200,
    'x-unset': 'Nothing to show',
    description: 'Text shown while the container has no children.'
} as const satisfies BlueprintSchema;

const SOURCE = {
    'x-group': 'data',
    type: 'string',
    'x-source': true,
    description: 'The source whose rows it reads.'
} as const satisfies BlueprintSchema;

const FILTER = {
    'x-filter': true,
    'x-binding': true,
    type: 'object',
    description: 'Shows only the rows that match. A Hoist filter, applied in the browser.'
} as const satisfies BlueprintSchema;

const DASHBOARD_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        emptyText: EMPTY_TEXT,
        columns: {
            'x-group': 'appearance',
            type: 'integer',
            minimum: 1,
            maximum: 48,
            default: DASHBOARD_COLUMNS,
            description: 'Columns in the grid.'
        },
        rowHeight: {
            'x-group': 'appearance',
            type: 'integer',
            minimum: 10,
            maximum: 200,
            default: DASHBOARD_ROW_HEIGHT,
            'x-unit': 'px',
            description: 'Height of one row.'
        },
        compact: {
            'x-group': 'appearance',
            'x-advanced': true,
            enum: ['vertical', 'horizontal', false],
            default: 'vertical',
            title: 'Packing',
            'x-labels': {false: 'Free'},
            'x-thumbnails': {
                vertical: 'dashboard.vertical',
                horizontal: 'dashboard.horizontal',
                false: 'dashboard.free'
            },
            description:
                'How cells pack: up, left, or not at all, so each stays where it is placed and a drop pushes the cells it lands on down.'
        },
        margin: {
            'x-group': 'appearance',
            'x-advanced': true,
            type: 'array',
            items: {type: 'integer', minimum: 0, maximum: 40},
            minItems: 2,
            maxItems: 2,
            default: [DASHBOARD_GAP, DASHBOARD_GAP],
            title: 'Cell gap',
            'x-unit': 'px',
            description: 'The space between cells, across and down.'
        },
        containerPadding: {
            'x-group': 'appearance',
            'x-advanced': true,
            type: 'array',
            items: {type: 'integer', minimum: 0, maximum: 40},
            minItems: 2,
            maxItems: 2,
            title: 'Padding',
            'x-unit': 'px',
            description:
                'The space inside the dashboard edge, across and down. Default the cell gap.'
        },
        maxRows: {
            'x-group': 'appearance',
            'x-advanced': true,
            type: 'integer',
            minimum: 1,
            title: 'Most rows',
            'x-unset': 'No limit',
            description: 'The rows a cell may reach, none below.'
        },
        showGridBackground: {
            'x-group': 'appearance',
            'x-advanced': true,
            type: 'boolean',
            default: false,
            title: 'Grid',
            'x-labels': {true: 'Show', false: 'Hide'},
            description: 'Draw the grid behind the cells for readers too. Design mode always does.'
        },
        preventCollision: {
            'x-group': 'behavior',
            'x-advanced': true,
            type: 'boolean',
            default: false,
            title: 'Drop on a cell',
            'x-labels': {false: 'Push', true: 'Snap back'},
            description:
                'Snap back a move or resize onto another cell, rather than push that cell aside.'
        },
        layoutLocked: {
            'x-group': 'behavior',
            type: 'boolean',
            default: true,
            title: 'Rearranging',
            'x-labels': {false: 'Allowed', true: 'Locked'},
            description:
                'Whether readers are stopped from moving and resizing cells. Design mode can always change the layout. Set layoutLocked: false only when the user wants readers to rearrange views.'
        }
    }
} as const satisfies BlueprintSchema;

const TAB_CONTAINER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        emptyText: EMPTY_TEXT,
        switcherPosition: {
            'x-group': 'appearance',
            enum: ['top', 'bottom', 'left', 'right'],
            default: 'top',
            title: 'Tab position',
            description: 'Where the row of tabs sits: above, below, or beside the content.'
        }
    }
} as const satisfies BlueprintSchema;

// A dash layout item, to a fixed depth as schemas here take no $ref: its shape, sizes and views.
// Titles come from child references, never from the layout.
function dashLayoutItem(depth: number): BlueprintSchema {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
            type: {
                type: 'string',
                enum: ['row', 'column', 'stack', 'view'],
                description:
                    'What the item is: a row or column of items, a stack of tabs, or a view.'
            },
            id: {type: 'string', description: 'The child a view shows, by its ID.'},
            width: {
                type: 'number',
                minimum: 0,
                maximum: 100,
                description: "Its share of its row's width, in percent."
            },
            height: {
                type: 'number',
                minimum: 0,
                maximum: 100,
                description: "Its share of its column's height, in percent."
            },
            ...(depth > 1
                ? {
                      content: {
                          type: 'array',
                          maxItems: 20,
                          items: dashLayoutItem(depth - 1),
                          description: 'The items a row, column or stack holds.'
                      }
                  }
                : {})
        }
    };
}

const PANES_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        // The container writes it back as the user rearranges it, so it stays a literal.
        layout: {
            'x-group': 'appearance',
            type: 'array',
            maxItems: 20,
            'x-binding': false,
            items: dashLayoutItem(6),
            description:
                "Rows and columns of stacks, each stack a set of tabs, each tab a view naming a child: [{type: 'row', content: [{type: 'stack', width: 60, content: [{type: 'view', id: 'grid'}, ...]}, ...]}]. Sizes are percentages of their row or column. Default one stack, a tab per child. A child the layout leaves out joins its first stack."
        },
        emptyText: EMPTY_TEXT,
        layoutLocked: {
            'x-group': 'behavior',
            type: 'boolean',
            default: true,
            title: 'Rearranging',
            'x-labels': {false: 'Allowed', true: 'Locked'},
            description:
                'Whether readers are stopped from moving, splitting and resizing views. Design mode can always change the layout. Set layoutLocked: false only when the user wants readers to rearrange views.'
        }
    }
} as const satisfies BlueprintSchema;

// A Font Awesome icon's name, which design mode picks from a list of icons.
const ICON_PROP = {
    'x-group': 'content',
    type: 'string',
    maxLength: 40,
    description: 'A Font Awesome icon name.',
    'x-icon': true
} as const;

const PANEL_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: TITLE,
        icon: ICON_PROP,
        style: {
            'x-group': 'appearance',
            type: 'string',
            enum: ['plain', 'card'],
            default: 'plain',
            description: 'plain draws a panel with a header. card draws a bordered group.'
        },
        intent: {
            'x-group': 'appearance',
            type: 'string',
            enum: ['none', 'primary', 'success', 'warning', 'danger'],
            default: 'none',
            description: "Colors a card style panel's border and title."
        },
        collapsible: {
            'x-group': 'behavior',
            type: 'boolean',
            default: false,
            description: 'Lets readers collapse the panel to its header.'
        },
        // The panel writes it back as the user collapses it, so it stays a literal.
        collapsed: {
            'x-group': 'behavior',
            type: 'boolean',
            default: false,
            'x-binding': false,
            title: 'Starts collapsed',
            description: 'Shows the panel collapsed to its header. Only when collapsible.'
        },
        compactHeader: {
            'x-group': 'appearance',
            type: 'boolean',
            default: false,
            title: 'Header',
            'x-labels': {false: 'Standard', true: 'Compact'},
            description: 'Draws a shorter header.'
        },
        emptyText: EMPTY_TEXT
    }
} as const satisfies BlueprintSchema;

const BOX_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        direction: {
            'x-group': 'appearance',
            'x-thumbnails': {row: 'direction.row', column: 'direction.column'},
            type: 'string',
            enum: ['column', 'row'],
            default: 'column',
            description: 'Lays out children in a column, top to bottom, or in a row, left to right.'
        },
        fill: {
            'x-group': 'appearance',
            type: 'boolean',
            default: true,
            description: 'True to fill its parent. False to take the size of its children.'
        },
        gap: {
            'x-group': 'appearance',
            type: 'integer',
            minimum: 0,
            maximum: 64,
            default: 0,
            description: 'Pixels between children.'
        },
        align: {
            'x-group': 'appearance',
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
            'x-group': 'data',
            type: 'string',
            'x-source': true,
            description: 'The source an undotted reference reads a field of.'
        },
        text: {
            'x-group': 'content',
            type: 'string',
            maxLength: 10000,
            'x-template': true,
            examples: ['Write this text in the inspector.'],
            description:
                'The text, in Markdown. It shows live values with {variable} and {source.field}.'
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
            'x-group': 'appearance',
            type: 'string',
            enum: ['primary', 'success', 'warning', 'danger', 'none'],
            default: 'primary',
            description: 'none is neutral, with no icon.'
        },
        title: {
            type: 'string',
            maxLength: 200,
            'x-template': true,
            'x-group': 'content',
            description: 'A bold line above the text. It can show {variable} and {source.field}.'
        },
        text: MARKDOWN_SCHEMA.properties.text
    }
} as const satisfies BlueprintSchema;

const LABEL = {
    type: 'string',
    maxLength: 40,
    description: 'Shown beside the input.',
    'x-unset': 'None',
    'x-group': 'content'
} as const;

const SELECT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        label: LABEL,
        placeholder: {
            type: 'string',
            maxLength: 60,
            'x-group': 'content',
            'x-unset': 'Select…',
            description: 'Shown in the input while it has no value.'
        }
    }
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
            'x-group': 'data',
            type: 'array',
            items: {type: 'string'},
            maxItems: 20,
            description:
                "The preset tokens to offer, such as mtd and ytd. Default Hoist's usual set. Its variable's preset is offered too."
        },
        asOf: {
            'x-group': 'data',
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
        min: {'x-group': 'data', type: 'number', description: 'The least value it takes.'},
        max: {'x-group': 'data', type: 'number', description: 'The greatest value it takes.'},
        precision: {
            'x-group': 'data',
            type: 'integer',
            minimum: 0,
            maximum: 8,
            description: 'The decimal places it shows and keeps.'
        }
    }
} as const satisfies BlueprintSchema;

const TEXT_INPUT_SCHEMA = {
    ...SELECT_SCHEMA,
    properties: {
        ...SELECT_SCHEMA.properties,
        placeholder: {...SELECT_SCHEMA.properties.placeholder, 'x-unset': 'None'}
    }
} as const satisfies BlueprintSchema;

const SWITCH_INPUT_SCHEMA = DATE_INPUT_SCHEMA;

const VARIABLE_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['variable'],
    properties: {
        variable: {
            'x-group': 'data',
            type: 'string',
            'x-variable': true,
            description: 'The prompted variable it shows and sets: one whose setBy is "prompt".'
        },
        label: {
            'x-group': 'content',
            ...LABEL,
            description: "Shown beside the input. Default the variable's label."
        }
    }
} as const satisfies BlueprintSchema;

const SLIDER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['min', 'max'],
    properties: {
        label: LABEL,
        min: {
            'x-group': 'data',
            type: 'number',
            default: 0,
            description: "The value at the slider's left end."
        },
        max: {
            'x-group': 'data',
            type: 'number',
            default: 100,
            description: "The value at the slider's right end."
        },
        step: {
            'x-group': 'data',
            type: 'number',
            minimum: 0.000001,
            default: 1,
            description: 'How much each move changes the value.'
        }
    }
} as const satisfies BlueprintSchema;

const FILTER_CHOOSER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['source'],
    properties: {
        source: SOURCE,
        label: LABEL,
        fields: {
            'x-group': 'list',
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
        vertical: {
            'x-group': 'appearance',
            type: 'boolean',
            default: false,
            description: 'Lays out its items in a column instead of a row.'
        },
        overflowMenu: {
            'x-group': 'behavior',
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
    properties: {
        label: {
            type: 'string',
            maxLength: 60,
            'x-group': 'content',
            description: 'Text shown on the line, such as the name of what follows.'
        }
    }
} as const satisfies BlueprintSchema;

const SPACER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        size: {
            'x-group': 'appearance',
            type: 'integer',
            minimum: 1,
            maximum: 400,
            'x-unset': 'The room left',
            description: 'Pixels along its parent. Leave unset to take all the room left.'
        }
    }
} as const satisfies BlueprintSchema;

/** A grid style: a closed set of keys, each value from a list or a strict pattern. */
const GRID_STYLE = {
    'x-group': 'style',
    type: 'object',
    description: 'The style to apply: text and background colors, weight, alignment and a border.',
    additionalProperties: false,
    properties: {
        color: {
            type: 'string',
            description: 'An intent (primary, success, warning, danger), muted, or #rrggbb.'
        },
        background: {type: 'string', description: 'An intent, or #rrggbb.'},
        fontWeight: {enum: ['bold', 'normal'], description: 'Bold or normal text.'},
        fontStyle: {enum: ['italic', 'normal'], description: 'Italic or normal text.'},
        textDecoration: {
            enum: ['underline', 'line-through', 'none'],
            description: 'Underlines the text or strikes it through.'
        },
        align: {enum: ['left', 'center', 'right'], description: 'Where the text sits in the cell.'},
        border: {
            enum: ['primary', 'success', 'warning', 'danger'],
            description: "A bar of the intent's color down the left edge."
        }
    }
} as const satisfies BlueprintSchema;

const STYLE_WHEN = {
    'x-group': 'when',
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
        'x-groups': [
            {id: 'when', label: 'When'},
            {id: 'style', label: 'Style'}
        ],
        'x-common': ['when', 'style'],
        'x-summary': ['style'],
        'x-page': true,
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
        'x-groups': [
            {id: 'when', label: 'When'},
            {id: 'style', label: 'Style'}
        ],
        'x-common': ['when', 'style'],
        'x-summary': ['rows', 'style'],
        'x-page': true,
        properties: {
            when: STYLE_WHEN,
            style: GRID_STYLE,
            rows: {
                'x-group': 'when',
                enum: ['all', 'leaves', 'groups'],
                default: 'all',
                description: 'Which rows the rule styles: all, leaf rows only, or group rows only.'
            }
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
        source: SOURCE,
        title: TITLE,
        groupBy: {
            'x-group': 'data',
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
            'x-group': 'list',
            title: 'Columns',
            type: 'array',
            maxItems: 60,
            'x-field': 'any',
            'x-binding': false,
            'x-settings': {in: 'columns', show: ['headerName', 'format', 'renderer']},
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
                                type: 'string',
                                description: "The column's field, or group for the tree column."
                            },
                            width: {
                                'x-group': 'size',
                                'x-row': 'Width',
                                'x-caption': 'Width',
                                type: 'integer',
                                minimum: 30,
                                maximum: 800,
                                'x-unset': 'Auto',
                                description: "The column's width in pixels."
                            },
                            hidden: {
                                'x-group': 'size',
                                type: 'boolean',
                                title: 'Visible',
                                'x-labels': {false: 'Show', true: 'Hide'},
                                description: 'Hides the column.'
                            },
                            pinned: {
                                'x-group': 'size',
                                enum: ['left', 'right'],
                                description:
                                    'Keeps the column at the left or right edge as the grid scrolls.'
                            }
                        }
                    }
                ]
            }
        },
        rowStyles: {...ROW_STYLE_RULES, 'x-group': 'appearance', 'x-advanced': true},
        rowActions: {
            'x-group': 'behavior',
            type: 'array',
            maxItems: 10,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['label', 'action'],
                'x-groups': [
                    {id: 'item', label: 'Menu item'},
                    {id: 'action', label: 'Action'}
                ],
                'x-common': ['label', 'action'],
                'x-summary': ['action'],
                properties: {
                    label: {
                        'x-group': 'item',
                        type: 'string',
                        maxLength: 40,
                        description: "The action's name in the row menu."
                    },
                    icon: {...ICON_PROP, 'x-group': 'item'},
                    action: {...ACTION_PROP, 'x-group': 'action'}
                }
            },
            description:
                'Actions on a row, in its right-click menu, the first also on a double click. An action reads the row\'s fields, and its group path\'s, with {"$row": field}.'
        },
        columns: {
            'x-group': 'list',
            type: 'object',
            'x-field': 'any',
            description:
                'How each column shows, keyed by field, or group for the tree column. Keep the defaults unless the user asks.',
            additionalProperties: {
                type: 'object',
                additionalProperties: false,
                'x-groups': [
                    {id: 'header', label: 'Header'},
                    {id: 'values', label: 'Values'},
                    {id: 'size', label: 'Size and position'},
                    {id: 'styles', label: 'Conditional styles'},
                    {id: 'chooser', label: 'Chooser and export', collapsed: true}
                ],
                // In the order its page leads each section with them, as the mockup has it.
                'x-common': [
                    'headerName',
                    'headerTooltip',
                    'headerAlign',
                    'format',
                    'width',
                    'minWidth',
                    'maxWidth',
                    'pinned',
                    'hidden'
                ],
                'x-summary': ['format', 'pinned', 'width'],
                properties: {
                    styles: {...CELL_STYLE_RULES, 'x-group': 'styles'},
                    headerName: {
                        'x-group': 'header',
                        type: 'string',
                        title: 'Header',
                        maxLength: 100,
                        'x-template': 'variables',
                        description:
                            'The header text, which may read variables. Default the field label.'
                    },
                    headerTooltip: {
                        'x-group': 'header',
                        title: 'Tooltip',
                        type: 'string',
                        maxLength: 200,
                        'x-unset': 'The field description',
                        description: 'The header tooltip. Default the field description.'
                    },
                    headerAlign: {
                        'x-group': 'header',
                        title: 'Align',
                        enum: ['left', 'center', 'right'],
                        'x-type-default': ALIGN_BY_TYPE,
                        description: 'How the header aligns. Default as its cells.'
                    },
                    align: {
                        'x-group': 'values',
                        'x-advanced': true,
                        enum: ['left', 'center', 'right'],
                        'x-type-default': ALIGN_BY_TYPE,
                        description: 'How the cells align. Default right for a number, else left.'
                    },
                    tooltip: {
                        'x-group': 'values',
                        'x-advanced': true,
                        type: 'boolean',
                        description: 'Show the value on hover, for a column too narrow for it.'
                    },
                    highlightOnChange: {
                        'x-group': 'size',
                        'x-advanced': true,
                        type: 'boolean',
                        description: 'Flash a cell when its value changes, as in a live grid.'
                    },
                    minWidth: {
                        'x-group': 'size',
                        'x-row': 'Width',
                        'x-caption': 'Min',
                        type: 'integer',
                        minimum: 20,
                        'x-unset': '20',
                        maximum: 800,
                        description: 'The narrowest a user or a flex column may make it, in pixels.'
                    },
                    maxWidth: {
                        'x-group': 'size',
                        'x-row': 'Width',
                        'x-caption': 'Max',
                        type: 'integer',
                        minimum: 20,
                        'x-unset': 'None',
                        maximum: 2000,
                        description: 'The widest a user or a flex column may make it, in pixels.'
                    },
                    flex: {
                        'x-group': 'size',
                        'x-advanced': true,
                        anyOf: [{type: 'boolean'}, {type: 'number', minimum: 0, maximum: 10}],
                        description:
                            'Stretch to fill the grid, sharing the width with other flex columns in proportion.'
                    },
                    chooserName: {
                        'x-group': 'chooser',
                        'x-advanced': true,
                        type: 'string',
                        maxLength: 100,
                        description: "The column's name in the column chooser. Default its header."
                    },
                    chooserGroup: {
                        'x-group': 'chooser',
                        'x-advanced': true,
                        type: 'string',
                        maxLength: 100,
                        description:
                            "The column chooser's group for it. Default the field's category."
                    },
                    chooserDescription: {
                        'x-group': 'chooser',
                        'x-advanced': true,
                        type: 'string',
                        maxLength: 500,
                        description:
                            'The text the column chooser shows for it. Default the field description.'
                    },
                    exportName: {
                        'x-group': 'chooser',
                        'x-advanced': true,
                        type: 'string',
                        maxLength: 100,
                        description: 'Its header in an export. Default its header.'
                    },
                    format: {
                        'x-group': 'values',
                        'x-format': true,
                        anyOf: [{type: 'string'}, {type: 'object'}],
                        description: "Its number or date format, over the field's own."
                    },
                    renderer: {
                        'x-group': 'values',
                        'x-advanced': true,
                        'x-renderer': true,
                        anyOf: [
                            {type: 'string'},
                            {
                                type: 'object',
                                required: ['name'],
                                properties: {
                                    name: {
                                        type: 'string',
                                        description:
                                            "The renderer's name. Its other keys are the renderer's options."
                                    }
                                }
                            }
                        ],
                        description: "How its cells draw, in place of the field's renderer."
                    }
                }
            }
        },
        // The grid writes it back as the user sorts, so it stays a literal.
        sortBy: {
            'x-group': 'data',
            'x-binding': false,
            'x-sort': true,
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
        filter: {...FILTER, 'x-group': 'data'},
        expandLevel: {
            'x-group': 'data',
            'x-advanced': true,
            'x-binding': true,
            type: 'integer',
            minimum: 0,
            maximum: 6,
            description: 'How many levels of groups start expanded. 0 starts every group collapsed.'
        },
        showSummary: {
            'x-group': 'appearance',
            'x-thumbnails': {top: 'summary.top', bottom: 'summary.bottom', false: 'summary.off'},
            'x-binding': true,
            title: 'Summary row',
            enum: ['top', 'bottom', true, false],
            default: false,
            description:
                "A row of totals docked at the top or bottom, or false for none. True, as Hoist's GridModel takes it, means 'top'."
        },
        treeStyle: {
            'x-group': 'appearance',
            'x-advanced': true,
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
            'x-group': 'appearance',
            'x-binding': true,
            type: 'boolean',
            default: true,
            description: 'Alternate the background of rows.'
        },
        rowBorders: {
            'x-group': 'appearance',
            'x-advanced': true,
            'x-binding': true,
            type: 'boolean',
            default: true,
            description: 'Draw a border between rows.'
        },
        cellBorders: {
            'x-group': 'appearance',
            'x-advanced': true,
            'x-binding': true,
            type: 'boolean',
            default: false,
            description: 'Draw a border between cells.'
        },
        showHover: {
            'x-group': 'appearance',
            'x-advanced': true,
            'x-binding': true,
            type: 'boolean',
            default: false,
            description: 'Highlight the row under the pointer.'
        },
        sizingMode: {
            'x-group': 'appearance',
            'x-advanced': true,
            'x-binding': true,
            enum: ['tiny', 'compact', 'standard', 'large'],
            'x-unset': "The app's sizing mode",
            description: "The size of the grid's text and rows. Default the app's sizing mode."
        },
        showGroupRowCounts: {
            'x-group': 'data',
            'x-advanced': true,
            'x-binding': true,
            type: 'boolean',
            title: 'Group counts',
            'x-labels': {true: 'Show', false: 'Hide'},
            default: true,
            description: 'Show the count of rows in each group row.'
        },
        hideHeaders: {
            'x-group': 'appearance',
            'x-advanced': true,
            'x-binding': true,
            type: 'boolean',
            title: 'Column headers',
            'x-labels': {false: 'Show', true: 'Hide'},
            default: false,
            description: 'Hide the row of column headers.'
        },
        emptyText: {
            'x-group': 'content',
            type: 'string',
            maxLength: 200,
            default: 'No data',
            description: 'Text to show when the grid has no rows.'
        },
        groupRowHeight: {
            'x-group': 'appearance',
            'x-advanced': true,
            type: 'integer',
            minimum: 16,
            maximum: 100,
            'x-unset': 'By sizing mode',
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
        source: SOURCE,
        title: TITLE,
        type: {
            'x-group': 'appearance',
            'x-thumbnails': {
                line: 'chart.line',
                spline: 'chart.spline',
                column: 'chart.column',
                bar: 'chart.bar',
                area: 'chart.area',
                areaspline: 'chart.areaspline',
                pie: 'chart.pie',
                scatter: 'chart.scatter',
                waterfall: 'chart.waterfall'
            },
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
            'x-group': 'content',
            'x-row': 'Axis titles',
            'x-caption': 'X',
            type: 'string',
            maxLength: 100,
            'x-binding': true,
            'x-unset': "The field's label",
            description: "Title of the x-axis. Default the x field's label."
        },
        yTitle: {
            'x-group': 'content',
            'x-row': 'Axis titles',
            'x-caption': 'Y',
            type: 'string',
            maxLength: 100,
            'x-binding': true,
            'x-unset': "The series' label",
            description: "Title of the y-axis. Default the y field's label, if there is one y."
        },
        x: {
            'x-group': 'data',
            title: 'Category (X)',
            type: 'string',
            'x-field': 'any',
            description: 'The field across the x-axis, one point per value.'
        },
        y: {
            'x-group': 'list',
            title: 'Series',
            'x-settings': {in: 'series', show: ['name', 'color', 'type']},
            type: 'array',
            items: {
                type: 'string'
            },
            minItems: 1,
            maxItems: 8,
            'x-field': 'measure',
            description: 'The measures to draw, one series each.'
        },
        y2: {
            'x-group': 'list',
            'x-advanced': true,
            type: 'array',
            items: {type: 'string'},
            maxItems: 4,
            'x-field': 'measure',
            'x-starter': false,
            description:
                'Measures on a second axis, on the right, where their scale differs from y.'
        },
        y2Title: {
            'x-group': 'content',
            'x-row': 'Axis titles',
            'x-caption': 'Y2',
            title: 'Y2 title',
            'x-advanced': true,
            type: 'string',
            maxLength: 100,
            'x-binding': true,
            'x-unset': "The series' label",
            description: "Title of the second axis. Default the y2 field's label, if there is one."
        },
        groupBy: {
            'x-group': 'data',
            title: 'Split by',
            type: 'string',
            'x-field': 'dimension',
            'x-starter': false,
            description: 'A dimension that splits the first y into one series per value.'
        },
        stacking: {
            'x-group': 'appearance',
            'x-binding': true,
            enum: ['normal', 'percent'],
            'x-unset': 'No stacking',
            description:
                "Stacks the series on each other: by value, or as a percent of each point's total."
        },
        filter: {...FILTER, 'x-group': 'data', 'x-advanced': true},
        sortBy: {
            'x-group': 'data',
            'x-advanced': true,
            type: 'string',
            pattern: '^[A-Za-z0-9_-]+(\\|(asc|desc))?$',
            description: 'Sorts the points by a field, as field|asc or field|desc.'
        },
        top: {
            'x-group': 'data',
            'x-advanced': true,
            type: 'integer',
            minimum: 1,
            maximum: 100,
            'x-unset': 'All',
            description: 'Shows only the first points, after sorting.'
        },
        series: {
            'x-group': 'list',
            type: 'object',
            'x-field': 'measure',
            description:
                'How each series of y and y2 draws, keyed by its measure: its name, color, type, and whether it shows. Not for a series per groupBy value. Keep the defaults unless the user asks.',
            additionalProperties: {
                type: 'object',
                additionalProperties: false,
                'x-common': ['name', 'color', 'type', 'hidden'],
                'x-summary': ['type', 'color'],
                properties: {
                    name: {
                        type: 'string',
                        maxLength: 60,
                        description:
                            "The series' name in the legend and tooltip. Default the field label."
                    },
                    color: {
                        type: 'string',
                        pattern: '^#[0-9a-fA-F]{6}$',
                        description:
                            'The series color, as #rrggbb. Default the next of the chart colors.'
                    },
                    type: {
                        enum: ['line', 'spline', 'column', 'bar', 'area', 'areaspline', 'scatter'],
                        description:
                            "How the series draws, over the chart's type, such as a line over columns."
                    },
                    hidden: {
                        type: 'boolean',
                        title: 'Visible',
                        'x-labels': {false: 'Show', true: 'Hide'},
                        description: 'Starts the series hidden. A reader shows it from the legend.'
                    }
                }
            }
        },
        highchartsConfig: {
            'x-group': 'appearance',
            'x-advanced': true,
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
        source: SOURCE,
        title: TITLE,
        fields: {
            'x-group': 'list',
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
                        'x-common': ['label', 'format'],
                        'x-summary': ['format'],
                        properties: {
                            field: {
                                type: 'string',
                                'x-field': 'any',
                                description: 'The field the row shows.'
                            },
                            label: {
                                type: 'string',
                                maxLength: 60,
                                description: "The row's label, in place of the field's."
                            },
                            format: {
                                'x-format': true,
                                anyOf: [{type: 'string'}, {type: 'object'}],
                                description: "How the value shows, in place of the field's format."
                            },
                            renderer: {
                                'x-renderer': true,
                                anyOf: [{type: 'string'}, {type: 'object'}],
                                description:
                                    "How the value draws, in place of the field's renderer."
                            }
                        }
                    }
                ]
            },
            description:
                'The fields to list, one row each: a field name, or an object with its own label, format or renderer.'
        },
        filter: {...FILTER, 'x-group': 'data'},
        columns: {
            'x-group': 'appearance',
            type: 'integer',
            minimum: 1,
            maximum: 4,
            default: 1,
            description: 'The columns the rows flow into.'
        },
        labelSide: {
            'x-group': 'appearance',
            enum: ['left', 'top'],
            default: 'left',
            description: 'Puts each label beside its value, or above it.'
        }
    }
} as const satisfies BlueprintSchema;

const HEATMAP_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'x', 'y', 'value'],
    properties: {
        source: SOURCE,
        title: TITLE,
        x: {
            'x-group': 'data',
            type: 'string',
            'x-field': 'dimension',
            description: 'The dimension across.'
        },
        y: {
            'x-group': 'data',
            type: 'string',
            'x-field': 'dimension',
            description: 'The dimension down.'
        },
        value: {
            'x-group': 'data',
            type: 'string',
            'x-field': 'measure',
            description: 'Colors each cell.'
        },
        colorMode: {
            'x-group': 'appearance',
            'x-thumbnails': {diverging: 'color.diverging', sequential: 'color.sequential'},
            enum: ['diverging', 'sequential'],
            default: 'diverging',
            description:
                'diverging colors below zero red and above green, as for P&L. Use sequential only for a measure that is never negative.'
        },
        filter: {...FILTER, 'x-group': 'data', 'x-advanced': true}
    }
} as const satisfies BlueprintSchema;

const TREEMAP_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'value'],
    properties: {
        source: SOURCE,
        title: TITLE,
        groupBy: {
            'x-group': 'data',
            type: 'array',
            items: {type: 'string'},
            minItems: 1,
            maxItems: 4,
            'x-field': 'dimension',
            'x-binding': true,
            description: 'The dimensions that nest the nodes, outermost first.'
        },
        value: {
            'x-group': 'data',
            type: 'string',
            'x-field': 'measure',
            description: 'Sizes each node.'
        },
        heat: {
            'x-group': 'data',
            type: 'string',
            'x-field': 'measure',
            'x-starter': false,
            description: 'Colors each node: green above zero, red below. Default value.'
        },
        colorMode: {
            'x-group': 'appearance',
            'x-thumbnails': {linear: 'color.linear', wash: 'color.wash', none: 'color.none'},
            enum: ['linear', 'wash', 'none'],
            default: 'linear',
            description: 'How heat colors each node: on a scale, as a wash, or not at all.'
        },
        maxDepth: {
            'x-group': 'data',
            'x-advanced': true,
            type: 'integer',
            minimum: 1,
            maximum: 4,
            'x-unset': 'All',
            description: 'How many levels of groupBy to draw.'
        },
        filter: {...FILTER, 'x-group': 'data', 'x-advanced': true}
    }
} as const satisfies BlueprintSchema;

const FORMAT_PROP = {
    'x-group': 'content',
    description: 'How the number shows: a named format, or Hoist number options.',
    'x-format': true,
    anyOf: [{type: 'string'}, {type: 'object'}]
} as const satisfies BlueprintSchema;

const STAT_CARD_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['source'],
    properties: {
        source: SOURCE,
        field: {
            'x-group': 'data',
            type: 'string',
            'x-field': 'measure',
            description: 'The measure the card shows.'
        },
        label: {
            'x-group': 'content',
            type: 'string',
            maxLength: 40,
            'x-template': 'variables',
            description: 'The name above the figure. It can read variables.'
        },
        format: FORMAT_PROP,
        agg: {
            'x-group': 'data',
            enum: ['count', 'SUM', 'AVG', 'MIN', 'MAX', 'UNIQUE'],
            'x-unset': "The field's aggregator",
            description: "How the source's rows total into one figure."
        },
        deltaField: {
            'x-group': 'content',
            type: 'string',
            'x-field': 'measure',
            'x-starter': false,
            description: "A measure shown beside the figure as its change, such as the day's P&L."
        },
        deltaFormat: FORMAT_PROP,
        deltaLabel: {
            'x-group': 'content',
            type: 'string',
            maxLength: 40,
            description: 'Words after the change, such as "vs yesterday".'
        },
        invert: {
            'x-group': 'appearance',
            'x-advanced': true,
            type: 'boolean',
            default: false,
            description: 'Colors a fall green and a rise red, for a figure where less is better.'
        },
        intent: {
            'x-group': 'appearance',
            'x-advanced': true,
            enum: ['none', 'primary', 'success', 'warning', 'danger'],
            default: 'none',
            description: "Colors the card's figure."
        },
        trend: {
            'x-group': 'data',
            'x-advanced': true,
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
        source: SOURCE,
        title: TITLE,
        value: {
            'x-group': 'data',
            type: 'string',
            'x-field': 'measure',
            description: 'The total the needle shows.'
        },
        min: {
            'x-group': 'appearance',
            type: 'number',
            default: 0,
            description: 'The start of the arc.'
        },
        max: {
            'x-group': 'appearance',
            type: 'number',
            default: 100,
            description: 'The end of the arc.'
        },
        stops: {
            'x-group': 'appearance',
            'x-advanced': true,
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
        filter: {...FILTER, 'x-group': 'data', 'x-advanced': true}
    }
} as const satisfies BlueprintSchema;

const TILE_FRAME_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: TITLE,
        minTileWidth: {
            'x-group': 'appearance',
            type: 'integer',
            minimum: 20,
            maximum: 2000,
            'x-unit': 'px',
            description: 'The narrowest a tile gets. More tiles wrap to a new row.'
        },
        maxTileWidth: {
            'x-group': 'appearance',
            'x-advanced': true,
            type: 'integer',
            minimum: 20,
            maximum: 2000,
            'x-unit': 'px',
            description: 'The widest a tile gets, however few there are.'
        },
        minTileHeight: {
            'x-group': 'appearance',
            'x-advanced': true,
            type: 'integer',
            minimum: 20,
            maximum: 2000,
            'x-unit': 'px',
            description: 'The shortest a tile gets.'
        },
        maxTileHeight: {
            'x-group': 'appearance',
            'x-advanced': true,
            type: 'integer',
            minimum: 20,
            maximum: 2000,
            'x-unit': 'px',
            description: 'The tallest a tile gets.'
        },
        desiredRatio: {
            'x-group': 'appearance',
            type: 'number',
            minimum: 0.1,
            maximum: 10,
            default: 1,
            description: 'Tile width over height.'
        },
        spacing: {
            'x-group': 'appearance',
            type: 'integer',
            minimum: 0,
            maximum: 64,
            default: DASHBOARD_GAP,
            'x-unit': 'px',
            description: "The space between tiles, as a dashboard's cell gap by default."
        },
        emptyText: EMPTY_TEXT
    }
} as const satisfies BlueprintSchema;

const PRESET_SELECTOR_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['group'],
    properties: {
        group: {
            'x-group': 'data',
            type: 'string',
            'x-preset': true,
            description: 'The preset group it switches.'
        },
        display: {
            'x-group': 'appearance',
            'x-thumbnails': {
                segmented: 'display.segmented',
                buttonGroup: 'display.buttonGroup',
                select: 'display.select',
                toggle: 'display.toggle'
            },
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
            'x-group': 'data',
            type: 'array',
            items: {
                type: 'string'
            },
            minItems: 1,
            maxItems: 20,
            'x-field': 'dimension',
            description: 'The dimensions readers can group by.'
        }
    }
} as const satisfies BlueprintSchema;

const BUTTON_GROUP_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['buttons'],
    properties: {
        buttons: {
            'x-group': 'list',
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['label', 'action'],
                'x-common': ['label', 'icon', 'action'],
                'x-summary': ['action'],
                'x-page': false,
                properties: {
                    label: {
                        type: 'string',
                        maxLength: 40,
                        // A new button refreshes, so its label says so.
                        examples: ['Refresh'],
                        description: "The button's text."
                    },
                    icon: ICON_PROP,
                    action: ACTION_PROP
                }
            },
            description: 'The buttons, in order, each running an action.'
        }
    }
} as const satisfies BlueprintSchema;

const BUTTON_GROUP_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['options'],
    properties: {
        options: {
            'x-group': 'list',
            type: 'array',
            minItems: 2,
            maxItems: 8,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['value', 'label'],
                'x-common': ['value', 'label'],
                'x-summary': ['value'],
                properties: {
                    value: {
                        type: 'string',
                        description: 'The value the variable takes when this option is picked.'
                    },
                    label: {
                        type: 'string',
                        maxLength: 30,
                        description: "The option's text."
                    }
                }
            },
            description: 'The choices, one segment each, in order.'
        }
    }
} as const satisfies BlueprintSchema;

/** The config of a `dashboard` widget, with bindings resolved. */
export type DashboardWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof DASHBOARD_SCHEMA
>;

/** The config of a `tabContainer` widget, with bindings resolved. */
export type PanelWidgetConfig = FromExtendedSchema<BlueprintSchemaExtension, typeof PANEL_SCHEMA>;

export type PanesWidgetConfig = FromExtendedSchema<BlueprintSchemaExtension, typeof PANES_SCHEMA>;

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

export type VariableInputWidgetConfig = FromExtendedSchema<
    BlueprintSchemaExtension,
    typeof VARIABLE_INPUT_SCHEMA
>;

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

const dashboard: WidgetSpec = {
    name: 'dashboard',
    icon: 'dashboard',
    summary: "A 12-column grid of widgets placed by x, y, w and h. A blueprint's usual root.",
    version: 1,
    label: 'Dashboard',
    terms: ['dashboard', 'canvas', 'page', 'layout'],
    guidance:
        "A 12-column grid of widgets. Each child reference gives x, y, w and h in grid units, and may give the cell header's title in place of the widget's own, or hideHeader. Every cell has a header unless it hides it, titled by the widget's label where nothing gives a title, so give a cell such as a stat card or a button row hideHeader where a header adds nothing. Cells pack upward by default; set compact false only when the user wants each cell to stay exactly where it is placed. Leave the other layout settings unset unless the user asks for them. Use it as the root of a dashboard, or as the content of a tab.",
    category: 'container',
    config: DASHBOARD_SCHEMA,
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
                },
                title: {
                    type: 'string',
                    maxLength: 60,
                    'x-template': 'variables',
                    'x-unset': "The widget's title",
                    description: "The cell header's title, in place of the widget's own."
                },
                hideHeader: {
                    type: 'boolean',
                    default: false,
                    description: 'True to draw the cell with no header.'
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
    // Room for widgets of its own, where it sits on another dashboard.
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
        component: 'dashboard',
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
    summary: 'Shows one child at a time, under a row of tabs.',
    version: 1,
    label: 'Tabs',
    terms: ['tabs', 'tab', 'pages'],
    guidance:
        "Shows one child at a time, under a row of tabs. Each child reference gives the tab's title. Children are usually dashboard elements. Keep tab titles to one or two words. Use the label a person would say, not a raw value.",
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
                icon: ICON_PROP
            }
        }
    },
    // Room for widgets of its own, where it sits on another dashboard.
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

const panes: WidgetSpec = {
    name: 'panes',
    icon: 'layout',
    summary: 'Views a user drags into tabs, stacks, rows and columns, and resizes.',
    version: 1,
    label: 'Panes',
    terms: ['panes', 'dock', 'docking', 'stacks', 'rearrange', 'tabs and splits', 'split panes'],
    guidance:
        'Views a user can drag into tabs, stacks, rows and columns, and resize. Each child reference may give the title of its tab. Its layout is rows and columns of stacks of tabs, each tab naming a child, sized in percent. Use tabContainer for plain tabs, and this to split views side by side. Set layoutLocked: false only when the user wants readers to rearrange views.',
    category: 'container',
    config: PANES_SCHEMA,
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
        component: 'panes',
        config: {
            layout: [
                {
                    type: 'row',
                    content: [
                        {
                            type: 'stack',
                            width: 60,
                            content: [
                                {type: 'view', id: 'posGrid'},
                                {type: 'view', id: 'ordersGrid'}
                            ]
                        },
                        {type: 'stack', width: 40, content: [{type: 'view', id: 'chart'}]}
                    ]
                }
            ]
        },
        children: [
            {id: 'posGrid', title: 'Positions'},
            {id: 'ordersGrid', title: 'Orders'},
            {id: 'chart', title: 'Sectors'}
        ]
    }
};

const panel: WidgetSpec = {
    name: 'panel',
    icon: 'square',
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
        | 'example'
    >
): WidgetSpec => ({
    version: 1,
    category: 'input',
    size: INPUT_SIZE,
    ...spec,
    guidance: `${spec.guidance} It shows and sets the variable whose setBy names it.`,
    example: spec.example ?? {component: spec.name, config: {label: spec.label}}
});

const select = inputSpec({
    name: 'select',
    icon: 'list',
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
    summary: 'An on/off switch for a bool variable.',
    label: 'Switch',
    terms: ['switch', 'toggle', 'on off', 'checkbox'],
    guidance: 'An on/off switch for a bool variable.',
    config: SWITCH_INPUT_SCHEMA,
    value: {type: 'bool'}
});

const variableInput: WidgetSpec = {
    name: 'variableInput',
    icon: 'edit',
    version: 1,
    category: 'input',
    size: INPUT_SIZE,
    summary: 'The input for a prompted variable, by its type.',
    label: 'Variable input',
    terms: ['prompt', 'variable input', 'parameter', 'as of', 'input'],
    guidance:
        'Shows and sets one variable whose setBy is "prompt", with the input its type calls for: a date picker for a date, a select for a variable with options, a range picker for a dateRange, and an app type\'s own input. Show every prompted variable in one, usually in the root panel\'s tbar.',
    config: VARIABLE_INPUT_SCHEMA,
    example: {component: 'variableInput', config: {variable: 'asOf'}}
};

const slider = inputSpec({
    name: 'slider',
    icon: 'arrowsLeftRight',
    example: {component: 'slider', config: {label: 'Weight', min: 0, max: 100}},
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
    example: {component: 'filterChooser', config: {source: 'positions', label: 'Filter'}},
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
    summary: 'A Hoist chart, grouped by a dimension x, or a time series.',
    version: 1,
    label: 'Chart',
    terms: ['chart', 'graph', 'plot', 'trend', 'bar chart', 'line chart'],
    guidance:
        'A Hoist chart. If x is a dimension, the chart aggregates its source by x. If x is a date or time field, it plots rows as they are, for a time series. Name it with its title, not a text element beside it. Name, color or restyle a series in series, keyed by its measure, never in highchartsConfig.',
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
            value: 'grossExposure',
            max: 80000000000,
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
    icon: 'tiles',
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
    summary: "Shows a preset group's presets and switches between them.",
    version: 1,
    label: 'Preset selector',
    terms: ['preset', 'view switcher', 'saved views', 'layouts'],
    guidance:
        "Shows a preset group's presets and switches the active one, such as a grid's P&L and Risk views. Put it beside the widget its group controls: in that widget's header on a dashboard or in a panel. A group with no selector stays at its default. display toggle switches between exactly two presets.",
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
    dashboard,
    tabContainer,
    panes,
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
    variableInput,
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
    // It shows a prompted variable, which the user sets through it.
    variableInput: (cfg, {blueprint}) => {
        const name = cfg.variable;
        if (typeof name !== 'string' || !name) return [];
        const decl = getOwn(blueprint.variables, name),
            issue = (code: string, message: string): BlueprintIssue[] => [
                {code, severity: 'error', path: '/variable', message}
            ];
        if (!decl) return issue('variableInput.unknownVariable', `there is no variable '${name}'`);
        return decl.setBy === 'prompt'
            ? []
            : issue(
                  'variableInput.notPrompted',
                  `'${name}' is not prompted. A variableInput shows a variable whose setBy is "prompt".`
              );
    },
    // A layout takes a size cap, and each view names a child.
    panes: (cfg, {blueprint, id}) => {
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
                issue('panes.layoutTooLarge', '/layout', 'the layout is past 20,000 characters')
            ];
        }
        const ret: BlueprintIssue[] = [],
            walk = (items: unknown, path: string) =>
                castArray(items ?? []).forEach((it: PlainObject, idx) => {
                    const at = `${path}/${idx}`;
                    if (it?.type === 'view' && !children.includes(it.id)) {
                        ret.push(
                            issue('panes.unknownView', `${at}/id`, `'${it.id}' is not a child`)
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
                code: 'config.incomplete',
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
        const many = sizeless.length > 1;
        return [
            {
                code: 'box.alignCollapses',
                severity: 'warning',
                path: '/align',
                message: `${listOf(sizeless.map(it => it.id))} ${many ? 'have' : 'has'} no size of ${many ? 'their' : 'its'} own, so align ${cfg.align} leaves ${many ? 'them' : 'it'} no room across the box. Keep stretch.`
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
                      code: 'config.incomplete',
                      severity: 'error',
                      path: '/field',
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

// A widget's own example, with its config extended, for a container's example to hold.
const exampleOf = (name: string, config: PlainObject = {}): PlainObject => {
    const example = WIDGET_SPECS.find(it => it.name === name).example;
    return {...example, config: {...example.config, ...config}};
};

// What each example names beyond itself: a container's children, from the other widgets' own
// examples, and the variables and preset groups an example reads.
const EXAMPLE_BLUEPRINTS: Record<string, () => WidgetSpec['exampleBlueprint']> = {
    dashboard: () => ({elements: {posGrid: exampleOf('cubeGrid')}}),
    tabContainer: () => ({
        elements: {
            overview: {
                component: 'dashboard',
                children: [{id: 'posGrid', x: 0, y: 0, w: 12, h: 6}]
            },
            detail: exampleOf('markdown'),
            posGrid: exampleOf('cubeGrid')
        }
    }),
    panes: () => ({
        elements: {
            posGrid: exampleOf('cubeGrid'),
            ordersGrid: exampleOf('cubeGrid'),
            chart: exampleOf('chart')
        }
    }),
    panel: () => ({elements: {exposureGrid: exampleOf('cubeGrid')}}),
    box: () => ({
        elements: {
            posGrid: exampleOf('cubeGrid'),
            divider: {component: 'separator'},
            sectorChart: exampleOf('chart')
        }
    }),
    toolbar: () => ({
        elements: {
            regionSelect: exampleOf('select', {label: 'Region'}),
            asOfInput: exampleOf('dateInput', {label: 'As of'})
        }
    }),
    tileFrame: () => ({
        elements: {
            mktValCard: exampleOf('statCard'),
            pnlDayCard: exampleOf('statCard', {field: 'pnlDay'})
        }
    }),
    callout: () => ({variables: {asOf: {type: 'localDate', label: 'As of', setBy: 'prompt'}}}),
    variableInput: () => ({
        variables: {asOf: {type: 'localDate', label: 'As of', setBy: 'prompt'}}
    }),
    propertyTable: () => ({variables: {fund: {type: 'string', label: 'Fund', setBy: 'prompt'}}}),
    presetSelector: () => ({
        variables: {view: {type: 'string', label: 'View'}},
        presets: {
            gridViews: {
                label: 'Views',
                controls: [{path: '/variables/view/default'}],
                items: {
                    pnl: {label: 'P&L', set: {variables: {view: {default: {value: 'pnl'}}}}},
                    risk: {label: 'Risk', set: {variables: {view: {default: {value: 'risk'}}}}}
                }
            }
        }
    })
};

// What an example names beyond itself, with a variable for each input in it to set, so the input
// draws its control.
const exampleBlueprintFor = (spec: WidgetSpec): WidgetSpec['exampleBlueprint'] => {
    const ret = EXAMPLE_BLUEPRINTS[spec.name]?.() ?? {},
        elements = {[spec.name]: spec.example, ...ret.elements},
        inputs = Object.entries(elements).filter(
            ([, el]) => WIDGET_SPECS.find(it => it.name === el?.component)?.value
        );
    if (!inputs.length) return ret.elements || ret.variables || ret.presets ? ret : null;
    return {
        ...ret,
        variables: {
            ...Object.fromEntries(
                inputs.map(([id, el]) => [
                    `${id}Value`,
                    {
                        type: castArray(
                            WIDGET_SPECS.find(it => it.name === el.component).value.type
                        )[0],
                        setBy: {element: id}
                    }
                ])
            ),
            ...ret.variables
        }
    };
};

// The kit glyph that pictures each built-in. See `widgetPreview`.
// Where each widget belongs, and the line its guidance gains for a toolbar.
const FITS: Record<string, WidgetFit[]> = {
    ...Object.fromEntries(
        [
            'select',
            'dateInput',
            'dateRangePicker',
            'numberInput',
            'textInput',
            'switchInput',
            'slider',
            'variableInput',
            'filterChooser',
            'groupingChooser',
            'buttonGroupInput',
            'presetSelector'
        ].map(it => [it, ['toolbar']])
    ),
    ...Object.fromEntries(['cubeGrid', 'chart', 'heatmap', 'treemap'].map(it => [it, ['content']]))
};

const TOOLBAR_GUIDANCE =
    "Goes in the toolbar of the widget it drives (its view's header items or its panel's tbar), or the root's tbar when it drives several.";

const PREVIEWS: Record<string, string> = {
    dashboard: 'dashboard',
    panes: 'dashboard',
    tabContainer: 'tabs',
    panel: 'panel',
    box: 'box',
    separator: 'separator',
    spacer: 'spacer',
    markdown: 'text',
    callout: 'callout',
    toolbar: 'toolbar',
    select: 'input',
    dateInput: 'input',
    dateRangePicker: 'input',
    numberInput: 'input',
    textInput: 'input',
    switchInput: 'switch',
    variableInput: 'input',
    slider: 'slider',
    filterChooser: 'input',
    groupingChooser: 'input',
    cubeGrid: 'grid',
    chart: 'chart',
    propertyTable: 'table',
    heatmap: 'heatmap',
    treemap: 'treemap',
    statCard: 'stat',
    gauge: 'gauge',
    tileFrame: 'tiles',
    buttonGroup: 'buttons',
    buttonGroupInput: 'buttons',
    presetSelector: 'buttons'
};

export const BUILT_IN_WIDGETS: WidgetSpec[] = WIDGET_SPECS.map(it => {
    const exampleBlueprint = it.example ? exampleBlueprintFor(it) : null;
    const fits = FITS[it.name];
    return {
        ...it,
        ...(fits ? {fits} : {}),
        ...(fits?.includes('toolbar') ? {guidance: `${it.guidance} ${TOOLBAR_GUIDANCE}`} : {}),
        ...(PREVIEWS[it.name] ? {preview: PREVIEWS[it.name]} : {}),
        ...(exampleBlueprint ? {exampleBlueprint} : {}),
        ...(DEMANDS[it.name] ? {demand: DEMANDS[it.name]} : {}),
        ...(VALIDATORS[it.name] ? {validate: VALIDATORS[it.name]} : {})
    };
});

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
            targetField: 'a field of the row whose value marks the goal',
            intent: 'primary, success, warning or danger, the color of the fill. Default primary'
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
