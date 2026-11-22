import {HoistBase, hoistCmp, type PlainObject, uses} from '@xh/hoist/core';
import {action, observableRef} from '@xh/hoist/mobx';
import {throwIf} from '@xh/hoist/utils/js';
import {isEmpty, isEqual, lowerFirst, omit, startCase, upperFirst, without} from 'lodash';
import type {ReactNode} from 'react';
import {
    type ActionSpec,
    type Blueprint,
    type BlueprintDataProvider,
    type BlueprintIssue,
    BlueprintRegistry,
    BlueprintWidgetModel,
    type ChildRef,
    type DataCatalog,
    type WidgetSpec
} from '../../blueprint';
import {
    CHAT_UI_ACTION_TYPES,
    type ChatUiAction,
    chatUiActionSchema,
    describeChatUiAction
} from '../ChatUiAction';
import type {ChatArtifactRegistry} from '../ChatArtifactRegistry';
import type {ChatUiCatalog} from '../ChatUiCatalog';
import type {ChatUiComponentSpec, ChatUiDocumentContext} from '../ChatUiComponentSpec';
import type {ChatUiNode} from '../ChatUiDocument';
import {getOwn} from '../../impl/LangUtils';
import {refuseActionCall} from './answerTool';
import type {ChatUiBoundProps} from './answerBlueprint';

/**
 * The widget name of a catalog component in an answer: its own name, or `chatUi<Name>` where a
 * blueprint built-in already has it, as `chart` does.
 */
export function toWidgetName(component: string): string {
    return BUILT_IN_WIDGET_NAMES.includes(component) ? `chatUi${upperFirst(component)}` : component;
}

/** The component name of a widget in an answer, undoing {@link toWidgetName}. */
export function fromWidgetName(widget: string): string {
    const name = /^chatUi[A-Z]/.test(widget) ? lowerFirst(widget.slice(6)) : null;
    return name && BUILT_IN_WIDGET_NAMES.includes(name) ? name : widget;
}

/** What the catalog passes to the platform's renderer of an answer blueprint. */
export interface ChatUiAnswerRenderProps {
    blueprint: Blueprint;
    catalog: ChatUiCatalog;
    /** The datasets the answer's sources may read. */
    dataCatalog: DataCatalog;
    /** The dataset behind each artifact the answer reads, by artifact id. */
    artifacts: Record<string, string>;
    /** The chat's artifacts, which the answer's artifact sources read. */
    artifactRegistry: ChatArtifactRegistry;
    /** The app's provider of datasets, or null. The answer loads through it within the chat's bounds. */
    dataProvider: BlueprintDataProvider;
    context: ChatUiDocumentContext;
    /** Elements still arriving: all those of a streaming answer that its format did not mark complete. */
    partialIds: string[];
    /** Elements a format says it is still writing, as OpenUI Lang marks each element. */
    writingIds: string[];
    /** The bound props of the document's elements, by answer ID, which a program's state holds. */
    bindings: Record<string, ChatUiBoundProps>;
}

/**
 * The answer model's `hostContext`: where the answer shows, kept current as the reply streams,
 * so that bridged widgets render again when it changes.
 */
export class ChatUiAnswerHostContext extends HoistBase {
    @observableRef accessor context: ChatUiDocumentContext;
    @observableRef accessor partialIds: string[] = [];
    @observableRef accessor writingIds: string[] = [];
    @observableRef accessor bindings: Record<string, ChatUiBoundProps> = {};

    constructor(context: ChatUiDocumentContext) {
        super();
        this.context = context;
    }

    @action
    update(
        context: ChatUiDocumentContext,
        partialIds: string[],
        writingIds: string[],
        bindings: Record<string, ChatUiBoundProps> = {}
    ) {
        this.context = context;
        if (!isEqual(partialIds, this.partialIds)) this.partialIds = partialIds;
        if (!isEqual(writingIds, this.writingIds)) this.writingIds = writingIds;
        this.bindings = bindings;
    }

    /** True while an element may be incomplete, as chat kit renders a streaming document. */
    isPartial(id: string): boolean {
        return this.partialIds.includes(id);
    }
}

