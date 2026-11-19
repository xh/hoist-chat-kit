import {describe, expect, it} from 'vitest';
import {chatUiTextSpec} from '../desktop/cmp/genui';
import {ChatUiCatalog} from '../genui';
import {isAllowedUrl} from './UrlUtils';

/**
 * Chat answers and blueprints open URLs through one matcher, so the same allow list permits the
 * same URLs in both.
 */
describe('isAllowedUrl', () => {
    const cases: [string, string[], string, boolean][] = [
        ['a URL under an allowed origin', ['https://a.com'], 'https://a.com/any/path', true],
        [
            'a path under an allowed prefix',
            ['https://a.com/reports'],
            'https://a.com/reports/q3',
            true
        ],
        ['the allowed path itself', ['https://a.com/reports'], 'https://a.com/reports', true],
        ['a path outside the prefix', ['https://a.com/reports'], 'https://a.com/admin', false],
        ['a path that only starts the same', ['https://a.com/rep'], 'https://a.com/reports', false],
        ['a host that starts the same', ['https://a.com'], 'https://a.com.evil.com/x', false],
        [
            'an allowed origin in the query',
            ['https://a.com'],
            'https://evil.com/?https://a.com',
            false
        ],
        ['another scheme of the same host', ['https://a.com'], 'http://a.com/x', false],
        ['a data URL', ['data:text/'], 'data:text/html,<script>x</script>', false],
        ['a javascript URL', ['javascript:'], 'javascript:alert(1)', false],
        ['a file URL', ['file:///'], 'file:///etc/passwd', false],
        ['text that is no URL', ['https://a.com'], 'a.com/x', false],
        ['an empty list', [], 'https://a.com/x', false]
    ];

    it.each(cases)('decides %s the same for a blueprint and a chat catalog', (_, list, url, ok) => {
        expect(isAllowedUrl(url, list)).toBe(ok);
        expect(
            new ChatUiCatalog({components: [chatUiTextSpec()], urlAllowList: list}).isUrlAllowed(
                url
            )
        ).toBe(ok);
    });
});
