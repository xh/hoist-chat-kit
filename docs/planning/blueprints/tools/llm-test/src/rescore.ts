/** Re-run the scenario checks and validation over saved results. Usage: pnpm rescore <results dir>... */
import fs from 'node:fs';
import path from 'node:path';
import {SCENARIOS} from './scenarios.ts';
import {validate} from './library.ts';

for (const dir of process.argv.slice(2)) {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')),
            s = SCENARIOS.find(x => x.id === r.scenario)!,
            o = {blueprint: r.blueprint, segments: r.segments, replies: r.replies},
            failed = s.checks.filter(([, fn]) => !fn(o)).map(([n]) => n),
            errors = validate(r.blueprint, {artifacts: Object.fromEntries((JSON.stringify(r.messages).match(/art_[0-9a-f]+/g) ?? []).map(a => [a, 'positions']))}).filter(i => i.severity === 'error' && i.code !== 'source.unknownArtifact');
        console.log(`${r.scenario} ${r.model.padEnd(6)} ${s.checks.length - failed.length}/${s.checks.length}${failed.length ? `  failed: ${failed.join('; ')}` : ''}${errors.length ? `  errors: ${errors.map(e => `${e.code} ${e.path}`).join(', ')}` : ''}`);
    }
}
