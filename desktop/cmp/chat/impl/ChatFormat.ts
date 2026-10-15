/**
 * A duration as a short label - `0.8s`, `4.2s`, `12s`, `1m 5s`.
 * @internal
 */
export function formatElapsed(ms: number): string {
    if (ms == null || ms < 0) return null;
    const secs = ms / 1000;
    if (secs < 10) return `${secs.toFixed(1)}s`;
    if (secs < 60) return `${Math.round(secs)}s`;
    const mins = Math.floor(secs / 60),
        remSecs = Math.round(secs - mins * 60);
    return remSecs ? `${mins}m ${remSecs}s` : `${mins}m`;
}

/**
 * A running duration as a ticking label, in whole seconds - `1s`, `59s`, `1m 02s`, `12m 00s`.
 * Null under 1 s, as elapsed time appears only once a second has passed.
 * @internal
 */
export function formatTickingElapsed(ms: number): string {
    if (ms == null || ms < 1000) return null;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
}

/**
 * How long a reply has had no data, for its stalled label - whole seconds up to 59, then whole
 * minutes: `30s`, `59s`, `1m`, `2m`.
 * @internal
 */
export function formatStallDuration(ms: number): string {
    const secs = Math.max(0, Math.floor((ms ?? 0) / 1000));
    return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`;
}

/**
 * A file size as a short label - `512 B`, `12 KB`, `3.4 MB`.
 * @internal
 */
export function formatFileSize(bytes: number): string {
    if (bytes == null || bytes < 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = bytes / 1024,
        unitIdx = 0;
    while (size >= 1024 && unitIdx < units.length - 1) {
        size /= 1024;
        unitIdx++;
    }
    return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unitIdx]}`;
}

/**
 * A tool name as a readable title - `get_weather` and `getWeather` both become `Get weather`.
 * Acronyms keep their case.
 * @internal
 */
export function humanizeToolName(name: string): string {
    if (!name) return name;
    const words = name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[\s_\-.]+/)
        .filter(Boolean)
        .map(word => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()));
    if (!words.length) return name;
    words[0] = words[0][0].toUpperCase() + words[0].slice(1);
    return words.join(' ');
}

/**
 * The host of a URL without any `www.` prefix, or the input itself if it does not parse.
 * @internal
 */
export function formatHost(url: string): string {
    if (!url) return null;
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (ignored) {
        return url;
    }
}
