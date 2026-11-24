import {describe, expect, it} from 'vitest';
import {runtimeImports} from '../../test/runtimeImports';
import {ARCHITECT_TOOLS} from './ArchitectTools';

/**
 * Document tools read only a blueprint, the catalogs and the registry, so a browser, a Node server
 * or an MCP server can run them. Their code, and the validator's, imports nothing but lodash.
 */
describe('document tools', () => {
    it('are the tools that need neither the open model nor a data provider', () => {
        const byKind = (kind: string) =>
            ARCHITECT_TOOLS.filter(it => it.kind === kind).map(it => it.name);
        expect(byKind('document')).toEqual([
            'read_blueprint',
            'describe_catalog',
            'describe_registry',
            'validate_blueprint',
            'list_blueprints',
            'find_usages'
        ]);
        expect(byKind('live')).toEqual(['edit_blueprint', 'set_variable']);
        expect(byKind('data')).toEqual(['query_dataset']);
    });

    it('import no browser, React or Hoist code, nor does the validator', () => {
        expect(runtimeImports('blueprint/architect/ArchitectTools.ts')).toEqual({
            lodash: 'blueprint/architect/ArchitectTools.ts'
        });
        expect(Object.keys(runtimeImports('blueprint/validateBlueprint.ts'))).toEqual(['lodash']);
    });

    it('would catch a runtime import, but not a type-only one', () => {
        expect(runtimeImports('blueprint/BlueprintRegistry.ts')).toHaveProperty(
            '@xh/hoist/utils/js'
        );
        expect(runtimeImports('blueprint/BlueprintRegistry.ts')).not.toHaveProperty('react');
    });
});
