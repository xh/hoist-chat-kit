import json, glob, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..') + '/'
cats = {n: json.load(open(f'{BASE}catalogs/{n}.json')) for n in ['portfolio', 'weather']}
DATASETS, ROOTFIELDS = {}, {}
for c in cats.values():
    root = {f['name']: f for f in c['fields']}
    for dn, d in c['datasets'].items():
        DATASETS[dn] = {
            'params': d['params'],
            'fields': {(f if isinstance(f, str) else f['name']): (root[f] if isinstance(f, str) else f) for f in d['fields']}
        }

# Spec-level registries used by the scenarios.
WIDGETS = {
    'dashboard': {}, 'tabContainer': {}, 'panes': {}, 'panel': {}, 'box': {}, 'separator': {}, 'spacer': {}, 'markdown': {}, 'callout': {}, 'toolbar': {}, 'select': {'value': True}, 'dateInput': {'value': True}, 'dateRangePicker': {'value': True}, 'numberInput': {'value': True}, 'textInput': {'value': True}, 'switchInput': {'value': True}, 'variableInput': {}, 'slider': {'value': True}, 'filterChooser': {'value': True}, 'cubeGrid': {'outputs': {'selection', 'selected'}}, 'chart': {'outputs': {'selection'}}, 'treemap': {'outputs': {'selection'}}, 'propertyTable': {}, 'heatmap': {'outputs': {'selection'}}, 'gauge': {},
    'tileFrame': {}, 'statCard': {}, 'groupingChooser': {'value': True}, 'buttonGroup': {}, 'buttonGroupInput': {'value': True}, 'presetSelector': {},
    'toolbox.portfolioBuilder': {'value': True}
}
ACTIONS = {'setVariable', 'resetVariable', 'refresh', 'navigate', 'openUrl', 'toolbox.publishToPmPack'}
issues = []


def issue(f, msg):
    issues.append(f'{os.path.basename(f)}: {msg}')


def walk(o, fn, path=''):
    fn(o, path)
    if isinstance(o, dict):
        for k, v in o.items():
            walk(v, fn, f'{path}/{k}')
    elif isinstance(o, list):
        for i, v in enumerate(o):
            walk(v, fn, f'{path}/{i}')


def is_ref_list(v):
    return isinstance(v, list) and v and all(isinstance(it, dict) and isinstance(it.get('id'), str) for it in v)


def slot_refs(el):
    """Every child reference in an element's slot lists, and in its child references' own."""
    own = [refs for k, refs in el.items() if k not in ('component', 'config', 'personalizable') and is_ref_list(refs)]
    nested = [refs for ch in el.get('children', []) for k, refs in ch.items() if k != 'id' and is_ref_list(refs)]
    return [ref for refs in own + nested for ref in refs]


