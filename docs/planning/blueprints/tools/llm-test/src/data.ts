import {DatasetDef, datasets, FieldDef} from './load.ts';

/** Seeded generator, so a query returns the same rows on every run. */
function rng(seed: string) {
    let h = 1779033703;
    for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 3432918353);
    return () => {
        h = Math.imul(h ^ (h >>> 15), h | 1);
        h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
        return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
    };
}

const POOLS: Record<string, string[]> = {
    fund: ['Oak Mount', 'Black Crescent', 'Winter Star', 'Red River', 'Hudson Bay'],
    strategy: ['Merger Arb', 'Long/Short Equity', 'Global Macro', 'Credit', 'Event Driven'],
    book: ['Core', 'Tactical', 'Hedge'],
    trader: ['Freda Klecko', 'London Rohan', 'Kennedy Hills', 'Linnea Trolley', 'Pearl Hellens', 'Jimmy Falcon', 'Fred Corn', 'Robert Greer', 'Susan Major'],
    model: ['Ren', 'Vader', 'Beckett', 'Hutt', 'Maul'],
    dir: ['Buy', 'Sell'],
    city: ['Chicago', 'London', 'New York', 'Paris', 'Sydney', 'Tokyo'],
    conditions: ['Clear', 'Clouds', 'Rain', 'Drizzle', 'Thunderstorm', 'Snow', 'Mist']
};
const SECTORS: Record<string, string[]> = {
    Technology: ['Semiconductors', 'Software', 'Hardware'],
    Financials: ['Banks', 'Insurance'],
    Healthcare: ['Pharma', 'Biotech'],
    Energy: ['Oil & Gas', 'Renewables'],
    'Consumer Products': ['Retail', 'Beverages'],
    Utilities: ['Electric']
};
const REGIONS: Record<string, [string, string][]> = {
    US: [['United States', 'USD']],
    EU: [['Germany', 'EUR'], ['France', 'EUR'], ['United Kingdom', 'GBP']],
    'Asia/Pac': [['Japan', 'JPY'], ['Australia', 'AUD']],
    'Emerging Markets': [['Brazil', 'BRL'], ['India', 'INR']]
};
const TYPES: [string, string][] = [['Equity', 'Equity'], ['Equity', 'Equity'], ['Equity', 'Option'], ['Equity', 'Future'], ['Fixed Income', 'Bond'], ['FX', 'FX']];
const TICKERS = ['NVDA', 'AAPL', 'MSFT', 'AMD', 'TSM', 'JPM', 'GS', 'XOM', 'PFE', 'LLY', 'KO', 'WMT', 'NEE', 'SAP', 'ASML', 'TM', 'BHP', 'VALE', 'INFY', 'SHEL'];

const pick = <T>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)];
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

function makeRow(ds: DatasetDef, r: () => number, i: number, params: any): Record<string, unknown> {
    const sector = pick(r, Object.keys(SECTORS)),
        region = pick(r, Object.keys(REGIONS)),
        [country, ccy] = pick(r, REGIONS[region]),
        [assetClass, instrumentType] = pick(r, TYPES),
        symbol = pick(r, TICKERS),
        mv = Math.round(Math.exp(13 + 2 * r()) * (r() < 0.2 ? -1 : 1)),
        isOption = instrumentType === 'Option',
        isBond = instrumentType === 'Bond';
    const ctx: Record<string, unknown> = {
        sector, industry: pick(r, SECTORS[sector]), region, country, ccy, assetClass, instrumentType, symbol,
        underlying: isOption || instrumentType === 'Future' ? symbol : null,
        issuer: isBond ? `${symbol} Corp` : `${symbol} Inc`,
        isin: `US${Math.floor(r() * 1e10)}`, cusip: Math.floor(r() * 1e9).toString(36).toUpperCase(),
        mktVal: mv, notional: Math.abs(mv) * (isOption ? 4 : 1), grossExposure: Math.abs(mv), netExposure: mv,
        betaAdjExposure: Math.round(mv * (0.6 + r())), beta: 0.6 + r(), pctNav: Math.abs(mv) / 5e8,
        quantity: Math.round(Math.abs(mv) / (20 + 300 * r())), price: 20 + 300 * r(),
        pnlDay: Math.round(normal(r) * Math.abs(mv) * 0.02), pnlMtd: Math.round(normal(r) * Math.abs(mv) * 0.05),
        pnlYtd: Math.round(normal(r) * Math.abs(mv) * 0.12),
        delta: isOption ? Math.round(mv * (0.3 + 0.6 * r())) : null, gamma: isOption ? Math.round(mv * 0.01 * r()) : null,
        vega: isOption ? Math.round(mv * 0.02 * r()) : null, theta: isOption ? -Math.round(Math.abs(mv) * 0.001 * r()) : null,
        duration: isBond ? 1 + 9 * r() : null, dv01: isBond ? Math.round(Math.abs(mv) * 0.0005 * r()) : null, yield: isBond ? 0.02 + 0.05 * r() : null,
        var95: Math.round(Math.abs(mv) * 0.02 * (1 + r())), var99: Math.round(Math.abs(mv) * 0.03 * (1 + r())),
        return: normal(r) * 0.08, shockedPnl: Math.round(mv * (params?.shock ?? -0.1) * (0.6 + r())),
        orderId: `ORD-${10000 + i}`, commission: Math.round(50 + 500 * r()), confidence: Math.floor(100 * r()),
        time: Date.parse(`${params?.asOf ?? '2026-11-18'}T09:30:00Z`) + i * 300000,
        weight: r() / 10, day: params?.start ?? '2026-08-18',
        temp: 10 + 15 * r(), feelsLike: 8 + 15 * r(), tempMin: 5 + 10 * r(), tempMax: 15 + 12 * r(),
        humidity: Math.round(40 + 50 * r()), pressure: Math.round(1000 + 25 * r()), windSpeed: 2 + 12 * r(), windGust: 5 + 18 * r(),
        precipProbability: r(), precipVolume: r() < 0.5 ? 0 : 6 * r(), iconCode: '10d', city: params?.city
    };
    const row: Record<string, unknown> = {};
    for (const f of Object.values(ds.fields)) {
        row[f.name] = f.name in ctx ? ctx[f.name] : POOLS[f.name] ? pick(r, POOLS[f.name]) : f.type === 'string' ? `${f.name}-${i % 7}` : Math.round(1000 * r());
    }
    if (ds.name === 'weather' || ds.name === 'prices') {
        const start = Date.parse(`${params?.start ?? '2026-11-19'}T00:00:00Z`);
        row.time = start + i * 3 * 3600000;
        row.day = new Date(ds.name === 'prices' ? start + i * 86400000 : row.time as number).toISOString().slice(0, 10);
    }
    return row;
}

