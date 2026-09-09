import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { pdfjsSource, pdfjsWorkerSource } from '@/lib/pdfjs-source';

type PdfTheme = {
  background: string;
  foreground: string;
  muted: string;
};

type PdfReaderViewProps = {
  uri: string;
  initialPage: number;
  targetPage?: number;
  spokenOffset?: number;
  theme: PdfTheme;
  margin: number;
  onLoaded: (totalPages: number) => void;
  onPageChanging: (page: number, totalPages: number) => void;
  onPageChanged: (page: number, totalPages: number) => void;
  onPageText: (page: number, text: string, prefetched?: boolean) => void;
  onError: (message: string) => void;
  onLoadingChange: (loading: boolean) => void;
  onReady: () => void;
  onNavigateReady?: (navigate: (page: number) => void) => void;
};

type PdfMessage =
  | { type: 'ready' }
  | { type: 'loaded'; totalPages: number }
  | { type: 'pageChanging'; page: number; totalPages: number }
  | { type: 'pageChanged'; page: number; totalPages: number }
  | { type: 'pageText'; page: number; text: string }
  | { type: 'error'; message: string }
  | { type: 'loading'; loading: boolean };

export const PDF_RETRY_MESSAGE = 'Failed to render PDF page. Tap to retry.';

const buildViewerHtml = (uri: string, theme: PdfTheme, margin: number, initialPage: number) => `
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: ${theme.background}; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: ${theme.foreground}; }
      #viewer { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; touch-action: none; }
      #page { display: block; margin: 0 auto; max-width: calc(100vw - ${margin * 2}px); max-height: 100%; background: #fff; box-shadow: 0 10px 30px rgba(0,0,0,.22); will-change: transform, opacity; }
      #page.page-next { animation: pageNext 180ms ease-out; }
      #page.page-previous { animation: pagePrevious 180ms ease-out; }
      @keyframes pageNext { from { opacity: .72; transform: translateX(14px) scale(.99); } to { opacity: 1; transform: translateX(0) scale(1); } }
      @keyframes pagePrevious { from { opacity: .72; transform: translateX(-14px) scale(.99); } to { opacity: 1; transform: translateX(0) scale(1); } }
      #message { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 28px; text-align: center; color: ${theme.muted}; font-size: 15px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main id="viewer" aria-label="PDF page viewer">
      <canvas id="page" aria-label="PDF page"></canvas>
      <div id="message">Loading PDF…</div>
    </main>
    <script type="module">
      const PDF_URI = ${JSON.stringify(uri)};
      const PDFJS_SOURCE = ${JSON.stringify(pdfjsSource)};
      const PDFJS_WORKER_SOURCE = ${JSON.stringify(pdfjsWorkerSource)};
      const INITIAL_PAGE = ${Math.max(1, initialPage + 1)};
      const viewer = document.getElementById('viewer');
      const canvas = document.getElementById('page');
      const message = document.getElementById('message');
      let pdf = null;
      let currentPage = INITIAL_PAGE;
      let rendering = false;
      let queuedPage = null;
      let pdfjsLib = null;
      let workerUrl = null;

      const send = (payload) => {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      };

      const showMessage = (text) => {
        message.textContent = text;
        message.style.display = 'flex';
      };

      const hideMessage = () => {
        message.style.display = 'none';
      };

      const clampPage = (pageNumber) => Math.max(1, Math.min(pdf?.numPages || 1, pageNumber));

      const renderPage = async (pageNumber) => {
        if (!pdf) return;
        const nextPage = clampPage(pageNumber);
        if (rendering) {
          queuedPage = nextPage;
          return;
        }

        rendering = true;
        const previousPage = currentPage;
        currentPage = nextPage;
        if (previousPage !== nextPage) {
          canvas.classList.remove('page-next', 'page-previous');
          void canvas.offsetWidth;
          canvas.classList.add(nextPage > previousPage ? 'page-next' : 'page-previous');
        }
        send({ type: 'pageChanging', page: currentPage - 1, totalPages: pdf.numPages });
        send({ type: 'loading', loading: true });
        try {
          const pdfPage = await pdf.getPage(currentPage);
          const baseViewport = pdfPage.getViewport({ scale: 1 });
          const availableWidth = Math.max(240, window.innerWidth - ${margin * 2});
          const availableHeight = Math.max(240, window.innerHeight - ${margin * 2});
          const scale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height, 2.4);
          const viewport = pdfPage.getViewport({ scale });
          const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
          canvas.width = Math.floor(viewport.width * pixelRatio);
          canvas.height = Math.floor(viewport.height * pixelRatio);
          canvas.style.width = \`\${viewport.width}px\`;
          canvas.style.height = \`\${viewport.height}px\`;
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('PDF canvas is unavailable on this device.');
          context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, viewport.width, viewport.height);
          await pdfPage.render({ canvasContext: context, viewport }).promise;

          const textContent = await pdfPage.getTextContent();
          const text = textContent.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')
            .replace(/\\s+/g, ' ')
            .trim();

          pdfPage.cleanup();
          hideMessage();
          send({ type: 'pageChanged', page: currentPage - 1, totalPages: pdf.numPages });
          send({ type: 'pageText', page: currentPage - 1, text });
        } catch (error) {
          const details = error instanceof Error ? error.message : 'The PDF page could not be rendered.';
          showMessage(details);
          send({ type: 'error', message: details });
        } finally {
          rendering = false;
          send({ type: 'loading', loading: false });
          if (queuedPage !== null && queuedPage !== currentPage) {
            const queued = queuedPage;
            queuedPage = null;
            void renderPage(queued);
          } else {
            queuedPage = null;
          }
        }
      };

      const openPdf = async (source) => {
        try {
          showMessage('Loading PDF…');
          send({ type: 'loading', loading: true });
          const loadingTask = pdfjsLib.getDocument({
            ...source,
            useWorkerFetch: false,
            disableAutoFetch: false,
            disableStream: false,
            isEvalSupported: false,
          });
          pdf = await loadingTask.promise;
          send({ type: 'loaded', totalPages: pdf.numPages });
          await renderPage(currentPage);
        } catch (error) {
          const details = error instanceof Error ? error.message : 'This PDF could not be opened.';
          showMessage(details);
          send({ type: 'error', message: details });
          send({ type: 'loading', loading: false });
        }
      };

      const goToPage = (pageNumber) => {
        if (!pdf) return;
        void renderPage(pageNumber);
      };

      const handleNativeMessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'goToPage') goToPage(Number(payload.page) + 1);
        } catch (error) {
          send({ type: 'error', message: error instanceof Error ? error.message : 'The PDF viewer received an invalid message.' });
        }
      };
      window.addEventListener('message', handleNativeMessage);
      document.addEventListener('message', handleNativeMessage);

      let touchStartX = 0;
      let touchStartY = 0;
      viewer.addEventListener('touchstart', (event) => {
        const touch = event.changedTouches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
      }, { passive: true });
      viewer.addEventListener('touchend', (event) => {
        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));
        if (distance < 48) return;
        if (Math.abs(deltaX) >= Math.abs(deltaY)) {
          goToPage(currentPage + (deltaX < 0 ? 1 : -1));
        } else {
          goToPage(currentPage + (deltaY < 0 ? 1 : -1));
        }
      }, { passive: true });
      window.addEventListener('resize', () => { if (pdf) void renderPage(currentPage); });

      try {
        const moduleUrl = URL.createObjectURL(new Blob([PDFJS_SOURCE], { type: 'text/javascript' }));
        workerUrl = URL.createObjectURL(new Blob([PDFJS_WORKER_SOURCE], { type: 'text/javascript' }));
        pdfjsLib = await import(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        send({ type: 'ready' });
        await openPdf({ url: PDF_URI });
      } catch (error) {
        const details = error instanceof Error ? error.message : 'The offline PDF runtime could not start.';
        showMessage(details);
        send({ type: 'error', message: details });
        send({ type: 'loading', loading: false });
      }
    </script>
  </body>
</html>
`;

