import { describe, expect, it } from 'vitest';
import { DOCX_REPORT_STYLE } from '../src/backend/domain/artifact-writer.ts';

describe('DOCX report typography', () => {
  it('uses a readable professional scale and spacing', () => {
    expect(DOCX_REPORT_STYLE.font).toBe('Arial');
    expect(DOCX_REPORT_STYLE.bodySizeHalfPoints).toBeGreaterThanOrEqual(23);
    expect(DOCX_REPORT_STYLE.tableSizeHalfPoints).toBeGreaterThanOrEqual(20);
    expect(DOCX_REPORT_STYLE.lineTwips).toBeGreaterThanOrEqual(276);
    expect(DOCX_REPORT_STYLE.paragraphAfterTwips).toBeGreaterThanOrEqual(140);
    expect(DOCX_REPORT_STYLE.bulletAfterTwips).toBeGreaterThanOrEqual(100);
    expect(DOCX_REPORT_STYLE.tableCellVerticalMarginTwips).toBeGreaterThanOrEqual(70);
  });
});
