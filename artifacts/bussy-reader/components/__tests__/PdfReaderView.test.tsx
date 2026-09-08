import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockOpenPdf = jest.fn();
const mockRenderPdfPage = jest.fn();
const mockGetPdfPageText = jest.fn();
const mockClosePdf = jest.fn();

jest.mock('@/modules/bussy-reader-pdf/src', () => ({
  openPdf: mockOpenPdf,
  renderPdfPage: mockRenderPdfPage,
  getPdfPageText: mockGetPdfPageText,
  closePdf: mockClosePdf,
}));

const { PdfReaderView } = require('@/components/PdfReaderView') as typeof import('@/components/PdfReaderView');

describe('PdfReaderView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenPdf.mockResolvedValue({ id: 'session-1', pageCount: 3 });
    mockRenderPdfPage.mockResolvedValue('native-page-image');
    mockGetPdfPageText.mockResolvedValue('Page text');
    mockClosePdf.mockResolvedValue(undefined);
  });

  it('opens by URI and requests native page rendering and text lazily', async () => {
    const onLoaded = jest.fn();
    const onPageText = jest.fn();
    const screen = render(
      <PdfReaderView
        uri="file:///large.pdf"
        initialPage={1}
        theme={{ background: '#000', foreground: '#fff', muted: '#999' }}
        margin={24}
        onLoaded={onLoaded}
        onPageChanging={jest.fn()}
        onPageChanged={jest.fn()}
        onPageText={onPageText}
        onError={jest.fn()}
        onLoadingChange={jest.fn()}
        onReady={jest.fn()}
      />,
    );

    await waitFor(() => expect(mockOpenPdf).toHaveBeenCalledWith('file:///large.pdf'));
    fireEvent(screen.getByTestId('pdf-reader-surface'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 560 } },
    });

    await waitFor(() => expect(mockRenderPdfPage).toHaveBeenCalledWith('session-1', 1, expect.any(Number), expect.any(Number)));
    expect(mockRenderPdfPage).toHaveBeenCalledWith('session-1', 1, expect.any(Number), expect.any(Number));
    expect(mockGetPdfPageText).toHaveBeenCalledWith('session-1', 1);
    expect(onLoaded).toHaveBeenCalledWith(3);
    expect(onPageText).toHaveBeenCalledWith(1, 'Page text', false);
    expect(screen.getByLabelText('PDF page 2 / 3')).toBeTruthy();
    expect(mockRenderPdfPage).toHaveBeenCalledTimes(1);
  });

  it('shows the rendered page before slow text extraction completes', async () => {
    let resolveText: ((text: string) => void) | undefined;
    const slowTextPromise = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    mockGetPdfPageText.mockReturnValueOnce(slowTextPromise);
    const onPageText = jest.fn();
    const screen = render(
      <PdfReaderView
        uri="file:///large.pdf"
        initialPage={0}
        theme={{ background: '#000', foreground: '#fff', muted: '#999' }}
        margin={24}
        onLoaded={jest.fn()}
        onPageChanging={jest.fn()}
        onPageChanged={jest.fn()}
        onPageText={onPageText}
        onError={jest.fn()}
        onLoadingChange={jest.fn()}
        onReady={jest.fn()}
      />,
    );

    await waitFor(() => expect(mockOpenPdf).toHaveBeenCalledWith('file:///large.pdf'));
    fireEvent(screen.getByTestId('pdf-reader-surface'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 560 } },
    });
    await waitFor(() => expect(screen.getByLabelText('PDF page 1 / 3')).toBeTruthy());
    expect(onPageText).not.toHaveBeenCalled();

    resolveText?.('Slow page text');
    await waitFor(() => expect(onPageText).toHaveBeenCalledWith(0, 'Slow page text', false));
  });

  it('closes the native session when the reader unmounts', async () => {
    const screen = render(
      <PdfReaderView
        uri="file:///large.pdf"
        initialPage={0}
        theme={{ background: '#000', foreground: '#fff', muted: '#999' }}
        margin={24}
        onLoaded={jest.fn()}
        onPageChanging={jest.fn()}
        onPageChanged={jest.fn()}
        onPageText={jest.fn()}
        onError={jest.fn()}
        onLoadingChange={jest.fn()}
        onReady={jest.fn()}
      />,
    );

    await waitFor(() => expect(mockOpenPdf).toHaveBeenCalledWith('file:///large.pdf'));
    screen.unmount();

    expect(mockClosePdf).toHaveBeenCalledWith('session-1');
  });

  it('reports a missing or corrupt PDF without leaving a native session open', async () => {
    const onError = jest.fn();
    mockOpenPdf.mockRejectedValueOnce(new Error('The PDF could not be opened.'));

    render(
      <PdfReaderView
        uri="file:///missing.pdf"
        initialPage={0}
        theme={{ background: '#000', foreground: '#fff', muted: '#999' }}
        margin={24}
        onLoaded={jest.fn()}
        onPageChanging={jest.fn()}
        onPageChanged={jest.fn()}
        onPageText={jest.fn()}
        onError={onError}
        onLoadingChange={jest.fn()}
        onReady={jest.fn()}
      />,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledWith('The PDF could not be opened.'));
    expect(mockRenderPdfPage).not.toHaveBeenCalled();
    expect(mockClosePdf).not.toHaveBeenCalled();
  });

  it('stops waiting for native initialization and offers a retry after the timeout', async () => {
    jest.useFakeTimers();
    try {
      const onError = jest.fn();
      mockOpenPdf.mockImplementation(() => new Promise(() => {}));
      const screen = render(
        <PdfReaderView
          uri="file:///slow.pdf"
          initialPage={0}
          theme={{ background: '#000', foreground: '#fff', muted: '#999' }}
          margin={24}
          onLoaded={jest.fn()}
          onPageChanging={jest.fn()}
          onPageChanged={jest.fn()}
          onPageText={jest.fn()}
          onError={onError}
          onLoadingChange={jest.fn()}
          onReady={jest.fn()}
        />,
      );

      await waitFor(() => expect(mockOpenPdf).toHaveBeenCalledWith('file:///slow.pdf'));
      act(() => {
        jest.advanceTimersByTime(10_000);
      });

      await waitFor(() => expect(onError).toHaveBeenCalledWith('Failed to render PDF page. Tap to retry.'));
      expect(screen.getByRole('button', { name: 'Failed to render PDF page. Tap to retry.' })).toBeTruthy();

      mockOpenPdf.mockResolvedValueOnce({ id: 'session-retry', pageCount: 1 });
      fireEvent.press(screen.getByRole('button', { name: 'Failed to render PDF page. Tap to retry.' }));
      await waitFor(() => expect(mockOpenPdf).toHaveBeenCalledTimes(2));
    } finally {
      jest.useRealTimers();
    }
  });
});