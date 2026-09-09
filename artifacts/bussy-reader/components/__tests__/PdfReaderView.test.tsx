import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockWebViewPostMessage = jest.fn();

jest.mock('react-native-webview', () => {
  const mockReact = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    WebView: mockReact.forwardRef((props: Record<string, unknown>, ref: React.Ref<{ postMessage: jest.Mock }>) => {
      mockReact.useImperativeHandle(ref, () => ({ postMessage: mockWebViewPostMessage }));
      return <View testID="pdf-webview" {...props} />;
    }),
  };
});

const { PdfReaderView } = require('@/components/PdfReaderView') as typeof import('@/components/PdfReaderView');

const baseProps = () => ({
  uri: 'file:///library/book.pdf',
  initialPage: 1,
  theme: { background: '#000', foreground: '#fff', muted: '#999' },
  margin: 24,
  onLoaded: jest.fn(),
  onPageChanging: jest.fn(),
  onPageChanged: jest.fn(),
  onPageText: jest.fn(),
  onError: jest.fn(),
  onLoadingChange: jest.fn(),
  onReady: jest.fn(),
});

describe('PdfReaderView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads local PDFs directly through the embedded pdf.js WebView', () => {
    const screen = render(<PdfReaderView {...baseProps()} />);
    const webView = screen.getByTestId('pdf-webview');
    const html = webView.props.source.html as string;

    expect(html).toContain('const PDF_URI = "file:///library/book.pdf"');
    expect(html).toContain('pdfjsLib.getDocument');
    expect(html).toContain('await openPdf({ url: PDF_URI })');
    expect(html).toContain('renderHighlightLayer');
    expect(html).toContain("payload.type === 'setSpokenOffset'");
    expect(webView.props.source.baseUrl).toBe('file:///library/');
  });

  it('forwards loaded pages, rendered text, and loading state from the WebView', async () => {
    const props = baseProps();
    const screen = render(<PdfReaderView {...props} />);
    const webView = screen.getByTestId('pdf-webview');

    await act(async () => {
      fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
      fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify({ type: 'loaded', totalPages: 3 }) } });
      fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify({ type: 'pageChanging', page: 1, totalPages: 3 }) } });
      fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify({ type: 'pageChanged', page: 1, totalPages: 3 }) } });
      fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify({ type: 'pageText', page: 1, text: 'Page text' }) } });
      fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify({ type: 'loading', loading: false }) } });
    });

    expect(props.onReady).toHaveBeenCalledTimes(1);
    expect(props.onLoaded).toHaveBeenCalledWith(3);
    expect(props.onPageChanging).toHaveBeenCalledWith(1, 3);
    expect(props.onPageChanged).toHaveBeenCalledWith(1, 3);
    expect(props.onPageText).toHaveBeenCalledWith(1, 'Page text', false);
    expect(props.onLoadingChange).toHaveBeenCalledWith(false);
  });

  it('sends navigation commands after the WebView is ready', async () => {
    const props = baseProps();
    const onNavigateReady = jest.fn();
    const screen = render(<PdfReaderView {...props} onNavigateReady={onNavigateReady} />);
    const webView = screen.getByTestId('pdf-webview');

    fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
    await waitFor(() => expect(onNavigateReady).toHaveBeenCalledTimes(1));

    act(() => {
      onNavigateReady.mock.calls[0][0](2);
    });

    expect(mockWebViewPostMessage).toHaveBeenCalledWith(JSON.stringify({ type: 'goToPage', page: 2 }));
  });

  it('updates the PDF highlight position without navigating', async () => {
    const props = { ...baseProps(), spokenOffset: 42 };
    const screen = render(<PdfReaderView {...props} />);
    const webView = screen.getByTestId('pdf-webview');

    fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
    await waitFor(() => expect(mockWebViewPostMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: 'setSpokenOffset', offset: 42 }),
    ));
  });

  it('forwards PDF errors from the WebView', () => {
    const props = baseProps();
    const screen = render(<PdfReaderView {...props} />);

    fireEvent(screen.getByTestId('pdf-webview'), 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'error', message: 'PDF parse failed' }) },
    });

    expect(props.onError).toHaveBeenCalledWith('PDF parse failed');
  });
});