import {render, screen} from '@testing-library/react';
import {hoistCmp, XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {chatErrorBoundary} from './ChatErrorBoundary';

/**
 * The boundary an app wraps around a kit component it hosts itself. Apps rely on it rendering
 * with no model in context, and on placing its note through a class of their own.
 */
describe('ChatErrorBoundary', () => {
    beforeAll(() => initTestAppAsync());

    beforeEach(() => {
        const handleException = vi.spyOn(XH, 'handleException').mockImplementation(() => {});
        onTestFinished(() => handleException.mockRestore());
        // React logs each error it catches.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        onTestFinished(() => consoleError.mockRestore());
    });

    it('shows a note in place of content that throws, with the app className on it', () => {
        const {container} = render(
            chatErrorBoundary({className: 'app-note', subject: 'message', item: thrower()})
        );

        expect(screen.getByText('This message could not be displayed.')).toBeTruthy();
        expect(container.firstElementChild.classList).toContain('xh-chat-error-boundary');
        expect(container.firstElementChild.classList).toContain('app-note');
    });
});

//------------------
// Helpers
//------------------
const thrower = hoistCmp.factory({
    model: false,
    render() {
        throw new Error('Bad part');
    }
});
