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
    /**
     * A Hoist sort over the widget's source fields: a sorter such as `pnl|desc|abs`, or a list of
     * them. Design mode edits it as keys, each a field and a direction.
     */
    'x-sort'?: boolean;
    /**
     * What an unset value means, where that is known but is no value of the property, such as
     * `No limit` or `The app's sizing mode`. Design mode shows it in place of a default.
     */
    'x-unset'?: string;
    /**
     * On a boolean, the label of each value, the positive state first, such as
     * `{false: 'Show', true: 'Hide'}` for a `hidden` titled "Visible". Design mode shows one segment
     * per value, in this order. Without it, On then Off. On a choice, the label of any option by its
     * value, such as `{false: 'Free'}`.
     */
    'x-labels'?: Record<string, string>;
    /**
     * The section that shows a property in design mode: on a widget property, one of
     * {@link SETTING_GROUPS}, and on a list item's property, the ID of one of the item's `x-groups`.
     */
    'x-group'?: SettingGroup | (string & {});
    /**
     * On a widget property, true for a setting most widgets leave unset. Design mode folds it
     * behind its section's "N more" row while unset, and the Architect sets it only when asked.
     */
    'x-advanced'?: boolean;
    /** On a list item, the sections of its settings, in order, each holding its `x-group`. */
    'x-groups'?: {id: string; label: string; collapsed?: boolean}[];
    /**
     * On a list item, the settings its row shows when opened, in place of all of them. A key may name
     * a setting of the list's `x-settings` partner, as a grid column's `width` sits in `columnState`.
     */
    'x-common'?: string[];
    /** On a list item, the settings whose values its row shows as chips. */
    'x-summary'?: string[];
    /**
     * On a list item, true to give it a page of its own, or false never to. By default an item with
     * more than six settings, or a list inside, gets one.
     */
    'x-page'?: boolean;
};

/**
 * The sections of a widget's settings, in the order design mode shows them: what it shows, its
 * one list (columns, fields, buttons), the words the reader sees, how it looks, what it does, and
 * its place in its parent.
 */
export const SETTING_GROUPS = [
    'data',
    'list',
    'content',
    'appearance',
    'behavior',
    'layout'
] as const;

export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * A widget config schema: the JSON Schema subset `SchemaUtils` checks, with the Blueprints
 * annotations. Write a built-in schema `as const satisfies BlueprintSchema`, so its config type can
 * come from `FromExtendedSchema`.
 */
export type BlueprintSchema = ExtendedJSONSchema<BlueprintSchemaExtension>;
