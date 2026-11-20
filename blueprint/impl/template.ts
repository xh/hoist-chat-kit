import type {WidgetDemand} from '../BlueprintRegistry';

// Plain data and pure functions only, so a validator under plain Node can load these.

/** A reference in a template: `{name}`, with a null source, or `{source.name}`. */
export interface TemplateRef {
    ref: string;
    source: string;
    name: string;
}

export type TemplatePart = string | TemplateRef;

/**
 * Split a template into its literal text and its references. `{{` writes a literal brace. A
 * reference that is not a name or `source.name`, or a brace never closed, is a bad reference,
 * which stays in the text as written.
 */
export function parseTemplate(text: string): {parts: TemplatePart[]; badRefs: string[]} {
    const parts: TemplatePart[] = [],
        badRefs: string[] = [];
    let literal = '',
        i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c !== '{') {
            literal += c;
            i++;
        } else if (text[i + 1] === '{') {
            literal += '{';
            i += 2;
        } else {
            const end = text.indexOf('}', i),
                raw = end < 0 ? text.slice(i) : text.slice(i, end + 1),
                match = end < 0 ? null : REF.exec(raw.slice(1, -1));
            if (match) {
                if (literal) parts.push(literal);
                literal = '';
                parts.push({
                    ref: match[0],
                    source: match[2] ? match[1] : null,
                    name: match[2] ?? match[1]
                });
            } else {
                badRefs.push(raw);
                literal += raw;
            }
            i += raw.length;
        }
    }
    if (literal) parts.push(literal);
    return {parts, badRefs};
}

/** The references of a template, in order. */
export function templateRefs(text: string): TemplateRef[] {
    return parseTemplate(text).parts.filter(it => typeof it !== 'string') as TemplateRef[];
}

/**
 * The root aggregates a template reads from each source it names. An undotted name is read from
 * `defaultSource`, if any, as it may be a field there: a source requests only its own fields.
 */
export function templateDemand(text: string, defaultSource: string): Record<string, WidgetDemand> {
    const ret: Record<string, WidgetDemand> = {};
    templateRefs(text ?? '').forEach(({source, name}) => {
        const from = source ?? defaultSource;
        if (!from) return;
        ret[from] ??= {fields: [], groupBy: []};
        if (!ret[from].fields.includes(name)) ret[from].fields.push(name);
    });
    return ret;
}

/**
 * Text with each template reference to a variable or a source renamed. Any string can be a
 * template, so this leaves every other part of it as it is, `{{` included.
 */
export function renameTemplateRefs(
    text: string,
    kind: 'variable' | 'source',
    from: string,
    to: string
): string {
    if (!text.includes('{')) return text;
    return text.replace(REF_IN_TEXT, (match, first: string, second: string) => {
        if (match === '{{' || first !== from) return match;
        if (kind === 'variable' && !second) return `{${to}}`;
        if (kind === 'source' && second) return `{${to}.${second}}`;
        return match;
    });
}

/** True if any string in a value, at any depth, reads a variable or a source as a template. */
export function readsInTemplates(
    value: unknown,
    kind: 'variable' | 'source',
    name: string
): boolean {
    if (typeof value === 'string') return renameTemplateRefs(value, kind, name, '\0') !== value;
    if (value && typeof value === 'object') {
        return Object.values(value).some(it => readsInTemplates(it, kind, name));
    }
    return false;
}

/** A template with each reference replaced by its value, as plain text. */
export function fillTemplate(text: string, valueOf: (ref: TemplateRef) => string): string {
    return parseTemplate(text ?? '')
        .parts.map(it => (typeof it === 'string' ? it : valueOf(it)))
        .join('');
}

/**
 * A markdown template with each reference replaced by a token, and the values in token order. A
 * renderer puts each value in place of its token after it parses the markdown, so that no value
 * can change the markdown around it, or link with text other than its own address.
 */
export function markdownTemplate(
    text: string,
    valueOf: (ref: TemplateRef) => string
): {content: string; values: string[]} {
    const values: string[] = [],
        content = fillTemplate(text, ref => {
            values.push(valueOf(ref));
            return `${VALUE_START}${values.length - 1}${VALUE_END}`;
        });
    return {content, values};
}

/** A token that `markdownTemplate()` writes, with the index of its value. */
export const VALUE_TOKEN = /\uE000(\d+)\uE001/g;

const VALUE_START = '\uE000',
    VALUE_END = '\uE001';

const REF = /^([A-Za-z_][\w-]*)(?:\.([A-Za-z_][\w-]*))?$/,
    REF_IN_TEXT = /\{\{|\{([A-Za-z_][\w-]*)(?:\.([A-Za-z_][\w-]*))?\}/g;
