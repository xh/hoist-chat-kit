import type {PlainObject} from '@xh/hoist/core';
import {LocalDate} from '@xh/hoist/utils/datetime';
import {groupBy, isArray, isString, mean, sampleSize, sum} from 'lodash';
import type {SuppliedAggregate} from '@xh/hoist/data';
import type {
    BlueprintDataProvider,
    BlueprintDataRequest,
    BlueprintDataResult,
    BlueprintDataUpdate,
    BlueprintFieldInstance
} from './BlueprintDataProvider';
import type {DataCatalog, DatasetDef} from './DataCatalog';

export interface FakeBlueprintDataProviderConfig {
    catalog: DataCatalog;
    /** Milliseconds between live updates to a subscription for today. Default 2000. */
    updateInterval?: number;
}

/**
 * A data provider over seeded fake rows, for any dataset in a catalog. A request returns the same
 * rows every time for the same dataset and parameters. A subscription whose `asOf` is today, or
 * whose dataset has no `asOf`, then receives live updates. It returns only the requested fields,
 * as the contract requires of a real provider, and fake server values for the request's grouping
 * sets.
 */
export class FakeBlueprintDataProvider implements BlueprintDataProvider {
    readonly catalog: DataCatalog;
    readonly updateInterval: number;

    // Open subscriptions, with the grouping sets each pushes server values for.
    private subscriptions: {key: string; sets: string[][]}[] = [];

    constructor({catalog, updateInterval = 2000}: FakeBlueprintDataProviderConfig) {
        this.catalog = catalog;
        this.updateInterval = updateInterval;
    }

    async loadAsync(req: BlueprintDataRequest): Promise<BlueprintDataResult> {
        const rows = this.getRows(req);
        return {rows, aggregates: this.getAggregates(req, rows, req.groupBy)};
    }

    async loadAggregatesAsync(
        req: BlueprintDataRequest
    ): Promise<{aggregates: SuppliedAggregate[]}> {
        this.subscriptions
            .filter(it => it.key === subscriptionKey(req))
            .forEach(it => it.sets.push(...req.groupBy));
        return {aggregates: this.getAggregates(req, this.getRows(req), req.groupBy)};
    }

    subscribe(req: BlueprintDataRequest, onUpdate: (u: BlueprintDataUpdate) => void): () => void {
        let rows = this.getRows(req),
            timer = null,
            isOpen = true;
        const r = rng(`live:${JSON.stringify(req)}`),
            ds = this.getDataset(req.dataset),
            isLive =
                !('asOf' in ds.params) || req.params.asOf === LocalDate.currentAppDay().isoString,
            sub = {key: subscriptionKey(req), sets: [...req.groupBy]};
        this.subscriptions.push(sub);

        queueMicrotask(() => {
            if (!isOpen) return;
            onUpdate({replace: rows, aggregates: this.getAggregates(req, rows, sub.sets)});
            if (!isLive) return;
            timer = setInterval(() => {
                const update = sampleSize(rows, Math.max(1, Math.round(rows.length / 20))).map(it =>
                    nudge(it, ds, r)
                );
                rows = rows.map(it => update.find(u => u.id === it.id) ?? it);
                onUpdate({update, aggregates: this.getAggregates(req, rows, sub.sets)});
            }, this.updateInterval);
        });

        return () => {
            isOpen = false;
            clearInterval(timer);
            this.subscriptions = this.subscriptions.filter(it => it !== sub);
        };
    }

    /**
     * Server values of a request's `"server"` fields for each grouping set: the mean of a fraction,
     * and for any other measure a sum damped as a diversified risk would be. Empty if the request
     * names no server field.
     */
    getAggregates(
        req: BlueprintDataRequest,
        rows: PlainObject[],
        sets: string[][]
    ): SuppliedAggregate[] {
        const ds = this.getDataset(req.dataset),
            server = req.fields
                .map(f =>
                    isString(f)
                        ? {name: f, def: ds.fields[f]}
                        : {name: f.name, def: ds.fields[f.field]}
                )
                .filter(it => it.def?.aggregator === 'server');
        if (!server.length) return [];

        return sets.flatMap(set => {
            const groups = groupBy(rows, row => JSON.stringify(set.map(d => row[d] ?? null)));
            return Object.values(groups).map(group => ({
                dims: Object.fromEntries(set.map(d => [d, group[0][d] ?? null])),
                values: Object.fromEntries(
                    server.map(({name, def}) => {
                        const vals = group.map(it => it[name]).filter(it => it != null) as number[];
                        if (!vals.length) return [name, null];
                        return [name, def.kind === 'fraction' ? mean(vals) : sum(vals) * 0.8];
                    })
                )
            }));
        });
    }

