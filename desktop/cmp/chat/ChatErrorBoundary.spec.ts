import {act, fireEvent, render, screen} from '@testing-library/react';
import {hoistCmp, XH} from '@xh/hoist/core';
import {initTestAppAsync} from '@xh/hoist/test-support';
import {beforeAll, beforeEach, describe, expect, it, onTestFinished, vi} from 'vitest';
import {chatErrorBoundary} from './ChatErrorBoundary';

/**
 * The boundary an app wraps around a kit component it hosts itself. Apps rely on it rendering
 * with no model in context, on placing its note through a class of their own, and on Try Again
 * rendering the content once more.
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

    it('renders the content again on Try Again, for an error that does not recur', async () => {
        let fails = true;
        const flaky = hoistCmp.factory({
            model: false,
            render() {
                if (fails) throw new Error('Not ready');
                return 'Loaded';
            }
        });
        render(chatErrorBoundary({item: flaky()}));
        expect(screen.getByText('This part could not be displayed.')).toBeTruthy();

        fails = false;
        await act(() => fireEvent.click(screen.getByRole('button', {name: 'Try Again'})));
        expect(screen.getByText('Loaded')).toBeTruthy();
        expect(screen.queryByText('This part could not be displayed.')).toBeNull();
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
