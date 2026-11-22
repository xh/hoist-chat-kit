import type {PlainObject} from '@xh/hoist/core';
import {cloneDeep} from 'lodash';
import fs from 'node:fs';
import path from 'node:path';
import type {Blueprint, DataCatalogJson, WidgetSpec} from '../blueprint';
import {BlueprintRegistry, DataCatalog} from '../blueprint';
import portfolioJson from '../docs/planning/blueprints/catalogs/portfolio.json';
import weatherJson from '../docs/planning/blueprints/catalogs/weather.json';
import registryJson from '../docs/planning/blueprints/registry.json';

/** The planning folder's scenario blueprints, catalogs and registry, for blueprint specs. */
export const PLANNING_DIR = path.resolve(__dirname, '../docs/planning/blueprints');

export const PLANNING_REGISTRY: PlainObject = registryJson;

export const portfolioCatalog = new DataCatalog(portfolioJson as DataCatalogJson),
    weatherCatalog = new DataCatalog(weatherJson as DataCatalogJson);

/** The artifacts the scenario answers name, with the dataset behind each. */
export const ARTIFACTS = {art_7f2: 'positions', art_9c4: 'weather', art_3b8: 'fundSummary'};

/** A registry with the built-ins, plus the app entries the scenarios use, from `registry.json`. */
export function scenarioRegistry(): BlueprintRegistry {
    const app = (coll: string) =>
        Object.entries<PlainObject>(PLANNING_REGISTRY[coll]).filter(([, it]) => it.app);
    return new BlueprintRegistry({
        widgets: app('widgets').map(([name, it]) => ({name, version: 1, ...it}) as WidgetSpec),
        variableTypes: app('variableTypes').map(([name, it]) => ({name, matches: it.matches})),
        resolvers: app('resolvers').map(([name, it]) => ({
            name,
            returns: it.returns,
            args: it.args,
            resolve: () => null
        })),
        actions: app('actions').map(([name, it]) => ({
            name,
            params: it.params,
            sideEffects: it.sideEffects
        })),
        renderers: app('renderers').map(([name, it]) => ({name, appliesTo: it.appliesTo}))
    });
}

/** A fresh copy of a scenario blueprint, by file name. */
export function loadBlueprint(file: string): Blueprint {
    return cloneDeep(
        JSON.parse(fs.readFileSync(path.join(PLANNING_DIR, 'blueprints', file), 'utf8'))
    );
}

/** Every scenario file, by name. Some are edits rather than blueprints. */
export function scenarioFiles(): string[] {
    return fs
        .readdirSync(path.join(PLANNING_DIR, 'blueprints'))
        .filter(it => it.endsWith('.json'))
        .sort();
}

/** The catalog a scenario file reads: weather for the W scenarios, portfolio for the rest. */
export function catalogFor(file: string): DataCatalog {
    return file.startsWith('w') ? weatherCatalog : portfolioCatalog;
}

/** The Inspector's section bands as they read: each title, then its count and badge, if any. */
export function bandsOf(container: HTMLElement): string[] {
    return [...container.querySelectorAll('.xh-blueprint-element-inspector__card-header')].map(
        band =>
            ['__card-title', '__card-count', '__card-badge']
                .map(it => band.querySelector(`.xh-blueprint-element-inspector${it}`)?.textContent)
                .filter(Boolean)
                .join(' ')
    );
}