    /** The rows for a request: each requested field, plus `id`, and nothing else. */
    getRows(req: BlueprintDataRequest): PlainObject[] {
        const ds = this.getDataset(req.dataset),
            r = rng(JSON.stringify([ds.name, req.params])),
            count = ROW_COUNTS[ds.name] ?? 50;

        return Array.from({length: count}, (_, i) => makeRow(ds, r, i, req.params))
            .filter(row => matches(row, req.filter))
            .map(row => {
                const ret: PlainObject = {id: row.id};
                req.fields.forEach(f => {
                    if (isString(f)) {
                        ret[f] = row[f];
                    } else {
                        ret[f.name] = instanceValue(row, f);
                    }
                });
                return ret;
            });
    }

    private getDataset(name: string): DatasetDef {
        const ret = this.catalog.getDataset(name);
        if (!ret) throw new Error(`Unknown dataset '${name}'`);
        return ret;
    }
}

//------------------
// Implementation
//------------------
/** What identifies a subscription for {@link FakeBlueprintDataProvider.loadAggregatesAsync}. */
function subscriptionKey(req: BlueprintDataRequest): string {
    return JSON.stringify([req.dataset, req.params, req.fields, req.filter ?? null]);
}

const ROW_COUNTS: Record<string, number> = {
    positions: 160,
    orders: 90,
    prices: 64,
    hypotheticalPortfolio: 12,
    weather: 40,
    currentWeather: 1
};

/** Seeded generator, so a request returns the same rows on every run. */
function rng(seed: string): () => number {
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
    trader: [
        'Freda Klecko',
        'London Rohan',
        'Kennedy Hills',
        'Linnea Trolley',
        'Pearl Hellens',
        'Jimmy Falcon',
        'Fred Corn',
        'Robert Greer',
        'Susan Major'
    ],
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
    EU: [
        ['Germany', 'EUR'],
        ['France', 'EUR'],
        ['United Kingdom', 'GBP']
    ],
    'Asia/Pac': [
        ['Japan', 'JPY'],
        ['Australia', 'AUD']
    ],
    'Emerging Markets': [
        ['Brazil', 'BRL'],
        ['India', 'INR']
    ]
};
const TYPES: [string, string][] = [
    ['Equity', 'Equity'],
    ['Equity', 'Equity'],
    ['Equity', 'Option'],
    ['Equity', 'Future'],
    ['Fixed Income', 'Bond'],
    ['FX', 'FX']
];
const TICKERS = [
    'NVDA',
    'AAPL',
    'MSFT',
    'AMD',
    'TSM',
    'JPM',
    'GS',
    'XOM',
    'PFE',
    'LLY',
    'KO',
    'WMT',
    'NEE',
    'SAP',
    'ASML',
    'TM',
    'BHP',
    'VALE',
    'INFY',
    'SHEL'
];

// Each ticker sits in one sector, so a grid grouped by sector then symbol reads sensibly.
const TICKER_SECTORS: Record<string, string> = {
    NVDA: 'Technology',
    AAPL: 'Technology',
    MSFT: 'Technology',
    AMD: 'Technology',
    TSM: 'Technology',
    SAP: 'Technology',
    ASML: 'Technology',
    INFY: 'Technology',
    JPM: 'Financials',
    GS: 'Financials',
    XOM: 'Energy',
    SHEL: 'Energy',
    PFE: 'Healthcare',
    LLY: 'Healthcare',
    KO: 'Consumer Products',
    WMT: 'Consumer Products',
    TM: 'Consumer Products',
    NEE: 'Utilities',
    BHP: 'Energy',
    VALE: 'Energy'
};

const pick = <T>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)];
const normal = (r: () => number) =>
    Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

