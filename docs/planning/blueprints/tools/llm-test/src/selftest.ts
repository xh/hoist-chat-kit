import fs from 'node:fs';
import path from 'node:path';
import {applyOps, validate} from './library.ts';
import {loadBlueprint, PLANNING_DIR} from './load.ts';
import {SCENARIOS} from './scenarios.ts';

const ARTIFACTS = {art_7f2: 'positions', art_9c4: 'weather', art_3b8: 'fundSummary'};
let failed = 0;

for (const file of fs.readdirSync(path.join(PLANNING_DIR, 'blueprints')).sort()) {
    if (!file.endsWith('.json')) continue;
    const bp = loadBlueprint(file);
    if (!bp.elements) continue;
    const issues = validate(bp, {artifacts: ARTIFACTS, isAnswer: /answer|segment/.test(file)});
    const hasErrors = issues.some(i => i.severity === 'error');
    console.log(`${hasErrors ? 'FAIL' : issues.length ? 'warn' : 'ok  '} ${file}`);
    issues.forEach(i => console.log(`     ${i.severity} ${i.code} ${i.path}: ${i.message}`));
    if (issues.some(i => i.severity === 'error')) failed++;
}

// The hand-written edits apply to their blueprints and keep them valid.
const p2 = loadBlueprint('p2-linked-dashboard.json'),
    p4 = applyOps(p2, loadBlueprint('p4-edit.json').ops),
    w3b = applyOps(loadBlueprint('w2-two-cities.json'), loadBlueprint('w3-add-chicago.json').ops);
const w3bIssues = w3b.result ? validate(w3b.result, {artifacts: ARTIFACTS}) : [w3b.issue!];
console.log(`${w3bIssues.length ? 'FAIL' : 'ok  '} w3-add-chicago.json applied to w2`);
w3bIssues.forEach(i => console.log(`     ${i.code} ${i.path}: ${i.message}`));
const p3 = loadBlueprint('p3-morning-report.json'),
    applied: Record<string, ReturnType<typeof applyOps>> = {
        'p4-edit.json applied to p2': p4,
        'p7-edit.json applied to p2': applyOps(p2, loadBlueprint('p7-edit.json').ops),
        'p10-edit.json applied to p3': applyOps(p3, loadBlueprint('p10-edit.json').ops),
        'p11-edit.json applied to p2': applyOps(p2, loadBlueprint('p11-edit.json').ops),
        'p12-edit.json applied to p12-host': applyOps(loadBlueprint('p12-host.json'), loadBlueprint('p12-edit.json').ops),
        'p13-edit.json applied to p2': applyOps(p2, loadBlueprint('p13-edit.json').ops),
        'p14-edit.json applied to p2': applyOps(p2, loadBlueprint('p14-edit.json').ops),
        'p15-edit.json applied to p2': applyOps(p2, loadBlueprint('p15-edit.json').ops),
        'p16-edit.json applied to p2': applyOps(p2, loadBlueprint('p16-edit.json').ops),
        'f1-edit.json applied to p2': applyOps(p2, loadBlueprint('f1-edit.json').ops),
        'f2-edit.json applied to p2': applyOps(p2, loadBlueprint('f2-edit.json').ops)
    };
let editsFailed = 0;
for (const [name, res] of Object.entries(applied)) {
    const issues = res.result ? validate(res.result, {artifacts: ARTIFACTS}) : [res.issue!];
    console.log(`${issues.length ? 'FAIL' : 'ok  '} ${name}`);
    issues.forEach(i => console.log(`     ${i.code} ${i.path}: ${i.message}`));
    editsFailed += issues.length;
}

// Broken copies are caught.
const broken = loadBlueprint('p3-morning-report.json');
broken.elements.ordersGrid.config.columnState.push('bogus');
broken.elements.posGrid.config.groupBy = ['mktVal'];
broken.variables.selection.setBy.output = 'nope';
broken.elements.tabs.children.push({id: 'ghost', title: 'Ghost'});
const caught = validate(broken, {artifacts: ARTIFACTS}).map(i => i.code);
const expected = ['field.unknown', 'field.notDimension', 'variable.unknownOutput', 'structure.unknownChild'];
const missed = expected.filter(c => !caught.includes(c));
console.log(`${missed.length ? 'FAIL' : 'ok  '} broken copy caught: ${expected.join(', ')}${missed.length ? ` (missed ${missed.join(', ')})` : ''}`);

// Paths never index arrays, and renameId follows references.
const arr = applyOps(p2, [{op: 'set', path: '/elements/dashboard/children/0/w', value: 3}]);
console.log(`${arr.issue ? 'ok  ' : 'FAIL'} array index refused`);
const ren = applyOps(p2, [{op: 'renameId', kind: 'element', from: 'posGrid', to: 'positionsGrid'}]);
const renOk = ren.result && !validate(ren.result, {artifacts: ARTIFACTS}).length && (ren.result.variables!.selection.setBy as any).element === 'positionsGrid';
console.log(`${renOk ? 'ok  ' : 'FAIL'} renameId keeps the blueprint valid`);