function matches(row: Record<string, unknown>, f: any): boolean {
    if (!f) return true;
    if (Array.isArray(f.filters)) {
        const res = f.filters.map((x: any) => matches(row, x));
        return String(f.op ?? 'AND').toUpperCase() === 'OR' ? res.some(Boolean) : res.every(Boolean);
    }
    const v = row[f.field] as any,
        want = f.value;
    const vals = Array.isArray(want) ? want : [want];
    switch (f.op) {
        case '=': return vals.some(x => x == v);
        case '!=': return vals.every(x => x != v);
        case '>': return v > want;
        case '>=': return v >= want;
        case '<': return v < want;
        case '<=': return v <= want;
        case 'like': return String(v).toLowerCase().includes(String(want).toLowerCase());
        case 'not like': return !String(v).toLowerCase().includes(String(want).toLowerCase());
        case 'begins': return String(v).startsWith(want);
        case 'ends': return String(v).endsWith(want);
        default: return true;
    }
}

function aggregate(rows: Record<string, unknown>[], f: FieldDef): unknown {
    const vals = rows.map(r => r[f.name]).filter(v => v != null);
    if (f.type === 'string' || f.type === 'localDate' || f.type === 'date') return new Set(vals).size === 1 ? vals[0] : null;
    const nums = vals as number[];
    if (!nums.length) return null;
    const agg = typeof f.aggregator === 'string' ? f.aggregator : 'SUM';
    if (agg === 'MAX') return Math.max(...nums);
    if (agg === 'MIN') return Math.min(...nums);
    if (agg === 'AVG' || typeof f.aggregator === 'object') return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (agg === 'UNIQUE') return new Set(nums).size === 1 ? nums[0] : null;
    return nums.reduce((a, b) => a + b, 0);
}

let artifactSeq = 0;

/** The query_dataset tool: fake rows from a dataset, shaped like a chat kit artifact. */
export function queryDataset(input: any): {artifact?: any; error?: string} {
    const ds = datasets[input?.dataset];
    if (!ds) return {error: `unknown dataset '${input?.dataset}'. Datasets: ${Object.keys(datasets).join(', ')}`};
    for (const [pn, pd] of Object.entries(ds.params)) if (pd.required && input.params?.[pn] == null) return {error: `${ds.name} requires parameter '${pn}'`};
    const fieldNames: string[] = input.fields?.length ? input.fields : Object.keys(ds.fields).slice(0, 12);
    const unknown = [...fieldNames, ...(input.groupBy ?? [])].filter(f => !ds.fields[f]);
    if (unknown.length) return {error: `unknown fields: ${unknown.join(', ')}`};
    const r = rng(JSON.stringify([ds.name, input.params])),
        count = {positions: 160, orders: 90, prices: 64, hypotheticalPortfolio: 12, weather: 40, currentWeather: 1}[ds.name] ?? 50;
    let rows = Array.from({length: count}, (_, i) => makeRow(ds, r, i, input.params)).filter(row => matches(row, input.filter));
    const groupBy: string[] = input.groupBy ?? [];
    if (groupBy.length) {
        const groups = new Map<string, Record<string, unknown>[]>();
        for (const row of rows) {
            const key = JSON.stringify(groupBy.map(g => row[g]));
            groups.set(key, [...(groups.get(key) ?? []), row]);
        }
        rows = [...groups.values()].map(g => Object.fromEntries(
            [...groupBy, ...fieldNames.filter(f => !groupBy.includes(f))].map(f => [f, groupBy.includes(f) ? g[0][f] : aggregate(g, ds.fields[f])])
        ));
    } else {
        rows = rows.map(row => Object.fromEntries(fieldNames.map(f => [f, row[f]])));
    }
    if (input.sortBy) {
        const [f, dir] = String(input.sortBy).split('|');
        rows.sort((a: any, b: any) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    const totalRows = rows.length;
    if (input.top) rows = rows.slice(0, input.top);
    const columns = [...new Set([...groupBy, ...fieldNames])].map(n => {
        const {name, label, type, kind} = ds.fields[n];
        return {name, label, type, kind};
    });
    const id = `art_${(++artifactSeq).toString(16).padStart(3, '0')}`;
    return {artifact: {id, dataset: ds.name, params: input.params ?? {}, columns, rows: rows.slice(0, 50), totalRows}};
}