function makeRow(ds: DatasetDef, r: () => number, i: number, params: PlainObject): PlainObject {
    const symbol = pick(r, TICKERS),
        sector = TICKER_SECTORS[symbol],
        region = pick(r, Object.keys(REGIONS)),
        [country, ccy] = pick(r, REGIONS[region]),
        [assetClass, instrumentType] = pick(r, TYPES),
        mv = Math.round(Math.exp(13 + 2 * r()) * (r() < 0.2 ? -1 : 1)),
        isOption = instrumentType === 'Option',
        isBond = instrumentType === 'Bond';
    const ctx: PlainObject = {
        sector,
        industry: pick(r, SECTORS[sector]),
        region,
        country,
        ccy,
        assetClass,
        instrumentType,
        symbol,
        underlying: isOption || instrumentType === 'Future' ? symbol : null,
        issuer: isBond ? `${symbol} Corp` : `${symbol} Inc`,
        isin: `US${Math.floor(r() * 1e10)}`,
        cusip: Math.floor(r() * 1e9)
            .toString(36)
            .toUpperCase(),
        mktVal: mv,
        notional: Math.abs(mv) * (isOption ? 4 : 1),
        grossExposure: Math.abs(mv),
        netExposure: mv,
        betaAdjExposure: Math.round(mv * (0.6 + r())),
        beta: 0.6 + r(),
        pctNav: Math.abs(mv) / 5e8,
        quantity: Math.round(Math.abs(mv) / (20 + 300 * r())),
        price: 20 + 300 * r(),
        pnlDay: Math.round(normal(r) * Math.abs(mv) * 0.02),
        pnlMtd: Math.round(normal(r) * Math.abs(mv) * 0.05),
        pnlYtd: Math.round(normal(r) * Math.abs(mv) * 0.12),
        delta: isOption ? Math.round(mv * (0.3 + 0.6 * r())) : null,
        gamma: isOption ? Math.round(mv * 0.01 * r()) : null,
        vega: isOption ? Math.round(mv * 0.02 * r()) : null,
        theta: isOption ? -Math.round(Math.abs(mv) * 0.001 * r()) : null,
        duration: isBond ? 1 + 9 * r() : null,
        dv01: isBond ? Math.round(Math.abs(mv) * 0.0005 * r()) : null,
        yield: isBond ? 0.02 + 0.05 * r() : null,
        var95: Math.round(Math.abs(mv) * 0.02 * (1 + r())),
        var99: Math.round(Math.abs(mv) * 0.03 * (1 + r())),
        return: normal(r) * 0.08,
        shockedPnl: Math.round(mv * (params?.shock ?? -0.1) * (0.6 + r())),
        orderId: `ORD-${10000 + i}`,
        commission: Math.round(50 + 500 * r()),
        confidence: Math.floor(100 * r()),
        time: Date.parse(`${params?.asOf ?? '2026-11-18'}T09:30:00Z`) + i * 300000,
        weight: r() / 10,
        day: params?.start ?? '2026-08-18',
        temp: 10 + 15 * r(),
        feelsLike: 8 + 15 * r(),
        tempMin: 5 + 10 * r(),
        tempMax: 15 + 12 * r(),
        humidity: Math.round(40 + 50 * r()),
        pressure: Math.round(1000 + 25 * r()),
        windSpeed: 2 + 12 * r(),
        windGust: 5 + 18 * r(),
        precipProbability: r(),
        precipVolume: r() < 0.5 ? 0 : 6 * r(),
        iconCode: '10d',
        city: params?.city
    };
    const row: PlainObject = {id: `${ds.name}-${i}`, _seed: r()};
    for (const f of Object.values(ds.fields)) {
        if (f.name in ctx) {
            row[f.name] = ctx[f.name];
        } else if (POOLS[f.name]) {
            row[f.name] = pick(r, POOLS[f.name]);
        } else {
            row[f.name] = f.type === 'string' ? `${f.name}-${i % 7}` : Math.round(1000 * r());
        }
    }
    if (ds.name === 'weather' || ds.name === 'prices') {
        const start = Date.parse(`${params?.start ?? '2026-11-19'}T00:00:00Z`);
        row.time = start + i * 3 * 3600000;
        row.day = new Date(ds.name === 'prices' ? start + i * 86400000 : row.time)
            .toISOString()
            .slice(0, 10);
    }
    return row;
}

/** The value of a field instance on a row, seeded by the row and the instance's params. */
function instanceValue(row: PlainObject, f: BlueprintFieldInstance): unknown {
    const r = rng(`${row._seed}:${JSON.stringify(f)}`);
    switch (f.field) {
        case 'return':
            return normal(r) * 0.08;
        case 'shockedPnl':
            return Math.round(row.mktVal * ((f.params?.shock as number) ?? -0.1) * (0.6 + r()));
        default:
            return row[f.field];
    }
}

/** A copy of a row with its numeric measures moved a little, as a live tick. */
function nudge(row: PlainObject, ds: DatasetDef, r: () => number): PlainObject {
    const ret = {...row};
    Object.entries(row).forEach(([k, v]) => {
        const f = ds.fields[k];
        if (typeof v === 'number' && !f?.isDimension && k !== 'time') {
            const next = v * (1 + (r() - 0.5) * 0.02);
            ret[k] = Number.isInteger(v) ? Math.round(next) : next;
        }
    });
    return ret;
}

function matches(row: PlainObject, f: any): boolean {
    if (!f) return true;
    if (isArray(f)) return f.every(it => matches(row, it));
    if (isArray(f.filters)) {
        const res = f.filters.map(x => matches(row, x));
        return String(f.op ?? 'AND').toUpperCase() === 'OR'
            ? res.some(Boolean)
            : res.every(Boolean);
    }
    const v = row[f.field],
        want = f.value,
        vals = isArray(want) ? want : [want];
    switch (f.op) {
        case '=':
            return vals.some(x => x == v);
        case '!=':
            return vals.every(x => x != v);
        case '>':
            return v > want;
        case '>=':
            return v >= want;
        case '<':
            return v < want;
        case '<=':
            return v <= want;
        case 'like':
            return String(v).toLowerCase().includes(String(want).toLowerCase());
        case 'not like':
            return !String(v).toLowerCase().includes(String(want).toLowerCase());
        case 'begins':
            return String(v).startsWith(want);
        case 'ends':
            return String(v).endsWith(want);
        default:
            return true;
    }
}
