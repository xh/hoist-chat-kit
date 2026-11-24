import {cloneDeep, uniq, uniqBy} from 'lodash';
import type {Blueprint, BlueprintElement} from './Blueprint';
import type {WidgetSpec} from './BlueprintRegistry';
import type {DataCatalog} from './DataCatalog';
import {childIds} from './impl/elements';

// Plain data and pure functions only, so the harness under plain Node can load these.

/**
 * A widget's `example` as a blueprint of its own, for a registry browser to render: the example as
 * the root, with what its `exampleBlueprint` names, a source over each dataset its elements read,
 * and a prompted variable, defaulting to today, for each required date parameter. Where a variable
 * is prompted, the root is a panel with a `variableInput` for each in its tbar, over the example,
 * or beside them in the tbar for a widget that fits a toolbar.
 *
 * @returns the blueprint, or null with the child references nothing gives, if any.
 */
export function exampleBlueprintOf(
    spec: Pick<WidgetSpec, 'name' | 'example' | 'exampleBlueprint' | 'fits'>,
    catalog: Pick<DataCatalog, 'getDataset'>
): {blueprint: Blueprint; missing: string[]} {
    if (!spec?.example) return {blueprint: null, missing: []};
    // A copy, so a caller that changes the blueprint never changes the registry's example.
    const {elements: extraElements = {}, ...extra} = cloneDeep(spec.exampleBlueprint ?? {}),
        elements = {[spec.name]: cloneDeep(spec.example), ...extraElements} as Record<
            string,
            BlueprintElement
        >,
        missing = uniq(
            Object.values(elements)
                .flatMap(it => childIds(it))
                .filter(id => !Object.hasOwn(elements, id))
        );
    if (missing.length) return {blueprint: null, missing};

    const datasets = uniq(
            Object.values(elements)
                .map(it => it.config?.source)
                .filter(it => typeof it === 'string' && catalog.getDataset(it))
        ) as string[],
        datesOf = (ds: string) =>
            Object.entries(catalog.getDataset(ds).params ?? {}).filter(
                ([, it]) => it.required && it.type === 'localDate'
            ),
        dates = uniqBy(datasets.flatMap(datesOf), ([name]) => name);
    const ret = {
        ...extra,
        root: spec.name,
        elements,
        ...(datasets.length
            ? {
                  sources: Object.fromEntries(
                      datasets.map(ds => [
                          ds,
                          {
                              dataset: ds,
                              params: Object.fromEntries(
                                  datesOf(ds).map(([name]) => [name, {$var: name}])
                              )
                          }
                      ])
                  )
              }
            : {}),
        ...(dates.length || extra.variables
            ? {
                  variables: {
                      ...Object.fromEntries(
                          dates.map(([name, param]) => [
                              name,
                              {
                                  type: 'localDate',
                                  ...(param.label ? {label: param.label} : {}),
                                  setBy: 'prompt',
                                  default: {resolver: 'today'}
                              }
                          ])
                      ),
                      ...extra.variables
                  }
              }
            : {})
    } as Blueprint;
    const inToolbar = !!spec.fits?.includes('toolbar') && !spec.fits.includes('content');
    return {blueprint: withInputs(ret, inToolbar), missing: []};
}

//------------------
// Implementation
//------------------
// The blueprint under a panel with an input for each prompted variable that none shows yet.
function withInputs(bp: Blueprint, inToolbar: boolean): Blueprint {
    const shown = new Set(
            Object.values(bp.elements)
                .filter(it => it.component === 'variableInput')
                .map(it => it.config?.variable)
        ),
        prompted = Object.entries(bp.variables ?? {})
            .filter(([name, decl]) => decl.setBy === 'prompt' && !shown.has(name))
            .map(([name]) => name);
    if (!prompted.length) return bp;
    const inputs = prompted.map(name => [`${name}Input`, name]);
    return {
        ...bp,
        root: 'example',
        elements: {
            example: {
                component: 'panel',
                tbar: [...inputs.map(([id]) => ({id})), ...(inToolbar ? [{id: bp.root}] : [])],
                children: inToolbar ? [] : [{id: bp.root}]
            },
            ...Object.fromEntries(
                inputs.map(([id, variable]) => [
                    id,
                    {component: 'variableInput', config: {variable}}
                ])
            ),
            ...bp.elements
        }
    };
}