def check(f, bp, artifacts):
    variables = bp.get('variables', {})
    sources = bp.get('sources', {})
    elements = bp['elements']

    # Structure: root, children, one parent each, reachable.
    if bp['root'] not in elements:
        issue(f, f"root '{bp['root']}' missing")
    parent = {}
    for eid, el in elements.items():
        if el['component'] not in WIDGETS:
            issue(f, f'{eid}: unknown component {el["component"]}')
        for ch in slot_refs(el):
            if ch['id'] not in elements:
                issue(f, f'{eid}: child {ch["id"]} missing')
            if ch['id'] in parent:
                issue(f, f'{ch["id"]} has two parents')
            parent[ch['id']] = eid
    for eid in elements:
        if eid != bp['root'] and eid not in parent:
            issue(f, f'{eid} is not placed')

    # Variables and their writers.
    for vn, v in variables.items():
        sb = v.get('setBy')
        writers = sb if isinstance(sb, list) else [sb] if isinstance(sb, dict) else []
        for w in writers:
            if w['element'] not in elements:
                issue(f, f'variable {vn}: writer {w["element"]} missing')
                continue
            spec = WIDGETS[elements[w['element']]['component']]
            if 'output' in w and w['output'] not in spec.get('outputs', set()):
                issue(f, f'variable {vn}: {w["element"]} has no output {w["output"]}')
            if 'output' not in w and not spec.get('value'):
                issue(f, f'variable {vn}: {w["element"]} cannot show a value')
        if len(writers) > 1 and v['type'] != 'filter':
            issue(f, f'variable {vn}: several writers on a non-filter')
        if v.get('default', {}).get('personalizable') and (sb == 'resolver' or any('output' in w for w in writers)):
            issue(f, f'variable {vn}: personalizable but set by an output or resolver')

    def var_refs(o, path):
        if isinstance(o, dict) and '$var' in o and o['$var'] not in variables:
            issue(f, f'{path}: unknown variable {o["$var"]}')
    walk(bp, var_refs)

    # Sources: dataset, parameters, instances.
    source_fields = {}
    for sn, s in sources.items():
        if 'dataset' in s:
            ds = DATASETS.get(s['dataset'])
            if not ds:
                issue(f, f'source {sn}: unknown dataset {s["dataset"]}')
                continue
            for pn in s.get('params', {}):
                if pn not in ds['params']:
                    issue(f, f'source {sn}: unknown param {pn}')
            for pn, pd in ds['params'].items():
                if pd.get('required') and pn not in s.get('params', {}):
                    issue(f, f'source {sn}: required param {pn} unbound')
            fields = dict(ds['fields'])
            for iname, inst in s.get('fields', {}).items():
                base = ds['fields'].get(inst['field'])
                if not base or 'params' not in base:
                    issue(f, f'source {sn}: instance {iname} of non-parameterized {inst["field"]}')
                else:
                    fields[iname] = base
            source_fields[sn] = fields
        elif 'artifact' in s:
            source_fields[sn] = DATASETS[artifacts[s['artifact']]]['fields']
        elif 'inline' in s:
            source_fields[sn] = {x['name']: x for x in s['inline']['fields']}

    # A join adds the secondary's fields to the primary, by alias.
    for sn, s in sources.items():
        for j in s.get('joins', []):
            other = source_fields.get(j.get('source'), {})
            for name in j.get('fields', []):
                if name in other:
                    source_fields[sn][j.get('as', {}).get(name, name)] = other[name]

    # Field references in widget config.
    for eid, el in elements.items():
        cfg = el.get('config', {})
        sn = cfg.get('source')
        if sn is None:
            continue
        if sn not in sources:
            issue(f, f'{eid}: unknown source {sn}')
            continue
        fields = source_fields[sn]

        def need(name, what, dim=False):
            if name not in fields:
                issue(f, f'{eid}: {what} {name} not in source {sn}')
            elif dim and not fields[name].get('isDimension'):
                issue(f, f'{eid}: {what} {name} is not a dimension')

        gb = cfg.get('groupBy')
        if isinstance(gb, list):
            for g in gb:
                need(g, 'groupBy', dim=True)
        for c in cfg.get('columnState', []):
            need(c if isinstance(c, str) else c['field'], 'column')
        if 'x' in cfg:
            need(cfg['x'], 'x')
        y = cfg.get('y', [])
        for name in [y] if isinstance(y, str) else y:
            need(name, 'y')
        for key in ('field', 'deltaField'):
            if key in cfg:
                need(cfg[key], key)
        if isinstance(cfg.get('sortBy'), str):
            need(cfg['sortBy'].split('|')[0], 'sortBy')

        def filt(o, path):
            if isinstance(o, dict) and 'field' in o and 'op' in o:
                need(o['field'], 'filter field')
        walk(cfg.get('filter'), filt)
    for el in elements.values():
        for b in el.get('config', {}).get('buttons', []):
            if b['action']['type'] not in ACTIONS:
                issue(f, f'unknown action {b["action"]["type"]}')

    # Presets: each group's element paths name an element, and leave its config.
    for gname, group in (bp.get('presets') or {}).items():
        for c in group['controls']:
            parts = c['path'].strip('/').split('/')
            if parts[0] != 'elements':
                continue
            el = elements.get(parts[1])
            if not el:
                issue(f, f'preset path {c["path"]} names no element')
                continue
            if parts[3] in el.get('config', {}):
                issue(f, f'preset path {c["path"]} is still in the element config')
            for iname, item in group['items'].items():
                o = item['set']
                for p in parts:
                    o = o.get(p) if isinstance(o, dict) else None
                if o is None:
                    issue(f, f'preset {gname}.{iname} does not set {c["path"]}')
                elif isinstance(o, list):
                    for col in o:
                        n = col if isinstance(col, str) else col.get('colId', col.get('field'))
                        src = el['config']['source']
                        if n not in source_fields[src]:
                            issue(f, f'preset {gname}.{iname}: column {n} not in source {src}')

ARTIFACTS = {'art_7f2': 'positions', 'art_9c4': 'weather', 'art_3b8': 'fundSummary'}
for f in sorted(glob.glob(BASE + 'blueprints/*.json')):
    bp = json.load(open(f))
    if 'elements' in bp:
        check(f, bp, ARTIFACTS)
print('\n'.join(issues) if issues else 'no issues')
