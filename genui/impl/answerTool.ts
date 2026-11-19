import type {PlainObject} from '@xh/hoist/core';
import {isArray, isPlainObject, isString} from 'lodash';
import type {Blueprint, BlueprintIssue, BlueprintRegistry} from '../../blueprint';
import type {ChatToolSpec} from '../../core';
// From its own module, not the barrel, so the Node harness can load this file.
import {validateBlueprint, type ValidateBlueprintContext} from '../../blueprint/validateBlueprint';

/**
 * The input schema of `show_ui` for answer blueprints. An element's config stays an open object:
 * each widget's schema is too large to inline for every widget, so the checks and
 * `describe_registry` carry it instead.
 */
export function answerBlueprintSchema(registry: BlueprintRegistry): PlainObject {
    return {
        type: 'object',
        required: ['root', 'elements'],
        properties: {
            sources: {
                type: 'object',
                description:
                    'Data by name: {"inline": {"fields": [...], "rows": [...]}}, {"artifact": id} for ' +
                    'a result a tool produced, or {"dataset": name, "params": {...}}.'
            },
            variables: {type: 'object', description: 'Values that widgets share, by name.'},
            root: {type: 'string', description: 'The id of the top element.'},
            elements: {
                type: 'object',
                description: 'Each element by id.',
                additionalProperties: {
                    type: 'object',
                    required: ['component'],
                    properties: {
                        component: {enum: widgetNames(registry)},
                        config: {type: 'object'},
                        children: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['id'],
                                properties: {id: {type: 'string'}}
                            }
                        }
                    }
                }
            }
        }
    };
}

/** The description of `show_ui` for answer blueprints, from the registry's widgets. */
export function answerToolDescription(registry: BlueprintRegistry): string {
    const {widgets} = registry;
    return [
        'Show UI in your reply: one answer blueprint. Widgets that interact go in one answer.',
        '',
        '`elements` holds each element by id: its `component`, its `config`, and for a container ' +
            'its `children`, as `{"id": ...}` references. `root` is the id of the top element, and ' +
            'every other element is the child of exactly one container.',
        '',
        'A widget that shows data names a source in `config.source`. A source holds rows inline, ' +
            'reads a result a tool produced as `{"artifact": id}`, or reads a dataset. Values you ' +
            'computed go inline. Never copy the rows of an artifact.',
        '',
        'Widgets:',
        ...widgetNames(registry).map(
            it => `- ${it}: ${widgets[it].label}. ${widgets[it].guidance}${configKeys(widgets[it])}`
        )
    ].join('\n');
}

/**
 * Whether a complete answer shows, and the issues the model gets back. An answer with any error
 * shows nothing, and the model is asked to fix it. This is the one place that decides it.
 *
 * @param ctx - with `getTool`, the chat's client tool of a name, so that an answer cannot call a
 *      tool that only the model may call.
 */
export function checkAnswer(
    input: unknown,
    ctx: ValidateBlueprintContext & {getTool?: (name: string) => ChatToolSpec}
): {isShown: boolean; issues: BlueprintIssue[]} {
    const {getTool, ...rest} = ctx,
        issues = [
            ...validateBlueprint(input as Blueprint, {
                ...rest,
                isAnswer: true,
                allowReserved: false
            }),
            ...(getTool ? findModelOnlyCalls(input, getTool) : [])
        ];
    return {isShown: !issues.some(it => it.severity === 'error'), issues};
}

/** Why a UI action cannot call this tool, or null if it can. */
export function refuseActionCall(tool: ChatToolSpec, name: string): string {
    return tool?.allowActions === false
        ? `Tool '${name}' runs only when the model calls it.`
        : null;
}

/**
 * True for input written as a catalog document, with `props` on its elements, as a reply stored
 * before answers were blueprints holds it.
 */
export function isDocumentShape(input: unknown): boolean {
    const elements = (input as PlainObject)?.elements;
    return (
        isPlainObject(elements) &&
        Object.values(elements).some(it => isPlainObject(it) && 'props' in (it as PlainObject))
    );
}

//------------------
// Implementation
//------------------
function findModelOnlyCalls(
    value: unknown,
    getTool: (name: string) => ChatToolSpec,
    path = ''
): BlueprintIssue[] {
    if (isArray(value))
        return value.flatMap((it, i) => findModelOnlyCalls(it, getTool, `${path}/${i}`));
    if (!isPlainObject(value)) return [];
    const v = value as PlainObject,
        refused =
            v.type === 'callTool' && isString(v.name)
                ? refuseActionCall(getTool(v.name), v.name)
                : null,
        own: BlueprintIssue[] = refused
            ? [{code: 'action.modelOnlyTool', severity: 'error', path, message: refused}]
            : [];
    return [
        ...own,
        ...Object.entries(v).flatMap(([k, it]) => findModelOnlyCalls(it, getTool, `${path}/${k}`))
    ];
}

// Models misname the keys of a small config. A larger schema is for describe_registry.
function configKeys(widget: {config?: PlainObject}): string {
    const keys = Object.keys(widget.config?.properties ?? {}),
        required: string[] = widget.config?.required ?? [];
    if (!keys.length || keys.length > MAX_LISTED_KEYS) return '';
    const listed = keys.map(it => {
        const values: unknown[] = widget.config.properties[it]?.enum,
            named = values?.length <= MAX_LISTED_VALUES ? `${it} (${values.join(', ')})` : it;
        return required.includes(it) ? `${named} (required)` : named;
    });
    return ` Config: ${listed.join(', ')}.`;
}

const MAX_LISTED_KEYS = 8,
    MAX_LISTED_VALUES = 6;

function widgetNames(registry: BlueprintRegistry): string[] {
    return Object.keys(registry.widgets).filter(it => !registry.widgets[it].reserved);
}
