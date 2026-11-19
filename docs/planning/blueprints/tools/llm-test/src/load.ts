import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PLANNING_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type Json = any;
export type Blueprint = Record<string, any>;

export interface FieldDef {
    name: string;
    label?: string;
    type: string;
    kind?: string;
    isDimension?: boolean;
    aggregator?: unknown;
    params?: Record<string, {type: string; required?: boolean}>;
    [k: string]: unknown;
}

export interface DatasetDef {
    name: string;
    catalog: string;
    label: string;
    description?: string;
    guidance?: string;
    params: Record<string, {type: string; required?: boolean; options?: {values: string[]}}>;
    fields: Record<string, FieldDef>;
}

export function readJson(rel: string): Json {
    return JSON.parse(fs.readFileSync(path.join(PLANNING_DIR, rel), 'utf8'));
}

export const registry = readJson('registry.json');
export const catalogs: Record<string, Json> = {
    portfolio: readJson('catalogs/portfolio.json'),
    weather: readJson('catalogs/weather.json')
};

/** Every dataset in every catalog, with shared fields resolved. */
export const datasets: Record<string, DatasetDef> = {};
for (const [catName, cat] of Object.entries(catalogs)) {
    const shared = Object.fromEntries(cat.fields.map((f: FieldDef) => [f.name, f]));
    for (const [name, ds] of Object.entries<any>(cat.datasets)) {
        const fields: Record<string, FieldDef> = {};
        for (const f of ds.fields) {
            const def = typeof f === 'string' ? shared[f] : f;
            fields[def.name] = def;
        }
        datasets[name] = {name, catalog: catName, label: ds.label, description: ds.description, guidance: ds.guidance, params: ds.params, fields};
    }
}

export function loadBlueprint(file: string): Blueprint {
    return readJson(`blueprints/${file}`);
}

export const clone = <T>(o: T): T => structuredClone(o);
