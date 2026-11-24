import fs from 'node:fs';
import path from 'node:path';

/**
 * The packages a module's runtime import graph reaches, each with the first file that imports it.
 * Type-only imports are skipped, as they compile away. Reads imports as Prettier formats them.
 */
export function runtimeImports(entry: string): Record<string, string> {
    const seen = new Set<string>(),
        ret: Record<string, string> = {},
        walk = (file: string) => {
            if (seen.has(file)) return;
            seen.add(file);
            for (const [, typeKw, clause, spec] of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
                const names = clause
                    ?.match(/^\{([\s\S]*)\}$/)?.[1]
                    .split(',')
                    .map(it => it.trim());
                if (typeKw || names?.filter(Boolean).every(it => it.startsWith('type '))) continue;
                if (!spec.startsWith('.')) {
                    ret[spec] ??= path.relative(ROOT, file);
                    continue;
                }
                const target = resolve(file, spec);
                if (target) walk(target);
            }
        };
    walk(path.resolve(ROOT, entry));
    return ret;
}

const ROOT = path.resolve(__dirname, '..'),
    IMPORT = /^(?:import|export)\s+(type\s+)?(?:([\s\S]*?)\s+from\s+)?'([^']+)';/gm;

function resolve(from: string, spec: string): string {
    const base = path.resolve(path.dirname(from), spec);
    return (
        [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(it => fs.existsSync(it)) ??
        null
    );
}