export function PdfReaderView({
  uri,
  initialPage,
  targetPage,
  theme,
  margin,
  onLoaded,
  onPageChanging,
  onPageChanged,
  onPageText,
  onError,
  onLoadingChange,
  onReady,
  onNavigateReady,
}: PdfReaderViewProps) {
  const webViewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => buildViewerHtml(uri, theme, margin, initialPage), [uri, theme, margin, initialPage]);
  const baseUrl = useMemo(() => uri.slice(0, Math.max(uri.lastIndexOf('/') + 1, 0)), [uri]);

  const send = useCallback((payload: Record<string, unknown>) => {
    webViewRef.current?.postMessage(JSON.stringify(payload));
  }, []);

  useEffect(() => {
    setReady(false);
  }, [html]);

  useEffect(() => {
    if (ready && targetPage !== undefined) send({ type: 'goToPage', page: targetPage });
  }, [ready, send, targetPage]);

  useEffect(() => {
    if (ready && onNavigateReady) {
      onNavigateReady((page) => send({ type: 'goToPage', page }));
    }
  }, [onNavigateReady, ready, send]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as PdfMessage;
      if (message.type === 'ready') {
        setReady(true);
        onReady();
      } else if (message.type === 'loaded') {
        onLoaded(message.totalPages);
      } else if (message.type === 'pageChanging') {
        onPageChanging(message.page, message.totalPages);
      } else if (message.type === 'pageChanged') {
        onPageChanged(message.page, message.totalPages);
      } else if (message.type === 'pageText') {
        onPageText(message.page, message.text, false);
      } else if (message.type === 'loading') {
        onLoadingChange(message.loading);
      } else if (message.type === 'error') {
        onError(message.message);
      }
    } catch {
      onError('The PDF viewer returned an invalid response.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html, baseUrl }}
        onMessage={handleMessage}
        onError={() => onError('The offline PDF viewer could not load.')}
        onHttpError={() => onError('The offline PDF viewer could not load.')}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        bounces={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        style={styles.webView}
      />
      {!ready && (
        <View style={[styles.loading, { backgroundColor: theme.background }]}>
          <ActivityIndicator color={theme.foreground} />
          <Text style={[styles.loadingText, { color: theme.muted }]}>Preparing offline PDF reader…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webView: { flex: 1, backgroundColor: 'transparent' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 13 },
});