import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

// Checks the doc index and registry, not product code: agents and readers find a package's docs
// through them, and a table row pasted over another breaks that silently.

const root = path.resolve(import.meta.dirname, '..'),
    index = readFileSync(path.join(root, 'docs/README.md'), 'utf8'),
    registry = JSON.parse(readFileSync(path.join(root, 'docs/doc-registry.json'), 'utf8'));

describe('docs', () => {
    it('gives every row of each index table as many cells as its header', () => {
        const problems = getTables(index).flatMap(({header, rows}) =>
            rows
                .filter(row => countCells(row) !== countCells(header))
                .map(row => `${countCells(row)} cells, header has ${countCells(header)}: ${row}`)
        );
        expect(problems).toEqual([]);
    });

    it('lists every package README in the index and the registry', () => {
        const ids = registry.entries.map(it => it.id),
            packages = index.slice(index.indexOf('## Package Documentation'));
        findPackageReadmes(root).forEach(file => {
            expect(packages, `docs/README.md has no package row for ${file}`).toContain(
                `| [\`/${path.dirname(file)}/\`](../${file})`
            );
            expect(ids, `doc-registry.json has no entry for ${file}`).toContain(file);
        });
    });

    it('registers only docs that exist', () => {
        registry.entries.forEach(({id}) =>
            expect(existsSync(path.join(root, id)), `${id} does not exist`).toBe(true)
        );
    });
});

//------------------
// Implementation
//------------------
const SKIP_DIRS = new Set(['node_modules', 'docs', 'planning', 'scripts', 'test']);

function getTables(markdown: string): {header: string; rows: string[]}[] {
    const ret: {header: string; rows: string[]}[] = [],
        lines = markdown.split('\n');
    lines.forEach((line, idx) => {
        if (!/^\|[-| ]+\|$/.test(line) || !lines[idx - 1]?.startsWith('|')) return;
        const rows = [];
        for (let i = idx + 1; lines[i]?.startsWith('|'); i++) rows.push(lines[i]);
        ret.push({header: lines[idx - 1], rows});
    });
    return ret;
}

// Cells of a table row - pipes inside code spans do not split cells.
function countCells(row: string): number {
    return row.replace(/`[^`]*`/g, '').split('|').length - 2;
}

function findPackageReadmes(dir: string, rel = ''): string[] {
    const ret: string[] = [];
    for (const name of readdirSync(dir)) {
        if (name.startsWith('.') || (!rel && SKIP_DIRS.has(name))) continue;
        const full = path.join(dir, name),
            relPath = rel ? `${rel}/${name}` : name;
        if (statSync(full).isDirectory()) {
            ret.push(...findPackageReadmes(full, relPath));
        } else if (rel && name === 'README.md') {
            ret.push(relPath);
        }
    }
    return ret;
}