// The scenario checks pass on the hand-written answers.
const expected_: Record<string, any> = {
    P1: {blueprint: loadBlueprint('p1-one-grid.json'), segments: [], replies: ['I can make the city a prompt.']},
    P2: {blueprint: p2, segments: [], replies: ['I can make the city a prompt.']},
    P3: {blueprint: loadBlueprint('p3-morning-report.json'), segments: [], replies: ['I can make the city a prompt.']},
    P4: {blueprint: p4.result, segments: [loadBlueprint('p4-answer.json')], replies: [''], calls: ['query_dataset', 'show_ui', 'request_design_mode', 'read_answer', 'edit_blueprint']},
    P5: {blueprint: loadBlueprint('p5-risk-report.json'), segments: [], replies: ['I can make the city a prompt.']},
    W1: {blueprint: loadBlueprint('w1-one-city.json'), segments: [], replies: ['I can make the city a prompt.']},
    W2: {blueprint: loadBlueprint('w2-two-cities.json'), segments: [], replies: ['I can make the city a prompt.']},
    W3: {blueprint: loadBlueprint('w2-two-cities.json'), segments: [loadBlueprint('w3-segment-1.json'), loadBlueprint('w3-segment-2.json')], replies: ['']},
    P6: {blueprint: loadBlueprint('p6-fund-overview.json'), segments: [], replies: ['']},
    P7: {blueprint: applied['p7-edit.json applied to p2'].result, segments: [], replies: ['']},
    P8: {blueprint: loadBlueprint('p8-joined-positions.json'), segments: [], replies: ['']},
    P9: {blueprint: loadBlueprint('p9-heatmap-grid.json'), segments: [], replies: ['']},
    P10: {blueprint: applied['p10-edit.json applied to p3'].result, segments: [], replies: ['']},
    P11: {blueprint: applied['p11-edit.json applied to p2'].result, segments: [loadBlueprint('p11-answer.json')], replies: [''], calls: ['query_dataset', 'show_ui', 'request_design_mode', 'read_answer', 'edit_blueprint']},
    W4: {blueprint: loadBlueprint('w4-day-two-axes.json'), segments: [], replies: ['']},
    W5: {blueprint: loadBlueprint('w5-current-conditions.json'), segments: [], replies: ['']},
    P13: {blueprint: applied['p13-edit.json applied to p2'].result, segments: [], replies: ['']},
    P14: {blueprint: applied['p14-edit.json applied to p2'].result, segments: [], replies: ['']},
    P15: {blueprint: applied['p15-edit.json applied to p2'].result, segments: [], replies: ['']},
    P16: {blueprint: applied['p16-edit.json applied to p2'].result, segments: [], replies: [''], calls: ['list_blueprints', 'edit_blueprint']},
    F1: {
        blueprint: applied['f1-edit.json applied to p2'].result,
        segments: [],
        replies: [''],
        calls: ['edit_blueprint', 'request_feature'],
        featureRequests: [{summary: 'A world map widget that shades countries by a measure', category: 'widget', userWords: 'Show my positions on a world map', workaround: 'Added day P&L by region as a column chart.'}]
    },
    F2: {blueprint: applied['f2-edit.json applied to p2'].result, segments: [], replies: [''], calls: ['edit_blueprint']},
    U1: {
        blueprint: applyOps(p2, [{op: 'set', path: '/elements/dashboard/children', value: p2.elements.dashboard.children.map((it: any) => (it.id === 'posGrid' ? {...it, h: 10} : it))}]).result,
        segments: [],
        replies: ['I made posGrid taller.'],
        calls: ['edit_blueprint']
    },
    U2: {blueprint: p2, segments: [], replies: ['Which widget should I make taller?'], calls: []},
    P12: {blueprint: applied['p12-edit.json applied to p12-host'].result, segments: [], replies: ['']},
    P11o: {blueprint: applied['p11-edit.json applied to p2'].result, segments: [loadBlueprint('p11-answer.json')], replies: [''], calls: ['query_dataset', 'show_ui', 'request_design_mode', 'read_answer', 'edit_blueprint']},
    W3b: {blueprint: w3b.result, segments: [loadBlueprint('w3-segment-1.json'), loadBlueprint('w3-segment-2.json')], replies: [''], calls: ['query_dataset', 'show_ui', 'request_design_mode', 'read_answer', 'edit_blueprint']}
};
let oracleFailed = 0;
for (const s of SCENARIOS) {
    const bad = s.checks.filter(([, fn]) => !fn(expected_[s.id])).map(([n]) => n);
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${s.id} checks pass on the hand-written answer${bad.length ? `: ${bad.join('; ')}` : ''}`);
    oracleFailed += bad.length;
}

process.exit(oracleFailed || failed || missed.length || editsFailed || w3bIssues.length || !arr.issue || !renOk ? 1 : 0);
