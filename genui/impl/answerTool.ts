import type {PlainObject} from '@xh/hoist/core';
import {isPlainObject} from 'lodash';
import {
    type Blueprint,
    type BlueprintIssue,
    type BlueprintRegistry,
    validateBlueprint,
    type ValidateBlueprintContext
} from '../../blueprint';

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
        ...widgetNames(registry).map(it => `- ${it}: ${widgets[it].label}. ${widgets[it].guidance}`)
    ].join('\n');
}

/**
 * Whether a complete answer shows, and the issues the model gets back. An answer with any error
 * shows nothing, and the model is asked to fix it. This is the one place that decides it.
 */
export function checkAnswer(
    input: unknown,
    ctx: ValidateBlueprintContext
): {isShown: boolean; issues: BlueprintIssue[]} {
    const issues = validateBlueprint(input as Blueprint, {
        ...ctx,
        isAnswer: true,
        allowReserved: false
    });
    return {isShown: !issues.some(it => it.severity === 'error'), issues};
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
function widgetNames(registry: BlueprintRegistry): string[] {
    return Object.keys(registry.widgets).filter(it => !registry.widgets[it].reserved);
}
