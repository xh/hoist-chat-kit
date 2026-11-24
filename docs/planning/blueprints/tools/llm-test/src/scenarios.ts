import {Blueprint, loadBlueprint} from './load.ts';
import {advancedKeysOf} from './library.ts';
import type {LibraryItem} from './tools.ts';

export interface Step {
    prompt: string;
}

export interface Outcome {
    blueprint: Blueprint;
    segments: Blueprint[];
    replies: string[];
    /** The tools the model called, in order. */
    calls: string[];
    /** The feature requests sent, each as the model wrote it. */
    featureRequests?: any[];
}

const OFFERS_PROMPT = /\b(prompts?|pickers?|inputs?|let (users|you|them) (choose|change|pick|switch))\b/i;

export interface Scenario {
    id: string;
    title: string;
    host?: string;
    /** The user's mode as the run starts. Default design. */
    mode?: 'run' | 'design';
    /** The user's library of published blueprints, for list_blueprints. Default none. */
    library?: LibraryItem[];
    context: string;
    /** What the designer has in front of them, sent after the first prompt as a ui_context block, as uiContextProvider() sends it. */
    uiContext?: object;
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
/** No edit, and a last reply of one short question that names both ways to add Chicago: switching a city, or adding one. */
const askedWhichChicago = (o: Outcome) => {
    const last = o.replies.at(-1) ?? '';
    return !o.calls.includes('edit_blueprint') && last.length < 600 && (last.match(/\?/g) ?? []).length === 1 &&
        /\b(switch|select|change|set)\b|city [ab]\b/i.test(last) && /\b(third|add|another|new)\b/i.test(last);
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

/** The sources over a dataset. */
const sourcesOf = (bp: Blueprint, ds: string) => Object.entries<any>(bp.sources ?? {}).filter(([, s]) => s.dataset === ds);
/** The variable a value binds, or null. */
const varOf = (v: any): string | null => v?.$var ?? null;
/** True if every source over these datasets binds asOf to one variable. */
const sharedAsOf = (bp: Blueprint, ...ds: string[]) => {
    const names = ds.flatMap(d => sourcesOf(bp, d)).map(([, s]) => varOf(s.params?.asOf));
    return names.length >= ds.length && names.every(n => n && n === names[0]);
};
/** The heatmaps of a value by sector and strategy, either way round. */
const pnlHeatmaps = (bp: Blueprint) => els(bp, 'heatmap').filter(([, e]) => {
    const c = e.config ?? {};
    return c.value === 'pnlDay' && [c.x, c.y].sort().join() === 'sector,strategy';
});
/** Each join on a source, with the names its fields take there. */
const joinsOf = (s: any) => (s?.joins ?? []).map((j: any) => ({...j, names: (j.fields ?? []).map((f: string) => j.as?.[f] ?? f)}));
/** A grid shows a field: in its column state, its columns, or a preset's column state for it. */
const gridShows = (bp: Blueprint, id: string, field: string) => {
    const c = bp.elements?.[id]?.config ?? {},
        presetStates = Object.values<any>(bp.presets ?? {}).flatMap(g => Object.values<any>(g.items ?? {}).map(it => it.set?.elements?.[id]?.config?.columnState));
    return [c.columnState, ...presetStates].some(st => fieldsOf([st ?? []].flat()).includes(field)) || !!c.columns?.[field];
};
/** A variable computed by a resolver. */
const computedBy = (bp: Blueprint, name: string, resolver: string) => bp.variables?.[name]?.compute?.resolver === resolver;
/** The text of a template with its references taken out. */
const literalText = (t: unknown) => String(t ?? '').replace(/\{[^}]*\}/g, '');

/** Set by the user: a prompt, or an input widget. */
const userSet = (v: any) => v.setBy === 'prompt' || (v.setBy?.element && !v.setBy.output);
/** The sources whose fund param or filter binds a variable that defaults to Oak Mount. */
const oakSources = (bp: Blueprint) => Object.entries<any>(bp.sources ?? {})
    .filter(([, s]) => [s.params?.fund, ...[s.filter].flat().filter((f: any) => f?.field === 'fund').map((f: any) => f.value)].some(v => bp.variables?.[varOf(v)!]?.default?.value === 'Oak Mount'))
    .map(([name]) => name);
/** True if a slot of an element holds a widget that passes, directly or inside a toolbar there. */
const slotHolds = (bp: Blueprint, id: string, slot: string, test: (e: any) => boolean) =>
    ((bp.elements?.[id] as any)?.[slot] ?? []).some((ref: any) => {
        const el: any = bp.elements?.[ref.id];
        return el && (test(el) || (el.component === 'toolbar' && (el.children ?? []).some((c: any) => bp.elements?.[c.id] && test(bp.elements[c.id]))));
    });
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
            // The dashboard may sit under a box with a toolbar of inputs, since step 11.
            ['a dashboard lays out the widgets', o => els(o.blueprint, 'dashboard').length],
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
            // A prompt or, since step 11, an input widget.
            ['a user-set fund of type toolbox.fund, defaulting to toolbox.userFund', o => vars(o.blueprint, v => v.type === 'toolbox.fund' && userSet(v) && v.default?.resolver === 'toolbox.userFund').length],
            ['a user-set as-of defaulting to previousBusinessDay', o => vars(o.blueprint, v => v.type === 'localDate' && userSet(v) && v.default?.resolver === 'previousBusinessDay').length],
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
        // The dashboard's city selects already offer Chicago, so asking whether to switch one or add a
        // third is as good an answer as the third column.
        checks: [
            ['Chicago is a city variable, or it asks which', o => askedWhichChicago(o) || vars(o.blueprint, v => v.default?.value === 'Chicago').length],
            ['current and forecast sources for Chicago, in the chosen units, or it asks which', o => {
                if (askedWhichChicago(o)) return true;
                const s = Object.values<any>(o.blueprint.sources ?? {}),
                    chicago = (x: any) => x.params?.city?.$var && o.blueprint.variables?.[x.params.city.$var]?.default?.value === 'Chicago' && bound(x.params?.units, 'units');
                return s.some(x => x.dataset === 'currentWeather' && chicago(x)) && s.some(x => x.dataset === 'weather' && chicago(x));
            }],
            ['every stat card reads a dataset source', o => cfg(o.blueprint, 'statCard').every(c => dataset(o.blueprint, c))],
            ['no artifact or inline source in the host', o => noChatSources(o.blueprint)],
            ['asks for design mode before it edits, or asks which', o => askedWhichChicago(o) || askedFirst(o)]
        ]
    },
    {
        id: 'P6',
        title: 'A fund overview from one request',
        context: BUILD,
        steps: [{
            prompt: "Build me a fund overview. Headline NAV and today's, MTD and YTD P&L, each with its trend. Positions by sector and symbol, with a sparkline of each one's recent closes. And where today's P&L sits by sector and strategy."
        }],
        checks: [
            ['stat cards over fundSummary, at least three, each with a trend', o => cfg(o.blueprint, 'statCard', c => dataset(o.blueprint, c) === 'fundSummary' && c.trend).length >= 3],
            ['a positions grid grouped by sector, then symbol', o => gridId(o.blueprint, c => dataset(o.blueprint, c) === 'positions' && c.groupBy?.[0] === 'sector' && c.groupBy?.[1] === 'symbol')],
            ['that grid shows closeHistory', o => gridShows(o.blueprint, gridId(o.blueprint, c => dataset(o.blueprint, c) === 'positions')!, 'closeHistory')],
            ['a heatmap of day P&L by sector and strategy', o => pnlHeatmaps(o.blueprint).length],
            ['the grid and the heatmap share one positions source', o => sourcesOf(o.blueprint, 'positions').length === 1],
            ['fundSummary and positions bind asOf to one variable', o => sharedAsOf(o.blueprint, 'fundSummary', 'positions')]
        ]
    },
    {
        id: 'P7',
        title: 'Sparklines in a grid',
        host: 'p2-linked-dashboard.json',
        context: 'Mode: design. The user has write access. They are editing the host blueprint below.',
        steps: [{prompt: "Add a sparkline of each position's P&L history to the positions grid, and show percent of NAV as a bar."}],
        checks: [
            ['the positions grid shows pnlHistory', o => gridShows(o.blueprint, 'posGrid', 'pnlHistory')],
            // The catalog draws pctNav as a bar by default, so a grid that adds it already meets the ask.
            ['pctNav draws as a bar', o => {
                const r = o.blueprint.elements?.posGrid?.config?.columns?.pctNav?.renderer ?? o.blueprint.sources?.positions?.fields?.pctNav?.renderer,
                    name = r?.name ?? r;
                return gridShows(o.blueprint, 'posGrid', 'pctNav') && (name == null || ['bar', 'progress'].includes(name));
            }],
            ['no new source', o => Object.keys(o.blueprint.sources ?? {}).length === 2]
        ]
    },
    {
        id: 'P8',
        title: 'Fund details joined onto positions',
        context: BUILD,
        steps: [{prompt: "Show positions grouped by fund manager and style, with each fund's NAV beside its positions. Only Macro and Credit funds."}],
        checks: [
            ['positions join fundSummary on fund', o => sourcesOf(o.blueprint, 'positions').some(([, s]) => joinsOf(s).some((j: any) => o.blueprint.sources?.[j.source]?.dataset === 'fundSummary' && j.on?.fund === 'fund'))],
            ['the join brings manager, style and nav', o => sourcesOf(o.blueprint, 'positions').some(([, s]) => joinsOf(s).some((j: any) => has(j.fields, 'manager', 'style', 'nav')))],
            ['a grid grouped by the joined manager and style', o => sourcesOf(o.blueprint, 'positions').some(([name, s]) => {
                const names = joinsOf(s).flatMap((j: any) => j.names),
                    mgr = names.find((n: string) => /manager/i.test(n)), style = names.find((n: string) => /style/i.test(n));
                return cfg(o.blueprint, 'cubeGrid', c => c.source === name && has([c.groupBy].flat(), mgr, style)).length;
            })],
            ['a filter on style naming Macro and Credit', o => [...Object.values<any>(o.blueprint.sources ?? {}).map(s => s.filter), ...cfg(o.blueprint, 'cubeGrid').map(c => c.filter)].some(f => {
                const t = JSON.stringify(resolveVars(o.blueprint, f ?? {}) ?? {});
                return /style/i.test(t) && t.includes('Macro') && t.includes('Credit');
            })],
            ['fundSummary and positions bind asOf to one variable', o => sharedAsOf(o.blueprint, 'fundSummary', 'positions')]
        ]
    },
    {
        id: 'P9',
        title: 'A heatmap that drives a grid',
        context: BUILD,
        steps: [{prompt: "Show today's P&L by sector and strategy as a heatmap. When I click a cell, list its positions below."}],
        checks: [
            ['a heatmap of day P&L by sector and strategy', o => pnlHeatmaps(o.blueprint).length],
            ['its selection sets a filter variable', o => vars(o.blueprint, v => v.type === 'filter' && [v.setBy].flat().some((w: any) => w?.output === 'selection' && pnlHeatmaps(o.blueprint).some(([id]) => id === w.element))).length],
            ['a positions grid filtered by that variable', o => vars(o.blueprint, v => v.type === 'filter' && [v.setBy].flat().some((w: any) => w?.output === 'selection')).some(([n]) => cfg(o.blueprint, 'cubeGrid', c => dataset(o.blueprint, c) === 'positions' && JSON.stringify(c.filter ?? {}).includes(`"${n}"`)).length)],
            ['one positions source', o => sourcesOf(o.blueprint, 'positions').length === 1]
        ]
    },
    {
        id: 'P10',
        title: 'A lookback and a date range',
        host: 'p3-morning-report.json',
        context: 'Mode: design. The user has write access. They are editing the host blueprint below.',
        steps: [
            {prompt: "Add a lookback prompt, default 3M, and show each symbol's return over it."},
            {prompt: "Let me pick the price chart's dates."}
        ],
        checks: [
            ['a period variable defaulting to 3M, set by the user', o => vars(o.blueprint, v => v.type === 'period' && String(v.default?.value).toUpperCase() === '3M' && v.setBy && v.setBy !== 'resolver').length],
            ['a return instance starting at periodStart over that period', o => Object.values<any>(o.blueprint.sources ?? {}).some(s => Object.values<any>(s.fields ?? {}).some(f => {
                const start = varOf(f.params?.start), period = varOf(o.blueprint.variables?.[start!]?.compute?.args?.period);
                return f.field === 'return' && computedBy(o.blueprint, start!, 'periodStart') && o.blueprint.variables?.[period!]?.type === 'period';
            }))],
            ['the positions grid shows that return', o => Object.entries<any>(o.blueprint.sources?.positions?.fields ?? {}).some(([n, f]) => f.field === 'return' && computedBy(o.blueprint, varOf(f.params?.start)!, 'periodStart') && gridShows(o.blueprint, 'posGrid', n))],
            ['prices start and end come from rangeStart and rangeEnd over a dateRange', o => sourcesOf(o.blueprint, 'prices').some(([, s]) => {
                const start = varOf(s.params?.start)!, end = varOf(s.params?.end)!, range = varOf(o.blueprint.variables?.[start]?.compute?.args?.range)!;
                return computedBy(o.blueprint, start, 'rangeStart') && computedBy(o.blueprint, end, 'rangeEnd') && o.blueprint.variables?.[range]?.type === 'dateRange';
            })],
            ['the date range is set by a dateRangePicker or a prompt', o => vars(o.blueprint, v => v.type === 'dateRange' && (v.setBy === 'prompt' || els(o.blueprint, 'dateRangePicker').some(([id]) => v.setBy?.element === id))).length],
            ['prices still reads the selected symbol', o => sourcesOf(o.blueprint, 'prices').some(([, s]) => o.blueprint.variables?.[varOf(s.params?.symbol)!]?.setBy?.output === 'selected')]
        ]
    },
    {
        id: 'P11',
        title: "An answer's cards and note added to a dashboard",
        host: 'p2-linked-dashboard.json',
        mode: 'run',
        context: 'Mode: run. The user has write access. A chat is open beside the host blueprint below, which the user is looking at. Its asOf is today, 2026-11-19.',
        steps: [{prompt: 'How is Oak Mount doing today? Show me its headline numbers.'}, {prompt: 'Put those numbers on my dashboard, with a note on the day.'}],
        checks: [
            ['answers with stat cards', o => o.segments.some(s => segmentWidgets(s, 'statCard').length)],
            // By its param or its filter, over whichever dataset the answer read.
            ['the host gains a source whose fund binds a variable for Oak Mount', o => oakSources(o.blueprint).length],
            ['stat cards over that source, at least two', o => cfg(o.blueprint, 'statCard', c => oakSources(o.blueprint).includes(c.source)).length >= 2],
            ['adds a callout', o => cfg(o.blueprint, 'callout').length],
            ['no callout text holds a number of its own', o => cfg(o.blueprint, 'callout').every(c => !/\d/.test(literalText(c.text)))],
            ['no artifact or inline source in the host', o => noChatSources(o.blueprint)],
            ['asks for design mode before it edits', askedFirst]
        ]
    },
    {
        id: 'P11o',
        title: "P11 in its original words, before step 12's rewording",
        host: 'p2-linked-dashboard.json',
        mode: 'run',
        context: 'Mode: run. The user has write access. A chat is open beside the host blueprint below, which the user is looking at. Its asOf is today, 2026-11-19.',
        steps: [{prompt: 'How is Oak Mount doing today?'}, {prompt: 'Put those numbers and the note on my dashboard.'}],
        checks: [
            ['answers with stat cards', o => o.segments.some(s => segmentWidgets(s, 'statCard').length)],
            ['answers with a callout', o => o.segments.some(s => segmentWidgets(s, 'callout').length)],
            // By its param or its filter, over whichever dataset the answer read.
            ['the host gains a source whose fund binds a variable for Oak Mount', o => oakSources(o.blueprint).length],
            ['stat cards over that source, at least two', o => cfg(o.blueprint, 'statCard', c => oakSources(o.blueprint).includes(c.source)).length >= 2],
            ['adds a callout', o => cfg(o.blueprint, 'callout').length],
            ['no callout text holds a number of its own', o => cfg(o.blueprint, 'callout').every(c => !/\d/.test(literalText(c.text)))],
            ['no artifact or inline source in the host', o => noChatSources(o.blueprint)],
            ['asks for design mode before it edits', askedFirst]
        ]
    },
    {
        id: 'P12',
        title: 'A button in a bottom toolbar and a view switch in a header',
        host: 'p12-host.json',
        context: 'Mode: design. The user has write access. They are editing the host blueprint below.',
        steps: [
            {prompt: 'Add a refresh button along the bottom of the positions panel.'},
            {prompt: 'Put the switch between the column views up in the header, next to the title.'}
        ],
        checks: [
            ['a refresh button in the bottom toolbar of the positions panel', o => slotHolds(o.blueprint, 'posPanel', 'bbar', e => e.component === 'buttonGroup' && JSON.stringify(e.config).includes('"refresh"'))],
            ["the column views' selector in the panel's header", o => {
                const isViews = (e: any) => e.component === 'presetSelector' && e.config?.group === 'posViews',
                    cell = (o.blueprint.elements?.positions?.children ?? []).find((it: any) => it.id === 'posPanel');
                return slotHolds(o.blueprint, 'posPanel', 'headerItems', isViews) || (cell?.headerItems ?? []).some((it: any) => isViews(o.blueprint.elements[it.id]));
            }],
            ['no new cell on the dashboard', o => (o.blueprint.elements?.positions?.children ?? []).length === loadBlueprint('p12-host.json').elements.positions.children.length]
        ]
    },
    {
        id: 'P18',
        title: 'A grid, with a question about what it can show',
        context: BUILD,
        steps: [{prompt: 'I want a grid showing positions, which dimensions are available for grouping, and what metrics can I show.'}],
        checks: [
            ['a cubeGrid over positions', o => cfg(o.blueprint, 'cubeGrid', c => dataset(o.blueprint, c) === 'positions').length],
            ['names the dimensions in its reply', o => (o.replies.join(' ').match(/\b(sector|region|strategy|trader|fund|country|industry)\b/gi) ?? []).length >= 3],
            ['names the metrics in its reply', o => /market value|mktVal/i.test(o.replies.join(' ')) && /p&l|pnl/i.test(o.replies.join(' '))],
            ['builds no chooser it was not asked for', o => !els(o.blueprint, 'groupingChooser').length]
        ]
    },
    {
        id: 'P19',
        title: 'A grouping chooser moved into the toolbar',
        host: 'p19-host.json',
        context: 'Mode: design. The user has write access. They are editing the host blueprint below.',
        steps: [{prompt: 'Move that grouping chooser up into the toolbar.'}],
        checks: [
            ["the chooser sits in the grid's header or a panel's tbar", o => {
                const isChooser = (e: any) => e.component === 'groupingChooser',
                    cell = (o.blueprint.elements?.dashboard?.children ?? []).find((it: any) => it.id === 'posGrid');
                return (cell?.headerItems ?? []).some((it: any) => isChooser(o.blueprint.elements[it.id])) || slotHolds(o.blueprint, 'page', 'tbar', isChooser);
            }],
            ['no cell holds it any more', o => !(o.blueprint.elements?.dashboard?.children ?? []).some((it: any) => o.blueprint.elements[it.id]?.component === 'groupingChooser')],
            ['still drives the grid', o => o.blueprint.variables?.grouping?.setBy?.element === 'groupChooser']
        ]
    },
    {
        id: 'P20',
        title: 'A grid with only its common settings',
        context: BUILD,
        steps: [{prompt: 'A grid of my positions grouped by sector, with market value and day P&L.'}],
        checks: [
            ['a cubeGrid over positions', o => cfg(o.blueprint, 'cubeGrid', c => dataset(o.blueprint, c) === 'positions').length],
            ['sets no advanced setting it was not asked for', o => {
                const advanced = advancedKeysOf('cubeGrid');
                return cfg(o.blueprint, 'cubeGrid').every(c => !Object.keys(c).some(k => advanced.includes(k)));
            }]
        ]
    },
    {
        id: 'P13',
        title: 'Exposure against a limit',
        host: 'p2-linked-dashboard.json',
        context: 'Mode: design. The user has write access. They are editing the host blueprint below.',
        steps: [{prompt: "Our gross limit is 2 billion. Put something on the dashboard that shows how close we're getting to it."}],
        checks: [
            ['a gauge of gross exposure over positions', o => cfg(o.blueprint, 'gauge', c => c.value === 'grossExposure' && dataset(o.blueprint, c) === 'positions').length],
            ['its max is the 2 billion limit', o => cfg(o.blueprint, 'gauge', c => c.max === 2e9).length],
            ['no new source', o => Object.keys(o.blueprint.sources ?? {}).length === 2]
        ]
    },
    {
        id: 'P14',
        title: 'The date in a title and a column header',
        host: 'p2-linked-dashboard.json',
        context: 'Mode: design. The user has write access. They are editing the host blueprint below.',
        steps: [{prompt: "I keep losing track of which day I'm looking at. Put the date in the sector chart's title, and in the grid's market value column header."}],
        checks: [
            ["the sector chart's title reads the as-of date", o => /\{asOf\}/.test(o.blueprint.elements?.sectorChart?.config?.title ?? '')],
            ["the market value column's header reads the as-of date", o => /\{asOf\}/.test(o.blueprint.elements?.posGrid?.config?.columns?.mktVal?.headerName ?? '')],
            ['no date written into a title or header', o => !/\d{4}-\d{2}-\d{2}/.test(JSON.stringify(o.blueprint.elements))],
            ['no new variable', o => Object.keys(o.blueprint.variables ?? {}).length === 2]
        ]
    },
    {
        id: 'W5',
        title: 'Current conditions, with a reading on a scale',
        context: BUILD,
        steps: [{prompt: "What's it like outside in London right now? I want to see how warm it is, how humid, and the wind."}],
        checks: [
            ['humidity on a gauge over current weather, from 0 to 100', o => cfg(o.blueprint, 'gauge', c => c.value === 'humidity' && dataset(o.blueprint, c) === 'currentWeather' && (c.min ?? 0) === 0 && c.max === 100).length],
            ['temperature on a stat card, not a gauge', o => cfg(o.blueprint, 'statCard', c => c.field === 'temp').length && !cfg(o.blueprint, 'gauge', c => c.value === 'temp').length],
            ['London is a city variable', o => vars(o.blueprint, v => v.default?.value === 'London').length]
        ]
    },
    {
        id: 'P15',
        title: 'Conditional styles in a grid',
        host: 'p2-linked-dashboard.json',
        context: 'Mode: design. The user has write access. They are editing the host blueprint below.',
        steps: [{prompt: "In my positions grid, show today's P&L in red when it's below minus 100k and green above 100k, and shade the Energy rows."}],
        checks: [
            ['two pnlDay rules, in danger and success', o => {
                const rules = o.blueprint.elements?.posGrid?.config?.columns?.pnlDay?.styles ?? [],
                    colors = rules.map((r: any) => r.style?.color);
                return rules.length >= 2 && colors.includes('danger') && colors.includes('success');
            }],
            ['a row rule for Energy', o => (o.blueprint.elements?.posGrid?.config?.rowStyles ?? []).some((r: any) => JSON.stringify(r.when ?? {}).includes('"Energy"'))],
            ['no hex color', o => !/#[0-9a-fA-F]{6}/.test(JSON.stringify(o.blueprint.elements?.posGrid?.config ?? {}))],
            ['no binding in a style', o => !/"style":\{[^}]*\$var/.test(JSON.stringify(o.blueprint.elements?.posGrid?.config ?? {}))]
        ]
    },
    {
        id: 'P16',
        title: 'Drill into a symbol from a grid row',
        host: 'p2-linked-dashboard.json',
        library: [{id: 'symbol-detail', name: 'Symbol detail', description: "One symbol's price, P&L and holdings.", blueprint: loadBlueprint('d1-symbol-detail.json')}],
        context: 'Mode: design. The user has write access. They are editing the host blueprint below.',
        steps: [{prompt: "When I click a position, open the symbol's detail."}],
        checks: [
            ['the grid gets an openBlueprint row action', o => (o.blueprint.elements?.posGrid?.config?.rowActions ?? []).some((a: any) => a.action?.type === 'openBlueprint')],
            ['it opens symbol-detail', o => JSON.stringify(o.blueprint.elements?.posGrid?.config?.rowActions ?? []).includes('"blueprint":"symbol-detail"')],
            ["it passes the row's symbol", o => JSON.stringify(o.blueprint.elements?.posGrid?.config?.rowActions ?? []).includes('"symbol":{"$row":"symbol"}')],
            ['it passes the as-of date', o => JSON.stringify(o.blueprint.elements?.posGrid?.config?.rowActions ?? []).includes('"asOf":{"$var":"asOf"}')],
            ['it looked the target up', o => o.calls.includes('list_blueprints')]
        ]
    },
    {
        id: 'W4',
        title: "One city's day on two axes",
        context: BUILD,
        steps: [{prompt: 'London today: temperature and chance of rain on one chart, each on its own axis, with headline numbers above.'}],
        checks: [
            ['stat cards over current weather', o => cfg(o.blueprint, 'statCard', c => dataset(o.blueprint, c) === 'currentWeather').length],
            ['a chart over time with temperature on y and chance of rain on y2', o => cfg(o.blueprint, 'chart', c => c.x === 'time' && [c.y].flat().includes('temp') && [c.y2].flat().includes('precipProbability')).length],
            ['London is a city variable', o => vars(o.blueprint, v => v.default?.value === 'London').length]
        ]
    },
    {
        id: 'F1',
        title: 'A capability the registry lacks, built the closest way and requested',
        host: 'p2-linked-dashboard.json',
        context: 'Mode: design. The user has write access. The host blueprint below is open.',
        steps: [{prompt: 'Show my positions on a world map, each country shaded by its day P&L.'}],
        checks: [
            ['sends one feature request', o => o.featureRequests?.length === 1],
            ["quotes the user's own words", o => o.featureRequests?.every(r => 'Show my positions on a world map, each country shaded by its day P&L.'.includes(r.userWords))],
            ['asks for a widget', o => o.featureRequests?.[0]?.category === 'widget'],
            ['builds the closest supported view over positions', o => [...cfg(o.blueprint, 'chart'), ...cfg(o.blueprint, 'heatmap'), ...cfg(o.blueprint, 'treemap')].some(c => c.source === 'positions' && [c.x, c.groupBy].flat().some(f => ['region', 'country'].includes(f)))]
        ]
    },
    {
        id: 'P17',
        title: "A fund's P&L over time by sector",
        context: BUILD,
        steps: [{prompt: 'Show me historical P&L for Oak Mount by sector over the last month.'}],
        checks: [
            ['charts pnlBySector, not the per-symbol pnlHistory', o => cfg(o.blueprint, 'chart').some(c => dataset(o.blueprint, c) === 'pnlBySector') && !cfg(o.blueprint, 'chart').some(c => dataset(o.blueprint, c) === 'pnlHistory')],
            ['for Oak Mount, over a window it sets', o => cfg(o.blueprint, 'chart', c => dataset(o.blueprint, c) === 'pnlBySector').some(c => {
                // A start may be a variable a resolver computes, such as a month back from asOf.
                const params = src(o.blueprint, c.source).params ?? {};
                return resolveVars(o.blueprint, params).fund === 'Oak Mount' && params.start != null;
            })],
            ['by day, a series per sector, of cumPnl or pnlDay', o => cfg(o.blueprint, 'chart', c => dataset(o.blueprint, c) === 'pnlBySector').some(c =>
                c.x === 'day' && c.groupBy === 'sector' && [c.y].flat().some((y: any) => ['cumPnl', 'pnlDay'].includes(typeof y === 'string' ? y : y?.field)))]
        ]
    },
    {
        id: 'U1',
        title: 'Make the selected widget taller',
        host: 'p2-linked-dashboard.json',
        context: 'Mode: design. The user has write access. They are editing the host blueprint below.',
        uiContext: {mode: 'design', interaction: 'edit', selection: {kind: 'element', id: 'posGrid', widget: 'cubeGrid', parent: 'dashboard', cell: {x: 0, y: 2, w: 8, h: 7}}},
        steps: [{prompt: 'Make the selected widget taller.'}],
        checks: [
            ["grows posGrid's cell", o => (o.blueprint.elements?.dashboard?.children ?? []).find((it: any) => it.id === 'posGrid')?.h > 7],
            ['leaves its width', o => (o.blueprint.elements?.dashboard?.children ?? []).find((it: any) => it.id === 'posGrid')?.w === 8],
            ['changes no other widget', o => Object.keys(o.blueprint.elements ?? {}).length === Object.keys(loadBlueprint('p2-linked-dashboard.json').elements).length]
        ]
    },
    {
        id: 'U2',
        title: 'The selected widget, with nothing selected',
        host: 'p2-linked-dashboard.json',
        context: 'Mode: design. The user has write access. They are editing the host blueprint below.',
        uiContext: {mode: 'design', interaction: 'edit', selection: null},
        steps: [{prompt: 'Make the selected widget taller.'}],
        checks: [
            ['makes no edit', o => !o.calls.includes('edit_blueprint')],
            ['asks which widget', o => /\?/.test(o.replies.join(' '))]
        ]
    },
    {
        id: 'F2',
        title: 'A capability the registry has, built with no request',
        host: 'p2-linked-dashboard.json',
        context: 'Mode: design. The user has write access. The host blueprint below is open.',
        steps: [{prompt: "Add a heatmap of today's P&L by sector and strategy."}],
        checks: [
            ['sends no feature request', o => !o.featureRequests?.length && !o.calls.includes('request_feature')],
            ['adds a heatmap over positions', o => cfg(o.blueprint, 'heatmap', c => c.source === 'positions').length]
        ]
    }
];
