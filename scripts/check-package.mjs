/**
 * Builds the package and checks what it ships. The kit is published as source, so the build is
 * the packed tarball. Fails if a source package (a top-level directory with an `index.ts` barrel,
 * at any depth) is missing from the tarball, if specs or internal files would ship, if a shipped
 * file imports the kit's test support, or if a shipped file imports a relative stylesheet that
 * does not ship. Unit tests drop stylesheets, so only this check catches a missing one before an
 * app build does.
 *
 * Run with `pnpm build`.
 */
import {execFileSync} from 'node:child_process';
import {readdirSync, readFileSync, statSync} from 'node:fs';
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
for (const file of files) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(path.join(root, file), 'utf8');
    // Static, side-effect and dynamic imports, and re-exports.
    for (const [, spec] of source.matchAll(/(?:from|import)\s*\(?'(\.{1,2}\/[^']+)'/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
        if (target.startsWith('test/')) {
            errors.push(`Imports test support: ${file} imports ${spec}`);
        }
    }
    for (const [, spec] of source.matchAll(/^import '(\.{1,2}\/[^']+\.scss)';/gm)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
        if (!files.has(target)) errors.push(`Missing stylesheet: ${file} imports ${spec}`);
    }
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