/**
 * Props a component takes per child, which an answer holds on each child's reference, as a
 * `tabContainer` holds a tab's title. A host then reads them as its own.
 */
export const CHILD_REF_PROPS: Record<string, {prop: string; key: string}> = {
    tabs: {prop: 'titles', key: 'title'}
};

/** The values a component takes per child, from its child references, in order. */
export function toPerChild(refs: PlainObject[], key: string): unknown[] {
    return (refs ?? []).map(it => it?.[key]);
}

// A component's slots other than its default one, each a slot list of its widget.
function namedSlots(spec: ChatUiComponentSpec): string[] {
    return (spec.slots ?? []).filter(it => it !== 'default');
}

/**
 * A catalog component as a blueprint widget. Its props are the widget's config, its slots take
 * child references, and it renders through the catalog as it always has. An input whose element
 * sets a variable shows and writes that variable's value.
 */
export function toWidgetSpec(spec: ChatUiComponentSpec, catalog: ChatUiCatalog): WidgetSpec {
    const info = WIDGET_INFO[spec.name] ?? deriveInfo(spec),
        name = toWidgetName(spec.name),
        perChild = getOwn(CHILD_REF_PROPS, spec.name),
        config = perChild ? withoutProp(spec.props, perChild.prop) : spec.props;
    return {
        name,
        version: 1,
        guidance: [spec.description, getOwn(EXTRA_GUIDANCE, spec.name)].filter(Boolean).join(' '),
        config,
        ...info,
        // An answer holds the dashboard widget a kit component translates into, never its bridge.
        ...(TRANSLATED_COMPONENTS.includes(spec.kitComponent) ? {reserved: true} : {}),
        ...(spec.example ? {example: toExample(name, spec.example, perChild)} : {}),
        ...(spec.slots?.length
            ? {
                  children: {
                      schema: {
                          type: 'object',
                          required: ['id'],
                          properties: {
                              id: {type: 'string'},
                              ...(perChild
                                  ? {[perChild.key]: spec.props.properties[perChild.prop].items}
                                  : {})
                          }
                      }
                  },
                  ...(namedSlots(spec).length
                      ? {
                            slots: Object.fromEntries(
                                namedSlots(spec).map(slot => [
                                    slot,
                                    {description: `What the ${info.label}'s ${slot} slot holds.`}
                                ])
                            )
                        }
                      : {})
              }
            : {}),
        ...(spec.validate
            ? {
                  validate: config =>
                      spec.validate(config).map((message): BlueprintIssue => ({
                          code: 'schema.invalid',
                          severity: 'error',
                          path: '',
                          message
                      }))
              }
            : {}),
        rendersPartial: true,
        model: BlueprintWidgetModel,
        component: specWidget(spec, catalog)
    };
}

/**
 * The reserved `placeholder` and `fallback` widgets, drawn with the catalog's own renderers, so
 * that an answer's stand-ins look as a document's always have.
 */
export function toStandInWidgetSpecs(catalog: ChatUiCatalog): WidgetSpec[] {
    const {widgets} = new BlueprintRegistry();
    return [widgets.placeholder, widgets.fallback].map(spec => ({
        ...spec,
        component: hoistCmp.factory({
            displayName: 'ChatUiStandInWidget',
            model: uses(BlueprintWidgetModel),
            render({model}) {
                const host = model.blueprintModel.hostContext as ChatUiAnswerHostContext;
                return model.element && host
                    ? catalog.renderStandIn(model.element, host.context, model.id)
                    : null;
            }
        })
    }));
}

/**
 * Chat kit's action types, as blueprint actions: each checks its fields as the catalog does, and
 * runs through the catalog, within its caps. `openUrl` and `navigate` take the place of the
 * blueprint built-ins, so an answer follows the catalog's own allow list.
 */
