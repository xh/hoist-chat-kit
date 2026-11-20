import type {JoinDecl} from '../Blueprint';
import type {DatasetDef, FieldDef} from '../DataCatalog';

// Plain data and pure functions only, so a validator under plain Node can load these.

/** A field a join brings onto its primary's rows, and how - see `joinFields()`. */
export interface JoinField {
    /** Its name on the primary: its alias, else its own. */
    name: string;
    /** Its name on the secondary. */
    field: string;
    /** The secondary's field, renamed to its name on the primary. */
    def: FieldDef;
    /**
     * `row` copies the value onto each primary row, to aggregate as the field does. `keyed` shows
     * it only on rows that pin the join's key, through a `KeyedAggregator`.
     */
    mode: 'row' | 'keyed';
    /** True if the secondary is finer than the join's key, so it is reduced to the key first. */
    reduce: boolean;
}

/**
 * A join's grain, from the two datasets' keys: `unique` if each key matches at most one secondary
 * row, `sameGrain` if each matches at most one primary row. Null if either dataset has no key.
 */
export function joinGrain(
    join: JoinDecl,
    primary: DatasetDef,
    secondary: DatasetDef
): {unique: boolean; sameGrain: boolean} {
    if (!primary?.key?.length || !secondary?.key?.length) return null;
    const on = join.on ?? {};
    return {
        unique: secondary.key.every(it => Object.values(on).includes(it)),
        sameGrain: primary.key.every(it => Object.hasOwn(on, it))
    };
}

/**
 * True for a field a join copies onto each row whatever the grain: a dimension, a `UNIQUE` field,
 * or one with no aggregator.
 */
export function isJoinAttribute(def: FieldDef): boolean {
    return !!def.isDimension || def.aggregator == null || def.aggregator === 'UNIQUE';
}

/**
 * Each field a join brings that its secondary has, with its mode. Empty if either dataset has no
 * key. A secondary finer than the key is reduced to it first, after which it is unique at the key.
 */
export function joinFields(
    join: JoinDecl,
    primary: DatasetDef,
    secondary: DatasetDef
): JoinField[] {
    const grain = joinGrain(join, primary, secondary);
    if (!grain) return [];
    return (join.fields ?? [])
        .filter(it => secondary.fields[it])
        .map(field => {
            const name = join.as?.[field] ?? field,
                def = {...secondary.fields[field], name},
                mode = isJoinAttribute(def) || grain.sameGrain ? 'row' : 'keyed';
            return {name, field, def, mode, reduce: !grain.unique};
        });
}
