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

/** App-wide settings of the result table - see `ChatUiGrid.defaults`. */
export interface ChatUiGridDefaults {
    /** Most rows the inline preview shows. Default 8. */
    previewRows: number;

    /**
     * Most columns the inline preview shows. It shows fewer where they do not fit at 110 px each,
     * and 3 at compact density. The first column always shows. Default 6.
     */
    previewColumns: number;

    /** Rows the full grid loads per page, and the first page a table by reference loads. Default 1,000. */
    pageSize: number;

    /** Rows above which an export asks the user to confirm before it loads them all. Default 10,000. */
    exportConfirmAbove: number;
}

/** App-wide settings of the chart - see `ChatUiChart.defaults`. */
export interface ChatUiChartDefaults {
    /** Most series an inline chart draws. The expanded chart draws them all. Default 5. */
    maxInlineSeries: number;

    /**
     * Most points per series an inline chart draws. A longer series is sampled down, and the
     * expanded chart draws it in full. Default 500.
     */
    maxInlinePoints: number;
}