export function toActionSpecs(catalog: ChatUiCatalog): ActionSpec[] {
    return CHAT_UI_ACTION_TYPES.map(type => {
        const {required, properties} = chatUiActionSchema({types: [type]});
        return {
            name: type,
            params: {
                type: 'object',
                required: without(required, 'type'),
                additionalProperties: false,
                properties: omit(properties, 'type', 'confirm')
            },
            describe: params => describeChatUiAction({type, ...params} as ChatUiAction),
            // Refused before the runner asks the user to confirm.
            check: (params, {blueprintModel}) => {
                if (type !== 'send' && type !== 'callTool') return null;
                const chatModel = (blueprintModel.hostContext as ChatUiAnswerHostContext)?.context
                    .chatModel;
                // As ChatUiCard does, a message waits while the chat is busy or blocked.
                if (chatModel?.isBusy) return 'The chat is busy.';
                if (chatModel?.sendBlockedReason) return chatModel.sendBlockedReason;
                return type === 'callTool'
                    ? refuseActionCall(chatModel?.getToolSpec(params.name), params.name)
                    : null;
            },
            run: (params, {blueprintModel}) => {
                const host = blueprintModel.hostContext as ChatUiAnswerHostContext;
                throwIf(!host, `A '${type}' action runs only in a chat answer.`);
                return catalog.runActionAsync({type, ...params} as ChatUiAction, host.context);
            }
        };
    });
}

//------------------
// Implementation
//------------------
const BUILT_IN_WIDGET_NAMES = Object.keys(new BlueprintRegistry().widgets);

type WidgetInfo = Pick<WidgetSpec, 'label' | 'terms' | 'category' | 'size' | 'value'>;

/**
 * The kit's components that an answer translates into dashboard widgets, whose bridges only the
 * kit places - see `toAnswerBlueprint()`.
 */
export const TRANSLATED_COMPONENTS = [
    'text',
    'callout',
    'section',
    'stack',
    'card',
    'propertyTable',
    'progressBars'
];

const size = (w: number, h: number) => ({default: {w, h}}),
    input = (
        label: string,
        terms: string[],
        type: string | string[],
        w = 4,
        h = 1
    ): WidgetInfo => ({
        label,
        terms,
        category: 'input',
        value: {type},
        size: size(w, h)
    });

// The bridge's own guidance for the Architect, after a spec's description.
const EXTRA_GUIDANCE: Record<string, string> = {
    tabs: 'Keep tab titles to one or two words. Use the label a person would say, not a raw value.'
};

const WIDGET_INFO: Record<string, WidgetInfo> = {
    text: {
        label: 'Text',
        terms: ['text', 'paragraph', 'note'],
        category: 'data',
        size: size(12, 2)
    },
    callout: {
        label: 'Callout',
        terms: ['callout', 'alert', 'warning', 'note'],
        category: 'data',
        size: size(12, 2)
    },
    separator: {
        label: 'Separator',
        terms: ['separator', 'divider', 'rule'],
        category: 'data',
        size: size(12, 1)
    },
    badges: {
        label: 'Badges',
        terms: ['badges', 'tags', 'labels'],
        category: 'data',
        size: size(6, 1)
    },
    card: {label: 'Card', terms: ['card', 'panel', 'summary'], category: 'data', size: size(6, 4)},
    grid: {label: 'Grid', terms: ['grid', 'table', 'rows'], category: 'data', size: size(12, 6)},
    chart: {
        label: 'Chart',
        terms: ['chart', 'graph', 'plot', 'trend'],
        category: 'data',
        size: size(6, 6)
    },
    statCards: {
        label: 'Stat Cards',
        terms: ['stat cards', 'kpis', 'figures', 'metrics'],
        category: 'data',
        size: size(12, 2)
    },
    treemap: {
        label: 'Tree Map',
        terms: ['treemap', 'tree map', 'heat map'],
        category: 'data',
        size: size(6, 6)
    },
    section: {
        label: 'Section',
        terms: ['section', 'group', 'panel'],
        category: 'container',
        size: size(12, 6)
    },
    stack: {
        label: 'Stack',
        terms: ['stack', 'row', 'column', 'layout'],
        category: 'container',
        size: size(12, 6)
    },
    tabs: {label: 'Tabs', terms: ['tabs', 'tabbed'], category: 'container', size: size(12, 6)},
    form: {label: 'Form', terms: ['form', 'fields'], category: 'container', size: size(6, 6)},
    button: {label: 'Button', terms: ['button', 'action'], category: 'action', size: size(2, 1)},
    textInput: input('Text Input', ['text input', 'text field'], 'string'),
    textArea: input('Text Area', ['text area', 'notes', 'comment'], 'string', 6, 2),
    numberInput: input('Number Input', ['number input', 'quantity', 'amount'], 'number'),
    dateInput: input('Date Input', ['date input', 'date picker'], 'localDate'),
    select: input('Select', ['select', 'dropdown', 'choice'], 'string'),
    checkbox: input('Checkbox', ['checkbox', 'yes no'], 'bool', 2),
    switch: input('Switch', ['switch', 'toggle', 'on off'], 'bool', 2),
    segmentedControl: input('Segmented Control', ['segmented control', 'toggle'], 'string'),
    radioInput: input('Radio Input', ['radio', 'choice', 'option'], 'string'),
    slider: input('Slider', ['slider', 'range'], ['number', 'number[]']),
    propertyTable: {
        label: 'Property Table',
        terms: ['property table', 'fields', 'details'],
        category: 'data',
        size: size(6, 4)
    },
    progressBars: {
        label: 'Progress Bars',
        terms: ['progress', 'usage', 'limit'],
        category: 'data',
        size: size(6, 3)
    }
};

