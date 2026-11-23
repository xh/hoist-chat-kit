import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {uniq} from 'lodash';
import {describe, expect, it} from 'vitest';

// Checks the theme variables, not product code: an app that overrides a `--xh-chat-*` variable
// expects the chat to change, so every variable the kit declares must be one that it reads.

const root = path.resolve(import.meta.dirname, '..'),
    vars = readFileSync(path.join(root, 'styles/vars.scss'), 'utf8');

describe('styles', () => {
    it('reads every --xh-chat-* variable it declares', () => {
        const sources = findSources(root).map(file => readFileSync(file, 'utf8')),
            declared = [...vars.matchAll(/^\s*(--xh-chat-[a-z0-9-]+):/gm)].map(it => it[1]),
            unread = declared.filter(
                name =>
                    !APP_HOOKS.includes(name) &&
                    !PENDING.includes(name) &&
                    !sources.some(it => isRead(it, name))
            );
        expect(unread).toEqual([]);
    });

    it('reads only --xh-* variables that Hoist or the kit declares', () => {
        const declared = new Set(
                [...findStyles(hoistRoot), ...findSources(root)].flatMap(file =>
                    [...readFileSync(file, 'utf8').matchAll(/(--xh-[a-z0-9-]+)['"]?\s*:/g)].map(
                        it => it[1]
                    )
                )
            ),
            undeclared = findSources(root)
                .filter(file => file.endsWith('.scss'))
                .flatMap(file =>
                    // A name Sass builds, such as `--xh-intent-#{$intent}`, is left out.
                    [
                        ...readFileSync(file, 'utf8').matchAll(
                            /var\(\s*(--xh-[a-z0-9-]+)(?![a-z0-9-]|#)/g
                        )
                    ].map(it => `${path.relative(root, file)}: ${it[1]}`)
                )
                .filter(it => !declared.has(it.split(': ')[1]));
        expect(uniq(undeclared)).toEqual([]);
    });

    it('draws no accent rail down one side of a card or row, as Hoist marks a selection by a tint', () => {
        const rails = findSources(root)
            .filter(file => file.endsWith('.scss'))
            .flatMap(file =>
                readFileSync(file, 'utf8')
                    .split('\n')
                    .map((line, idx) => ({at: `${path.relative(root, file)}:${idx + 1}`, line}))
            )
            .filter(({line}) => SIDE_RAIL.some(it => it.test(line)))
            .map(it => it.at);
        expect(rails).toEqual([]);
    });

    it("keeps a designer's element wrapper layout-neutral, so a designer lays out as a reader does", () => {
        const scss = readFileSync(
                path.join(root, 'desktop/cmp/blueprint/BlueprintView.scss'),
                'utf8'
            ),
            body = scss.match(/&__design-element \{([^}]*)\}/)[1],
            rules = body
                .split('\n')
                .map(it => it.trim())
                .filter(it => it && !it.startsWith('//'));
        expect(rules).toEqual(['display: contents;']);
        // Nothing else styles the wrapper's own box.
        const others = findSources(root)
            .filter(file => file.endsWith('.scss'))
            .flatMap(
                file => readFileSync(file, 'utf8').match(/[^\n{}]*design-element[^\n{]*\{/g) ?? []
            )
            .map(it => it.trim())
            .filter(
                it => !/design-element(:[a-z-()]+)*\s*>/.test(it) && it !== '&__design-element {'
            );
        expect(others).toEqual(['.xh-blueprint-alt-hold .xh-blueprint-view__design-element {']);
    });
});

// A 2px or wider rule down the left or right side: an inset shadow offset sideways, or a border.
const SIDE_RAIL = [
    /box-shadow:\s*inset\s+-?[2-9]\d*px\s+0\s+0/,
    /border-(left|right|inline-start|inline-end)(-width)?:\s*[2-9]\d*px/
];

//------------------
// Implementation
//------------------
// Variables for the app's own components to read, such as its document renderer.
const APP_HOOKS = ['--xh-chat-viewer-page-bg', '--xh-chat-viewer-page-text-color'];

// Variables of design behavior that components do not build yet. Empty when all are built.
const PENDING: string[] = [];

const SKIP_DIRS = new Set(['node_modules', 'docs', 'scripts', 'test']);

const hoistRoot = path.join(root, 'node_modules/@xh/hoist');

// Every stylesheet of Hoist's, where it declares its variables.
function findStyles(dir: string): string[] {
    return readdirSync(dir, {recursive: true, encoding: 'utf8'})
        .filter(it => it.endsWith('.scss') && !it.includes('node_modules'))
        .map(it => path.join(dir, it));
}

function isRead(source: string, name: string): boolean {
    return new RegExp(`var\\(\\s*${name}[\\s,)]|'${name}'`).test(source);
}

function findSources(dir: string, rel = ''): string[] {
    const ret: string[] = [];
    for (const name of readdirSync(dir)) {
        if (name.startsWith('.') || (!rel && SKIP_DIRS.has(name))) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
            ret.push(...findSources(full, rel ? `${rel}/${name}` : name));
        } else if (/\.(scss|ts)$/.test(name) && !name.endsWith('.spec.ts')) {
            ret.push(full);
        }
    }
    return ret;
}
