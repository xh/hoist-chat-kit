/**
 * Builds the package and checks what it ships. The kit is published as source, so the build is
 * the packed tarball. Fails if a source package (a top-level directory with an `index.ts` barrel,
 * at any depth) is missing from the tarball, or if specs or internal files would ship.
 *
 * Run with `pnpm build`.
 */
import {execFileSync} from 'node:child_process';
import {readdirSync, statSync} from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..'),
    skipDirs = new Set(['node_modules', 'build', 'docs', 'scripts', 'test', 'planning']),
    forbidden = [/\.spec\.tsx?$/, /^planning\//, /^test\//, /^scripts\//, /^\./];

const packed = JSON.parse(
        execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
            cwd: root,
            encoding: 'utf8'
        })
    )[0],
    files = new Set(packed.files.map(it => it.path));

const errors = [];

for (const barrel of findBarrels(root)) {
    if (!files.has(barrel)) errors.push(`Source package not shipped: ${barrel}`);
}
for (const file of files) {
    if (forbidden.some(re => re.test(file))) errors.push(`Internal file would ship: ${file}`);
}

if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(
    `${packed.name}@${packed.version}: ${packed.entryCount} files, ` +
        `${(packed.unpackedSize / 1024).toFixed(0)} KB unpacked - OK`
);

//------------------
// Implementation
//------------------
function findBarrels(dir, rel = '') {
    const ret = [];
    for (const name of readdirSync(dir)) {
        if (name.startsWith('.') || (!rel && skipDirs.has(name))) continue;
        const full = path.join(dir, name),
            relPath = rel ? `${rel}/${name}` : name;
        if (statSync(full).isDirectory()) {
            ret.push(...findBarrels(full, relPath));
        } else if (rel && name === 'index.ts') {
            ret.push(relPath);
        }
    }
    return ret;
}
