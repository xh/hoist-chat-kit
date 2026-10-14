/** Options shared by the factories of the built-in generative UI components. */
export interface ChatUiSpecOptions {
    /**
     * Name of the component in its catalog. The model shows it by calling the tool
     * `show_<name>`. Defaults to the component's own name - `grid`, `chart`, `metrics` or `card`.
     */
    name?: string;

    /**
     * What the component shows and when to use it, for the model. Replaces the default
     * description - describe the app's data here, so the model knows when the component fits.
     */
    description?: string;
}

/**
 * How a number displays:
 *
 *  - `number` - with thousands separators, and decimals to suit the value unless set.
 *  - `percent` - a fraction shown as a percentage: 0.125 displays as 12.5%.
 *  - `currency` - with a `$` prefix, and two decimals unless set.
 *  - `none` - as is, with no separators - for years, ids and codes.
 */
export type ChatUiNumberFormat = 'number' | 'percent' | 'currency' | 'none';

/** Hoist intents that a component can use to color a value or a tile. */
export type ChatUiIntent = 'none' | 'primary' | 'success' | 'warning' | 'danger';
