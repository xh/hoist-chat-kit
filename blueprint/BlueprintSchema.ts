import type {ExtendedJSONSchema} from 'json-schema-to-ts';

/**
 * Annotations a widget's config schema can carry, which the validator reads and JSON Schema
 * ignores. `x-binding` marks a value that accepts `{"$var": name}`, `x-source` a source name,
 * `x-field` a field of the widget's source, and `x-filter`, `x-format`, `x-renderer` and `x-action`
 * a value of that form. `x-template` marks text whose `{variable}` and `{source.field}` references
 * the validator checks, and that a widget fills - see `parseTemplate()`. `x-template: 'variables'`
 * marks a title that reads variables only, which `resolvedConfig` fills as plain text. `x-starter: false` leaves
 * an optional property out of the config a new widget starts with. On an action's param, `x-variable` marks the name of a variable the action
 * may set, which is never a binding.
 */
export type BlueprintSchemaExtension = {
    'x-binding'?: boolean;
    'x-source'?: boolean;
    'x-field'?: 'any' | 'dimension' | 'measure';
    'x-filter'?: boolean;
    'x-format'?: boolean;
    'x-renderer'?: boolean;
    'x-action'?: boolean;
    'x-variable'?: boolean;
    /** Names a stored blueprint of the same type, which design mode picks from its repository. */
    'x-blueprint'?: boolean;
    /** Names a preset group of the blueprint, which the validator checks. */
    'x-preset'?: boolean;
    'x-template'?: boolean | 'variables';
    'x-starter'?: false;
    /** Names a Font Awesome icon, which design mode picks from a list of icons. */
    'x-icon'?: boolean;
    /** The unit a number is in, such as `px`, which an editor shows beside it. */
    'x-unit'?: string;
    /**
     * On a list of fields, the sibling map keyed by field whose entries hold more settings for each
     * item, which design mode edits with the item, `show` first.
     */
    'x-settings'?: {in: string; show?: string[]};
    /**
     * On an enum, a kit thumbnail for each option, by its value, such as `{line: 'chart.line'}`,
     * which design mode shows as a card per option. See `thumbnailPreview`.
     */
    'x-thumbnails'?: Record<string, string>;
};

/**
 * A widget config schema: the JSON Schema subset `SchemaUtils` checks, with the Blueprints
 * annotations. Write a built-in schema `as const satisfies BlueprintSchema`, so its config type can
 * come from `FromExtendedSchema`.
 */
export type BlueprintSchema = ExtendedJSONSchema<BlueprintSchemaExtension>;
