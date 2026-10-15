import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
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
});

//------------------
// Implementation
//------------------
// Variables for the app's own components to read, such as its document renderer.
const APP_HOOKS = ['--xh-chat-viewer-page-bg', '--xh-chat-viewer-page-text-color'];

// TODO(D-m21): variables of design behavior that components do not yet build.
const PENDING: string[] = [];

const SKIP_DIRS = new Set(['node_modules', 'docs', 'planning', 'scripts', 'test']);

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
