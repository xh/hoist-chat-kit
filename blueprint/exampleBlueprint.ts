import {uniq, uniqBy} from 'lodash';
import type {Blueprint, BlueprintElement} from './Blueprint';
import type {WidgetSpec} from './BlueprintRegistry';
import type {DataCatalog} from './DataCatalog';
import {childIds} from './impl/elements';

// Plain data and pure functions only, so the harness under plain Node can load these.

/**
 * A widget's `example` as a blueprint of its own, for a registry browser to render: the example as
 * the root, with what its `exampleBlueprint` names, a source over each dataset its elements read,
 * and a prompted variable, defaulting to today, for each required date parameter.
 *
 * @returns the blueprint, or null with the child references nothing gives, if any.
 */
export function exampleBlueprintOf(
    spec: Pick<WidgetSpec, 'name' | 'example' | 'exampleBlueprint'>,
    catalog: Pick<DataCatalog, 'getDataset'>
): {blueprint: Blueprint; missing: string[]} {
    if (!spec?.example) return {blueprint: null, missing: []};
    const {elements: extraElements = {}, ...extra} = spec.exampleBlueprint ?? {},
        elements = {[spec.name]: spec.example, ...extraElements} as Record<
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
    return {
        blueprint: {
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
        } as Blueprint,
        missing: []
    };
}
