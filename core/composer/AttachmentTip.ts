import {pluralize} from '@xh/hoist/utils/js';
import {compact, isEmpty, round, uniq, upperFirst} from 'lodash';

// Hoist has no shared way to name file types for a user, so the kit holds its own tables here.
// xh/hoist-react#5040 asks for one. When Hoist ships it, build the tip on it and delete the tables.

/** The attachment rules of a composer that {@link getAttachmentTip} describes. */
export interface AttachmentRules {
    accept: string[];
    acceptLabel: string;
    maxFiles: number;
    maxFileSize: number;
}

/**
 * A user-friendly summary of the attachment rules, such as "Images, PDF or CSV. Up to 4 files,
 * 5 MB each." Names the accepted types from `acceptLabel`, or else from the `accept` rules it knows.
 * A rule it has no name for, such as an uncommon MIME type, reads as "other files".
 * @internal
 */
export function getAttachmentTip({
    accept,
    acceptLabel,
    maxFiles,
    maxFileSize
}: AttachmentRules): string {
    const size = fmtFileSize(maxFileSize),
        types = acceptLabel ?? describeAccept(accept),
        limits =
            maxFiles === 1 ? `One file, up to ${size}.` : `Up to ${maxFiles} files, ${size} each.`;
    return types ? `${upperFirst(types)}. ${limits}` : limits;
}

/**
 * A file size in the units a user reads, such as "5 MB".
 * @internal
 */
export function fmtFileSize(bytes: number): string {
    return bytes >= MB ? `${round(bytes / MB, 1)} MB` : `${round(bytes / 1024)} KB`;
}

//------------------
// Implementation
//------------------
const MB = 1024 * 1024;

/** Names for a MIME type's whole family, as in `image/*`. */
const FAMILY_LABELS: Record<string, string> = {
    audio: 'audio',
    image: 'images',
    text: 'text files',
    video: 'video'
};

/** The extension that names a common MIME type. */
const EXTENSIONS_BY_TYPE: Record<string, string> = {
    'application/json': 'json',
    'application/pdf': 'pdf',
    'application/xml': 'xml',
    'application/yaml': 'yaml',
    'application/zip': 'zip',
    'image/gif': 'gif',
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'text/csv': 'csv',
    'text/html': 'html',
    'text/markdown': 'md',
    'text/plain': 'txt'
};

/** Names for extensions that do not read well in capitals. Any other reads as `CSV` does. */
const EXTENSION_LABELS: Record<string, string> = {
    doc: 'Word',
    docx: 'Word',
    jpg: 'JPEG',
    markdown: 'Markdown',
    md: 'Markdown',
    ppt: 'PowerPoint',
    pptx: 'PowerPoint',
    txt: 'text',
    webp: 'WebP',
    xls: 'Excel',
    xlsx: 'Excel',
    yml: 'YAML'
};

/** The accepted types as a readable list, or null if `accept` takes any file. */
function describeAccept(accept: string[]): string {
    if (isEmpty(accept)) return null;

    const labels = accept.map(describeRule),
        known = uniq(compact(labels)),
        hasOther = known.length < uniq(labels).length;
    if (isEmpty(known)) return null;
    if (hasOther) return `${known.join(', ')} and other files`;
    return known.length === 1
        ? pluralizeLabel(known[0])
        : `${known.slice(0, -1).join(', ')} or ${known.at(-1)}`;
}

/** @returns the name of one `accept` rule, or null for a rule with no name. */
function describeRule(rule: string): string {
    const it = rule.trim().toLowerCase();
    if (it.endsWith('/*')) return FAMILY_LABELS[it.slice(0, -2)] ?? null;

    const extension = it.startsWith('.') ? it.slice(1) : EXTENSIONS_BY_TYPE[it];
    if (!extension) return null;
    return EXTENSION_LABELS[extension] ?? extension.toUpperCase();
}

/** A lone type reads better with its noun: "PDF files", not "PDF". */
function pluralizeLabel(label: string): string {
    return Object.values(FAMILY_LABELS).includes(label) ? label : `${label} ${pluralize('file')}`;
}
