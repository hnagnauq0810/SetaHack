import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatMarkdown, linkifyDownloadUrls } from '../../../src/composites/chat-markdown';

describe('ChatMarkdown', () => {
  it('renders raw L&D download URLs as clickable links', () => {
    render(
      <ChatMarkdown text="PowerPoint: `/api/ld-reporting/reports/rpt_123/download/pptx`" />,
    );

    expect(screen.getByRole('link', { name: 'Download PPTX' })).toHaveAttribute(
      'href',
      '/api/ld-reporting/reports/rpt_123/download/pptx',
    );
  });

  it('keeps existing markdown download links unchanged', () => {
    const text = '[Download DOCX](/api/ld-reporting/reports/rpt_123/download/docx)';

    expect(linkifyDownloadUrls(text)).toBe(text);
  });
});
