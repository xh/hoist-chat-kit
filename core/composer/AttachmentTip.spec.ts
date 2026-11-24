import {describe, expect, it} from 'vitest';
import {getAttachmentTip} from './AttachmentTip';

/**
 * The user-friendly summary of the attachment rules. The user reads this while dragging a file, so it
 * must never show a raw MIME type.
 */
describe('getAttachmentTip', () => {
    const MB = 1024 * 1024,
        tip = (accept: string[], rest = {}) =>
            getAttachmentTip({
                accept,
                acceptLabel: null,
                maxFiles: 4,
                maxFileSize: 5 * MB,
                ...rest
            });

    it('names type families, extensions and common MIME types, once each', () => {
        expect(tip(['image/*', 'application/pdf', '.csv', '.txt', '.md', '.markdown'])).toBe(
            'Images, PDF, CSV, text or Markdown. Up to 4 files, 5 MB each.'
        );
    });

    it('gives a lone type its noun', () => {
        expect(tip(['.csv'])).toBe('CSV files. Up to 4 files, 5 MB each.');
        expect(tip(['image/*'])).toBe('Images. Up to 4 files, 5 MB each.');
    });

    it('never shows a MIME type it has no name for', () => {
        expect(tip(['image/*', 'application/x-parquet'])).toBe(
            'Images and other files. Up to 4 files, 5 MB each.'
        );
        expect(tip(['application/x-parquet'])).toBe('Up to 4 files, 5 MB each.');
    });

    it('states the limits alone when any type is accepted', () => {
        expect(tip(null)).toBe('Up to 4 files, 5 MB each.');
        expect(tip(null, {maxFiles: 1, maxFileSize: 512 * 1024})).toBe('One file, up to 512 KB.');
    });

    it("uses the app's own description of the types", () => {
        expect(tip(['.csv', '.xlsx'], {acceptLabel: 'loan tapes as CSV or Excel'})).toBe(
            'Loan tapes as CSV or Excel. Up to 4 files, 5 MB each.'
        );
    });
});
