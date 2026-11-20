import {DatasetDef, datasets} from './load.ts';

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
    manager: ['Ana Reyes', 'Marcus Oyelaran', 'Priya Natarajan', 'Tom Becker', 'Lena Holm'],
    style: ['Long/Short', 'Macro', 'Credit', 'Multi-Strategy', 'Macro'],
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
        row[f.name] = f.name in ctx ? ctx[f.name] : POOLS[f.name] ? pick(r, POOLS[f.name]) : f.type === 'string' ? `${f.name}-${i % 7}`
            : f.type === 'number[]' ? Array.from({length: 20}, () => Math.round(normal(r) * 1e5)) : Math.round(1000 * r());
    }
    // One row per fund, keyed by it, with the fund's own manager and style.
    if (ds.name === 'fundSummary') {
        const idx = POOLS.fund.indexOf(params?.fund) >= 0 ? POOLS.fund.indexOf(params.fund) : i;
        Object.assign(row, {fund: POOLS.fund[idx], manager: POOLS.manager[idx], style: POOLS.style[idx], nav: 5e8 + idx * 7.5e8});
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

/** The data provider the Architect's query_dataset tool reads: fake leaf rows, with every field. */
export const fakeDataProvider = {
    async loadAsync(req: {dataset: string; params: Record<string, unknown>; filter?: unknown}) {
        const ds = datasets[req.dataset],
            r = rng(JSON.stringify([ds.name, req.params])),
            count = {positions: 160, orders: 90, prices: 64, hypotheticalPortfolio: 12, weather: 40, currentWeather: 1, fundSummary: req.params?.fund ? 1 : POOLS.fund.length}[ds.name] ?? 50;
        return {rows: Array.from({length: count}, (_, i) => makeRow(ds, r, i, req.params)).filter(row => matches(row, req.filter))};
    }
};
