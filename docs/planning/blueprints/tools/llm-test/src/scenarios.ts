import {Blueprint, loadBlueprint} from './load.ts';

export interface Step {
    prompt: string;
}

export interface Outcome {
    blueprint: Blueprint;
    segments: Blueprint[];
    replies: string[];
    /** The tools the model called, in order. */
    calls: string[];
}

const OFFERS_PROMPT = /\b(prompts?|pickers?|inputs?|let (users|you|them) (choose|change|pick|switch))\b/i;

export interface Scenario {
    id: string;
    title: string;
    host?: string;
    /** The user's mode as the run starts. Default design. */
    mode?: 'run' | 'design';
    context: string;
    steps: Step[];
    checks: [string, (o: Outcome) => unknown][];
}

const els = (bp: Blueprint, component?: string) => Object.entries<any>(bp.elements ?? {}).filter(([, e]) => !component || e.component === component);
const cfg = (bp: Blueprint, component: string, pred: (c: any) => unknown = () => true) => els(bp, component).map(([, e]) => e.config ?? {}).filter(pred);
const vars = (bp: Blueprint, pred: (v: any) => unknown) => Object.entries<any>(bp.variables ?? {}).filter(([, v]) => pred(v));
const src = (bp: Blueprint, name: string) => bp.sources?.[name] ?? {};
const fieldsOf = (cols: any[] = []) => cols.map(c => (typeof c === 'string' ? c : c?.field));
const has = (a: unknown[] = [], ...want: string[]) => want.every(w => a.includes(w));
const bound = (v: any, name?: string) => v?.$var && (!name || v.$var === name);
const filterVarFrom = (bp: Blueprint, gridId: string) => vars(bp, v => v.type === 'filter' && [v.setBy].flat().some((w: any) => w?.element === gridId && w?.output === 'selection')).map(([n]) => n);
const gridId = (bp: Blueprint, pred: (c: any) => unknown) => els(bp, 'cubeGrid').find(([, e]) => pred(e.config ?? {}))?.[0];
const dataset = (bp: Blueprint, c: any) => src(bp, c.source).dataset;
const segmentWidgets = (bp: Blueprint, component: string) => els(bp, component).map(([, e]) => e);
/** Asked for design mode, and edited only after. */
const askedFirst = (o: Outcome) => {
    const ask = o.calls.indexOf('request_design_mode'), edit = o.calls.indexOf('edit_blueprint');
    return ask >= 0 && edit > ask;
};
/** Every format the blueprint gives mktVal: in a grid's columns, on a source, or in a column's state as older runs wrote it. */
const mktValFormats = (bp: Blueprint): any[] => [
    ...cfg(bp, 'cubeGrid').map(c => c.columns?.mktVal?.format),
    ...Object.values<any>(bp.sources ?? {}).map(s => s.fields?.mktVal?.format),
    ...cfg(bp, 'cubeGrid').flatMap(c => [c.columnState].flat().filter((it: any) => it?.field === 'mktVal').map((it: any) => it.format))
];
const noChatSources = (bp: Blueprint) => !Object.values<any>(bp.sources ?? {}).some(s => s.artifact || s.inline);

/** Replace each {"$var": name} with that variable's default value. */
const resolveVars = (bp: Blueprint, o: any): any =>
    Array.isArray(o) ? o.map(v => resolveVars(bp, v)) : o?.$var ? bp.variables?.[o.$var]?.default?.value : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolveVars(bp, v)])) : o;
/** A filter that names Technology, directly or through variables. */
const techFilter = (bp: Blueprint, c: any) => JSON.stringify(resolveVars(bp, c.filter ?? {}) ?? {}).includes('Technology');

const BUILD = 'Mode: design. The user has write access. Build a new blueprint: it starts empty, at version 0.';