function deriveInfo(spec: ChatUiComponentSpec): WidgetInfo {
    const label = startCase(spec.name);
    if (spec.slots?.length) {
        return {label, terms: [spec.name], category: 'container', size: size(12, 6)};
    }
    if (spec.stateProps?.includes('value')) return input(label, [spec.name], 'string');
    return {label, terms: [spec.name], category: 'data', size: size(6, 4)};
}

function specWidget(spec: ChatUiComponentSpec, catalog: ChatUiCatalog) {
    return hoistCmp.factory({
        displayName: 'ChatUiSpecWidget',
        model: uses(BlueprintWidgetModel),
        render({model}) {
            const {element, id} = model,
                host = model.blueprintModel.hostContext as ChatUiAnswerHostContext;
            if (!element || !host) return null;

            const refs: ChildRef[] = element.children ?? [],
                childIds = refs.map(it => it.id),
                slotIds: Record<string, string[]> = Object.fromEntries(
                    namedSlots(spec)
                        .map(slot => [slot, model.slotRefs(slot).map(it => it.id)])
                        .filter(([, list]) => list.length)
                );

            const perChild = getOwn(CHILD_REF_PROPS, spec.name),
                props: PlainObject = {
                    ...model.resolvedConfig,
                    ...(perChild ? {[perChild.prop]: toPerChild(refs, perChild.key)} : {})
                },
                node: ChatUiNode = {
                    id,
                    component: spec.name,
                    props,
                    ...(childIds.length ? {children: childIds} : {}),
                    ...(isEmpty(slotIds) ? {} : {slots: slotIds}),
                    ...(host.isPartial(id) && host.writingIds.includes(id) ? {isPartial: true} : {})
                };
            // A program's bound props write to its state, and its resolve gives their values.
            const bound = host.bindings[id];
            if (bound) {
                Object.assign(props, bound.values);
                node.bindings = bound.bindings;
            } else if (model.valueVariable) {
                props.value = model.value;
                node.bindings = {value: {set: value => model.setValue(value)}};
            }

            const render = (ids: string[]): ReactNode[] => ids.map(it => model.renderElement(it)),
                context = {...host.context, isPartial: host.isPartial(id)};
            return catalog.renderAnswerComponent(spec, node, context, {
                children: render(childIds),
                slots: Object.fromEntries(
                    Object.entries(slotIds).map(([name, ids]) => [name, render(ids)])
                )
            });
        }
    });
}

// A per-child prop of the example moves onto child references, as an answer holds it.
function toExample(name: string, example: PlainObject, perChild: {prop: string; key: string}) {
    const values = perChild ? example[perChild.prop] : null;
    if (!Array.isArray(values)) return {component: name, config: example};
    return {
        component: name,
        config: omit(example, perChild.prop),
        children: values.map((it, idx) => ({id: `child${idx + 1}`, [perChild.key]: it}))
    };
}

function withoutProp(schema: PlainObject, prop: string): PlainObject {
    return {
        ...schema,
        properties: omit(schema.properties, prop),
        ...(schema.required ? {required: without(schema.required, prop)} : {})
    };
}
