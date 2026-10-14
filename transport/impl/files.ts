/**
 * Image types that the Anthropic and OpenAI APIs both accept.
 * @internal
 */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * True for a media type whose content is text the model can read - `text/*`, and common
 * structured text types such as JSON, XML and YAML.
 * @internal
 */
export function isTextType(mediaType: string): boolean {
    return (
        mediaType.startsWith('text/') ||
        TEXT_TYPES.includes(mediaType) ||
        /\+(json|xml)$/.test(mediaType)
    );
}

/**
 * Text from base64-encoded UTF-8 data.
 * @internal
 */
export function decodeBase64Text(data: string): string {
    return new TextDecoder().decode(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
}

/**
 * Text that names an attachment the model cannot read, sent in its place so that the model knows
 * it was left out.
 * @internal
 */
export function omittedFileText(name: string, mediaType: string): string {
    return `[Attachment '${name}' (${mediaType}) not sent - the model cannot read this file type.]`;
}

//------------------
// Implementation
//------------------
/** Media types, beyond `text/*`, whose content is text the model can read. */
const TEXT_TYPES = [
    'application/json',
    'application/xml',
    'application/javascript',
    'application/yaml',
    'application/x-yaml',
    'application/sql',
    'application/csv'
];
