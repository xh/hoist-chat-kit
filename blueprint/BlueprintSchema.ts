import type {ExtendedJSONSchema} from 'json-schema-to-ts';

/**
 * Annotations a widget's config schema can carry, which the validator reads and JSON Schema
 * ignores. `x-binding` marks a value that accepts `{"$var": name}`, `x-source` a source name,
 * `x-field` a field of the widget's source, and `x-filter`, `x-format`, `x-renderer` and `x-action`
 * a value of that form.
 */
export type BlueprintSchemaExtension = {
    'x-binding'?: boolean;
    'x-source'?: boolean;
    'x-field'?: 'any' | 'dimension' | 'measure';
    'x-filter'?: boolean;
    'x-format'?: boolean;
    'x-renderer'?: boolean;
    'x-action'?: boolean;
};

/**
 * A widget config schema: the JSON Schema subset `SchemaUtils` checks, with the Blueprints
 * annotations. Write a built-in schema `as const satisfies BlueprintSchema`, so its config type can
 * come from `FromExtendedSchema`.
 */
export type BlueprintSchema = ExtendedJSONSchema<BlueprintSchemaExtension>;