export const SCENARIOS: Scenario[] = [
    {
        id: 'P1',
        title: 'One grid',
        context: BUILD,
        steps: [{prompt: 'Show me my positions grouped by sector.'}],
        checks: [
            ['a cubeGrid over positions', o => cfg(o.blueprint, 'cubeGrid', c => dataset(o.blueprint, c) === 'positions').length],
            ['grouped by sector first', o => cfg(o.blueprint, 'cubeGrid')[0]?.groupBy?.[0] === 'sector'],
            ['shows market value and a P&L column', o => {
                const cols = fieldsOf(cfg(o.blueprint, 'cubeGrid')[0]?.columnState);
                return cols.includes('mktVal') && cols.some(c => /^pnl/.test(c));
            }],
            ['binds the required asOf parameter', o => Object.values<any>(o.blueprint.sources ?? {}).every(s => s.params?.asOf)]
        ]
    },
    {
        id: 'P2',
        title: 'A linked dashboard',
        context: BUILD,
        steps: [{
            prompt: 'Build me a P&L dashboard. Put headline numbers across the top, positions by strategy and trader below, and a chart of P&L by sector that follows whatever I select in the grid. Under the positions, show the orders for whatever I select.'
        }],
        checks: [
            ['root is a dashCanvas', o => o.blueprint.elements?.[o.blueprint.root]?.component === 'dashCanvas'],
            ['stat cards over positions, at least three', o => cfg(o.blueprint, 'statCard', c => dataset(o.blueprint, c) === 'positions').length >= 3],
            ['a grid grouped by strategy, then trader', o => gridId(o.blueprint, c => c.groupBy?.[0] === 'strategy' && c.groupBy?.[1] === 'trader')],
            ['its selection sets a filter variable', o => filterVarFrom(o.blueprint, gridId(o.blueprint, c => c.groupBy?.[0] === 'strategy')!).length],
            ['a sector chart filtered by that variable', o => {
                const [v] = filterVarFrom(o.blueprint, gridId(o.blueprint, c => c.groupBy?.[0] === 'strategy')!);
                return cfg(o.blueprint, 'chart', c => c.x === 'sector' && bound(c.filter, v)).length;
            }],
            ['an orders grid filtered by that variable', o => {
                const [v] = filterVarFrom(o.blueprint, gridId(o.blueprint, c => c.groupBy?.[0] === 'strategy')!);
                return cfg(o.blueprint, 'cubeGrid', c => dataset(o.blueprint, c) === 'orders' && bound(c.filter, v)).length;
            }],
            ['one positions source, shared', o => Object.values<any>(o.blueprint.sources ?? {}).filter(s => s.dataset === 'positions').length === 1]
        ]
    },
    {
        id: 'P3',
        title: 'A morning report with controls',
        context: BUILD,
        steps: [
            {prompt: 'Build a morning report. Let the user pick a fund and an as-of date at the top. Default the fund to their own and the date to the previous business day.'},
            {prompt: 'Add tabs for Overview, Positions and Orders.'},
            {prompt: 'On Overview, show stat cards, day P&L by sector and day P&L by region.'},
            {prompt: 'On Positions, show the position grid. Let users group it by any of fund, strategy, trader, sector or region. Give them a P&L view and a Risk view of the columns.'},
            {prompt: 'Add buttons to show winners only, losers only, or everything.'},
            {prompt: 'When a user selects a symbol, show its price history for the last three months beside the grid.'},
            {prompt: 'On Orders, show the orders for whatever is selected on the Positions tab.'},
            {prompt: 'Show every market value in full dollars, show all Greeks in thousands, and add YTD return to the Risk view.'},
            {prompt: 'Add a button that publishes this report to the PM pack.'}
        ],
        checks: [
            ['fund prompt of type toolbox.fund, defaulting to toolbox.userFund', o => vars(o.blueprint, v => v.type === 'toolbox.fund' && v.setBy === 'prompt' && v.default?.resolver === 'toolbox.userFund').length],
            ['as-of prompt defaulting to previousBusinessDay', o => vars(o.blueprint, v => v.type === 'localDate' && v.setBy === 'prompt' && v.default?.resolver === 'previousBusinessDay').length],
            ['a tabContainer with three tabs', o => els(o.blueprint, 'tabContainer').some(([, e]) => e.children?.length === 3)],
            ['a groupingChooser sets a string[] bound to a grid groupBy', o => {
                const v = vars(o.blueprint, v => v.type === 'string[]' && els(o.blueprint, 'groupingChooser').some(([id]) => v.setBy?.element === id)).map(([n]) => n)[0];
                return v && cfg(o.blueprint, 'cubeGrid', c => bound(c.groupBy, v)).length;
            }],
            ['a preset group with at least two items controls a grid column state', o => Object.values<any>(o.blueprint.presets ?? {}).some(g => Object.keys(g?.items ?? {}).length >= 2 && g?.controls?.some((c: any) => /columnState$/.test(c.path)))],
            ['buttons set a filter variable whose setBy is action', o => vars(o.blueprint, v => v.type === 'filter' && v.setBy === 'action').length && cfg(o.blueprint, 'buttonGroup').length],
            ['the selected symbol drives the prices source', o => {
                const v = vars(o.blueprint, v => v.setBy?.output === 'selected' && v.setBy?.field === 'symbol').map(([n]) => n)[0];
                return v && Object.values<any>(o.blueprint.sources ?? {}).some(s => s.dataset === 'prices' && bound(s.params?.symbol, v));
            }],
            ['an orders grid filtered by the positions selection', o => vars(o.blueprint, v => v.type === 'filter' && [v.setBy].flat().some((w: any) => w?.output === 'selection')).some(([n]) => cfg(o.blueprint, 'cubeGrid', c => dataset(o.blueprint, c) === 'orders' && bound(c.filter, n)).length)],
            ['Greeks redefined in thousands', o => o.blueprint.formats?.greek?.scale === 'thousands'],
            ['market value in full dollars, by redefining mv, per column or on the source', o => o.blueprint.formats?.mv || mktValFormats(o.blueprint).some(f => f?.precision === 0)],
            ['a return instance on the positions source', o => Object.values<any>(o.blueprint.sources ?? {}).some(s => Object.values<any>(s.fields ?? {}).some(f => f.field === 'return'))],
            ['a toolbox.publishToPmPack button', o => JSON.stringify(o.blueprint.elements).includes('"toolbox.publishToPmPack"')]
        ]
    },
    {
        id: 'P4',
        title: 'A chat answer added to a dashboard',
        host: 'p2-linked-dashboard.json',
        mode: 'run',
        context: 'Mode: run. The user has write access. A chat is open beside the host blueprint below, which the user is looking at. Its asOf is today, 2026-11-19.',
        steps: [{prompt: 'Which traders lost the most in Technology today?'}, {prompt: 'Add that chart to my dashboard.'}],
        checks: [
            ['answers with a chart segment over the query result', o => o.segments.some(s => segmentWidgets(s, 'chart').some(e => s.sources?.[e.config?.source]?.artifact))],
            ['every segment reads the query result, and there is one', o => o.segments.length >= 1 && o.segments.every(s => Object.values<any>(s.sources ?? {}).some(x => x.artifact))],
            ['the host gains a chart filtered to Technology', o => cfg(o.blueprint, 'chart', c => techFilter(o.blueprint, c)).length],
            ['the new chart reuses the host positions source', o => cfg(o.blueprint, 'chart', c => techFilter(o.blueprint, c)).every(c => c.source === 'positions')],
            ['no artifact or inline source in the host', o => noChatSources(o.blueprint)],
            ['asks for design mode before it edits', askedFirst]
        ]
    },
    {
        id: 'P5',
        title: 'A risk and stress report',
        context: BUILD,
        steps: [{
            prompt: 'Build a risk report by fund and strategy. Show VaR at 95 and 99, beta-adjusted exposure, and P&L under equity shocks of minus 10, minus 5, plus 5 and plus 10 percent. Add a tab for options with their Greeks by underlying, and a tab for bonds with duration, DV01 and yield by issuer. Then add a tab where I can build a hypothetical portfolio from tickers and weights, and run the same stress on it.'
        }],
        checks: [
            ['four shockedPnl instances on positions', o => Object.values<any>(o.blueprint.sources ?? {}).some(s => s.dataset === 'positions' && Object.values<any>(s.fields ?? {}).filter(f => f.field === 'shockedPnl').length >= 4)],
            ['a tabContainer with four tabs', o => els(o.blueprint, 'tabContainer').some(([, e]) => e.children?.length === 4)],
            ['an options grid grouped by underlying', o => cfg(o.blueprint, 'cubeGrid', c => JSON.stringify(c.filter ?? {}).includes('Option') && c.groupBy?.[0] === 'underlying').length],
            ['a bonds grid grouped by issuer', o => cfg(o.blueprint, 'cubeGrid', c => JSON.stringify(c.filter ?? {}).includes('Bond') && c.groupBy?.[0] === 'issuer').length],
            ['a toolbox.portfolioBuilder sets a toolbox.portfolio variable', o => vars(o.blueprint, v => v.type === 'toolbox.portfolio' && els(o.blueprint, 'toolbox.portfolioBuilder').some(([id]) => v.setBy?.element === id)).length],
            ['hypotheticalPortfolio binds that variable', o => Object.values<any>(o.blueprint.sources ?? {}).some(s => s.dataset === 'hypotheticalPortfolio' && s.params?.portfolio?.$var)]
        ]
    },
    {
        id: 'W1',
        title: 'Weather for one city',
        context: BUILD,
        steps: [{prompt: 'Show me the weather in London for the next few days.'}],
        checks: [
            ['London is a city variable', o => vars(o.blueprint, v => v.default?.value === 'London').length],
            ['offers to make the city a prompt, or already did', o => vars(o.blueprint, v => v.setBy === 'prompt' && v.default?.value === 'London').length || OFFERS_PROMPT.test(o.replies.at(-1) ?? '')],
            ['current and forecast sources for London', o => {
                const s = Object.values<any>(o.blueprint.sources ?? {}),
                    london = (p: any) => p === 'London' || o.blueprint.variables?.[p?.$var]?.default?.value === 'London';
                return s.some(x => x.dataset === 'currentWeather' && london(x.params?.city)) && s.some(x => x.dataset === 'weather' && london(x.params?.city));
            }],
            ['stat cards over current weather', o => cfg(o.blueprint, 'statCard', c => dataset(o.blueprint, c) === 'currentWeather').length],
            ['a chart over time', o => cfg(o.blueprint, 'chart', c => c.x === 'time').length]
        ]
    },
    {
        id: 'W2',
        title: 'Two cities side by side',
        context: BUILD,
        steps: [{
            prompt: 'Compare New York and London side by side: current conditions, temperature, precipitation and wind for the next five days. Let users switch between Fahrenheit and Celsius with a toggle. In a forecast grid, highlight any three-hour step with more than a 60 percent chance of rain.'
        }],
        checks: [
            ['two city variables', o => vars(o.blueprint, v => ['New York', 'London'].includes(v.default?.value)).length === 2],
            ['offers to make the cities prompts, or already did', o => vars(o.blueprint, v => v.setBy === 'prompt' && ['New York', 'London'].includes(v.default?.value)).length === 2 || OFFERS_PROMPT.test(o.replies.at(-1) ?? '')],
            ['sources for New York and London', o => ['New York', 'London'].every(c => Object.values<any>(o.blueprint.sources ?? {}).some(s => s.params?.city === c || o.blueprint.variables?.[s.params?.city?.$var]?.default?.value === c))],
            ['units set by a buttonGroupInput', o => vars(o.blueprint, v => els(o.blueprint, 'buttonGroupInput').some(([id]) => v.setBy?.element === id)).length],
            ['four weather sources', o => Object.values<any>(o.blueprint.sources ?? {}).filter(s => ['weather', 'currentWeather'].includes(s.dataset)).length === 4],
            ['a forecast grid per city', o => cfg(o.blueprint, 'cubeGrid', c => dataset(o.blueprint, c) === 'weather').length >= 2]
        ]
    },
    {
        id: 'W3',
        title: 'A quick answer with UI',
        host: 'w2-two-cities.json',
        context: 'Mode: design. The user has write access. A chat is open beside the host blueprint below. Today is 2026-11-18.',
        steps: [{prompt: 'Will I need an umbrella in Chicago tomorrow? When is rain most likely?'}],
        checks: [
            ['a chart of the chance of rain through the day, over the query result', o => o.segments.some(s => segmentWidgets(s, 'chart').some(e => s.sources?.[e.config?.source]?.artifact && [e.config?.y].flat().includes('precipProbability')))],
            ['any stat cards hold inline values it computed', o => o.segments.every(s => segmentWidgets(s, 'statCard').every(e => s.sources?.[e.config?.source]?.inline))],
            ['the host is unchanged', o => JSON.stringify(o.blueprint) === JSON.stringify(loadBlueprint('w2-two-cities.json'))]
        ]
    },
    {
        id: 'W3b',
        title: "W3's answer, then a third city added to the dashboard",
        host: 'w2-two-cities.json',
        mode: 'run',
        context: 'Mode: run. The user has write access. A chat is open beside the host blueprint below. Today is 2026-11-19.',
        steps: [{prompt: 'Will I need an umbrella in Chicago tomorrow? When is rain most likely?'}, {prompt: 'Add Chicago to my dashboard.'}],
        checks: [
            ['Chicago is a city variable', o => vars(o.blueprint, v => v.default?.value === 'Chicago').length],
            ['current and forecast sources for Chicago, in the chosen units', o => {
                const s = Object.values<any>(o.blueprint.sources ?? {}),
                    chicago = (x: any) => x.params?.city?.$var && o.blueprint.variables?.[x.params.city.$var]?.default?.value === 'Chicago' && bound(x.params?.units, 'units');
                return s.some(x => x.dataset === 'currentWeather' && chicago(x)) && s.some(x => x.dataset === 'weather' && chicago(x));
            }],
            ['every stat card reads a dataset source', o => cfg(o.blueprint, 'statCard').every(c => dataset(o.blueprint, c))],
            ['no artifact or inline source in the host', o => noChatSources(o.blueprint)],
            ['asks for design mode before it edits', askedFirst]
        ]
    }
];
