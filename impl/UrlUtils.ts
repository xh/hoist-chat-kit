/** A URL as parsed, if it is http or https. Null for any other scheme, or text that is no URL. */
export function parseWebUrl(url: string): URL {
    try {
        const ret = new URL(url);
        return ret.protocol === 'http:' || ret.protocol === 'https:' ? ret : null;
    } catch {
        return null;
    }
}

/**
 * True if an allow list permits a URL. An entry matches by its parsed origin and path prefix,
 * never by string prefix, so `https://a.com` does not allow `https://a.com.evil.com`. Only http
 * and https URLs, and entries, ever match.
 */
export function isAllowedUrl(url: string, allowList: string[]): boolean {
    const target = parseWebUrl(url);
    if (!target) return false;
    return (allowList ?? []).some(entry => {
        const allowed = parseWebUrl(entry);
        if (!allowed || allowed.origin !== target.origin) return false;
        const base = allowed.pathname.endsWith('/') ? allowed.pathname : `${allowed.pathname}/`;
        return target.pathname === allowed.pathname || target.pathname.startsWith(base);
    });
}
