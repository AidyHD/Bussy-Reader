import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import {
  closePdf,
  getPdfPageText,
  openPdf,
  renderPdfPage,
} from '@/modules/bussy-reader-pdf/src';
import { pdfjsSource, pdfjsWorkerSource } from '@/lib/pdfjs-source';
import {
  getPdfFileSize,
  PDF_RANGE_CHUNK_SIZE,
  readPdfRangeAsBase64,
} from '@/lib/pdf-range-bridge';

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

type PdfSession = {
  id: string;
  pageCount: number;
};

const TEXT_CACHE_LIMIT = 2;
const PDF_OPEN_TIMEOUT_MS = 10_000;
export const PDF_RETRY_MESSAGE = 'Failed to render PDF page. Tap to retry.';

type OpenedPdf = Awaited<ReturnType<typeof openPdf>>;

type PdfFallbackMessage =
  | { type: 'loaded'; pageCount: number }
  | { type: 'pageChanging'; page: number }
  | { type: 'pageRendered'; page: number }
  | { type: 'pageText'; page: number; text: string }
  | { type: 'pdfRangeRequest'; requestId: number; begin: number; end: number }
  | { type: 'error'; message: string };

const buildPdfFallbackHtml = (
  sourceUri: string,
  fileSize: number,
  initialPage: number,
  background: string,
) => `
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: ${background};
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      canvas {
        display: block;
        max-width: 100%;
        max-height: 100%;
      }
    </style>
  </head>
  <body>
    <canvas id="page"></canvas>
    <script type="module">
      const PDF_URI = ${JSON.stringify(sourceUri)};
      const PDF_FILE_SIZE = ${Math.max(0, Math.floor(fileSize))};
      const PDF_INITIAL_PAGE = ${Math.max(0, Math.floor(initialPage))};
      const PDF_RANGE_CHUNK_SIZE = ${PDF_RANGE_CHUNK_SIZE};
      const PDFJS_SOURCE = ${JSON.stringify(pdfjsSource)};
      const PDFJS_WORKER_SOURCE = ${JSON.stringify(pdfjsWorkerSource)};
      const canvas = document.getElementById('page');

      const send = (payload) => {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      };

      const decodeBase64 = (value) => {
        const binary = atob(value.replace(/^data:application\\/pdf;base64,/, ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
      };

      let rangeTransport = null;
      let nextRangeRequestId = 1;
      const pendingRangeRequests = new Map();

      const requestNextRange = (requestId) => {
        const request = pendingRangeRequests.get(requestId);
        if (!request) return;
        if (request.next >= request.end) {
          pendingRangeRequests.delete(requestId);
          return;
        }
        const end = Math.min(request.end, request.next + PDF_RANGE_CHUNK_SIZE);
        send({ type: 'pdfRangeRequest', requestId, begin: request.next, end });
      };

      const handleRangeResponse = (payload) => {
        try {
          const request = pendingRangeRequests.get(payload.requestId);
          if (!request || !rangeTransport) return;
          if (payload.error) throw new Error(payload.error);
          const bytes = decodeBase64(payload.base64);
          if (payload.begin !== request.next || bytes.length === 0) {
            throw new Error('The local PDF returned an invalid byte range.');
          }
          request.next += bytes.length;
          rangeTransport.onDataRange(payload.begin, bytes);
          requestNextRange(payload.requestId);
        } catch (error) {
          send({ type: 'error', message: error instanceof Error ? error.message : 'The local PDF range could not be read.' });
        }
      };

      let pdf = null;
      let workerUrl = null;
      let currentPage = PDF_INITIAL_PAGE;
      let viewportWidth = 0;
      let viewportHeight = 0;
      let renderGeneration = 0;

      const renderPage = async (pageNumber) => {
        if (!pdf) return;
        const page = Math.max(0, Math.min(pdf.numPages - 1, Math.floor(pageNumber)));
        const generation = ++renderGeneration;
        currentPage = page;
        send({ type: 'pageChanging', page });
        const pdfPage = await pdf.getPage(page + 1);
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const maxWidth = Math.max(240, viewportWidth || 720);
        const maxHeight = Math.max(240, viewportHeight || 1024);
        const scale = Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height, 3);
        const viewport = pdfPage.getViewport({ scale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('PDF canvas is unavailable.');
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.fillStyle = ${JSON.stringify(background)};
        context.fillRect(0, 0, viewport.width, viewport.height);
        await pdfPage.render({ canvasContext: context, viewport }).promise;
        if (generation !== renderGeneration) return;
        send({ type: 'pageRendered', page });
        try {
          const textContent = await pdfPage.getTextContent();
          const text = textContent.items
            .map((item) => typeof item.str === 'string' ? item.str : '')
            .filter(Boolean)
            .join(' ');
          if (generation === renderGeneration) send({ type: 'pageText', page, text });
        } finally {
          pdfPage.cleanup();
        }
      };

      const handleCommand = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'pdfRangeResponse') handleRangeResponse(payload);
          if (payload.type === 'setViewport') {
            viewportWidth = Math.floor(payload.width) || 0;
            viewportHeight = Math.floor(payload.height) || 0;
            void renderPage(currentPage);
          }
          if (payload.type === 'navigate') void renderPage(payload.page);
        } catch (error) {
          send({ type: 'error', message: error instanceof Error ? error.message : 'The PDF fallback received an invalid command.' });
        }
      };
      document.addEventListener('message', handleCommand);

      (async () => {
        try {
          const moduleUrl = URL.createObjectURL(new Blob([PDFJS_SOURCE], { type: 'text/javascript' }));
          workerUrl = URL.createObjectURL(new Blob([PDFJS_WORKER_SOURCE], { type: 'text/javascript' }));
          const pdfjsLib = await import(moduleUrl);
          URL.revokeObjectURL(moduleUrl);
          pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
          class LocalPdfRangeTransport extends pdfjsLib.PDFDataRangeTransport {
            requestDataRange(begin, end) {
              const requestId = nextRangeRequestId++;
              pendingRangeRequests.set(requestId, { next: begin, end });
              requestNextRange(requestId);
            }
          }
          rangeTransport = new LocalPdfRangeTransport(PDF_FILE_SIZE, new Uint8Array(0));
          pdf = await pdfjsLib.getDocument({
            range: rangeTransport,
            length: PDF_FILE_SIZE,
            rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
            useWorkerFetch: false,
            disableAutoFetch: true,
            disableStream: true,
            isEvalSupported: false,
          }).promise;
          send({ type: 'loaded', pageCount: pdf.numPages });
          await renderPage(PDF_INITIAL_PAGE);
        } catch (error) {
          send({ type: 'error', message: error instanceof Error ? error.message : 'The PDF could not be rendered.' });
        }
      })();
    </script>
  </body>
</html>
`;

type PdfFallbackWebViewProps = {
  uri: string;
  fileSize: number;
  initialPage: number;
  targetPage?: number;
  theme: PdfTheme;
  layout: { width: number; height: number };
  retryNonce: number;
  onLoaded: (totalPages: number) => void;
  onPageChanging: (page: number) => void;
  onPageRendered: (page: number) => void;
  onPageText: (page: number, text: string) => void;
  onError: (message: string) => void;
  onNavigateReady?: (navigate: (page: number) => void) => void;
};

function PdfFallbackWebView({
  uri,
  fileSize,
  initialPage,
  targetPage,
  theme,
  layout,
  retryNonce,
  onLoaded,
  onPageChanging,
  onPageRendered,
  onPageText,
  onError,
  onNavigateReady,
}: PdfFallbackWebViewProps) {
  const webViewRef = useRef<WebView>(null);
  const loadedRef = useRef(false);
  const pageCountRef = useRef(0);
  const completedRef = useRef(false);
  const onErrorRef = useRef(onError);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTargetPageRef = useRef<number | undefined>(undefined);
  const html = useMemo(
    () => buildPdfFallbackHtml(uri, fileSize, initialPage, theme.background),
    [fileSize, initialPage, theme.background, uri],
  );

  onErrorRef.current = onError;

  const fail = useCallback((message: string) => {
    if (completedRef.current) return;
    completedRef.current = true;
    onErrorRef.current(message);
  }, []);

  const postCommand = useCallback((payload: object) => {
    webViewRef.current?.postMessage(JSON.stringify(payload));
  }, []);

  useEffect(() => {
    loadedRef.current = false;
    pageCountRef.current = 0;
    completedRef.current = false;
    lastTargetPageRef.current = undefined;
    timeoutRef.current = setTimeout(() => {
      fail(PDF_RETRY_MESSAGE);
    }, PDF_OPEN_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
  }, [html, retryNonce]);

  useEffect(() => {
    if (!loadedRef.current || layout.width <= 0 || layout.height <= 0) return;
    postCommand({ type: 'setViewport', width: layout.width, height: layout.height });
  }, [layout.height, layout.width, postCommand]);

  useEffect(() => {
    if (
      !loadedRef.current
      || targetPage === undefined
      || targetPage === lastTargetPageRef.current
      || pageCountRef.current <= 0
    ) return;
    const page = clampPage(targetPage, pageCountRef.current);
    lastTargetPageRef.current = page;
    onPageChanging(page);
    postCommand({ type: 'navigate', page });
  }, [onPageChanging, postCommand, targetPage]);

  useEffect(() => {
    if (!onNavigateReady) return;
    onNavigateReady((page) => {
      if (!loadedRef.current || pageCountRef.current <= 0) return;
      const nextPage = clampPage(page, pageCountRef.current);
      lastTargetPageRef.current = nextPage;
      onPageChanging(nextPage);
      postCommand({ type: 'navigate', page: nextPage });
    });
  }, [onNavigateReady, onPageChanging, postCommand]);

  const handleMessage = (event: WebViewMessageEvent) => {
    if (completedRef.current) return;
    try {
      const message = JSON.parse(event.nativeEvent.data) as PdfFallbackMessage;
      if (message.type === 'pdfRangeRequest') {
        try {
          const base64 = readPdfRangeAsBase64(uri, message.begin, message.end);
          webViewRef.current?.postMessage(JSON.stringify({
            type: 'pdfRangeResponse',
            requestId: message.requestId,
            begin: message.begin,
            base64,
          }));
        } catch (error) {
          webViewRef.current?.postMessage(JSON.stringify({
            type: 'pdfRangeResponse',
            requestId: message.requestId,
            begin: message.begin,
            error: error instanceof Error ? error.message : 'The local PDF range could not be read.',
          }));
        }
        return;
      }
      if (message.type === 'loaded') {
        loadedRef.current = true;
        pageCountRef.current = Math.max(0, Math.floor(message.pageCount));
        lastTargetPageRef.current = clampPage(initialPage, pageCountRef.current);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        onLoaded(pageCountRef.current);
        postCommand({ type: 'setViewport', width: layout.width, height: layout.height });
        return;
      }
      if (message.type === 'pageChanging') {
        onPageChanging(message.page);
        return;
      }
      if (message.type === 'pageRendered') {
        onPageRendered(message.page);
        return;
      }
      if (message.type === 'pageText') {
        onPageText(message.page, message.text);
        return;
      }
      if (message.type === 'error') {
        fail(message.message);
      }
    } catch {
      fail('The PDF fallback received an invalid response.');
    }
  };

  return (
    <WebView
      ref={webViewRef}
      originWhitelist={['*']}
      source={{ html, baseUrl: uri.slice(0, Math.max(uri.lastIndexOf('/') + 1, 0)) }}
      onMessage={handleMessage}
      onError={() => fail(PDF_RETRY_MESSAGE)}
      onHttpError={() => fail(PDF_RETRY_MESSAGE)}
      javaScriptEnabled
      domStorageEnabled
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      mixedContentMode="always"
      setSupportMultipleWindows={false}
      scrollEnabled={false}
      bounces={false}
      style={[styles.fallbackWebView, { backgroundColor: theme.background }]}
    />
  );
}

const openPdfWithTimeout = (uri: string) => new Promise<OpenedPdf>((resolve, reject) => {
  let settled = false;
  const timeout = setTimeout(() => {
    settled = true;
    reject(new Error(PDF_RETRY_MESSAGE));
  }, PDF_OPEN_TIMEOUT_MS);

  Promise.resolve()
    .then(() => openPdf(uri))
    .then((opened) => {
      if (settled) {
        void closePdf(opened.id);
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(opened);
    })
    .catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
});

const clampPage = (page: number, pageCount: number) => (
  pageCount > 0 ? Math.max(0, Math.min(pageCount - 1, Math.floor(page))) : 0
);

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
  const [session, setSession] = useState<PdfSession | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageImage, setPageImage] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const [fallback, setFallback] = useState<{ fileSize: number } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const sessionRef = useRef<PdfSession | null>(null);
  const currentPageRef = useRef(0);
  const pageCountRef = useRef(0);
  const renderTokenRef = useRef(0);
  const textCacheRef = useRef(new Map<number, string>());
  const lastRenderedLayoutRef = useRef<{ width: number; height: number } | null>(null);
  const startupTimingRef = useRef<{ startedAt: number; openedAt?: number; imageAt?: number; textAt?: number } | null>(null);
  const renderPageRef = useRef<(activeSession: PdfSession, requestedPage: number) => Promise<void>>(async () => {});
  const callbacksRef = useRef({
    onLoaded,
    onPageChanging,
    onPageChanged,
    onPageText,
    onError,
    onLoadingChange,
    onReady,
  });

  const activateFallback = useCallback(() => {
    let fileSize: number;
    try {
      fileSize = getPdfFileSize(uri);
    } catch {
      return false;
    }

    const activeSession = sessionRef.current;
    sessionRef.current = null;
    if (activeSession) void closePdf(activeSession.id);
    setSession(null);
    setPageImage(null);
    setHasError(false);
    setFallback({ fileSize });
    callbacksRef.current.onLoadingChange(true);
    return true;
  }, [uri]);

  callbacksRef.current = {
    onLoaded,
    onPageChanging,
    onPageChanged,
    onPageText,
    onError,
    onLoadingChange,
    onReady,
  };

  const rememberText = useCallback((page: number, text: string) => {
    const cache = textCacheRef.current;
    cache.delete(page);
    cache.set(page, text);
    while (cache.size > TEXT_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }, []);

  const renderPageForSession = useCallback(async (activeSession: PdfSession, requestedPage: number) => {
    if (activeSession !== sessionRef.current || activeSession.pageCount <= 0) return;
    const page = clampPage(requestedPage, activeSession.pageCount);
    const token = ++renderTokenRef.current;
    currentPageRef.current = page;
    callbacksRef.current.onPageChanging(page, activeSession.pageCount);
    callbacksRef.current.onLoadingChange(true);

    try {
      const maxWidth = Math.max(240, Math.floor(layout.width - margin * 2));
      const maxHeight = Math.max(240, Math.floor(layout.height - margin * 2));
      const imagePromise = renderPdfPage(activeSession.id, page, maxWidth, maxHeight);
      const textPromise = textCacheRef.current.has(page)
        ? Promise.resolve(textCacheRef.current.get(page) ?? '')
        : getPdfPageText(activeSession.id, page);
      // Attach a rejection handler before waiting on rendering so a slow
      // renderer cannot turn a fast text failure into an unhandled rejection.
      void textPromise.catch(() => {});
      const imageBase64 = await imagePromise;
      if (token !== renderTokenRef.current || activeSession !== sessionRef.current) return;

      const nextImage = `data:image/png;base64,${imageBase64}`;
      setPageImage(nextImage);
      setCurrentPage(page);
      callbacksRef.current.onPageChanged(page, activeSession.pageCount);
      callbacksRef.current.onLoadingChange(false);
      if (startupTimingRef.current && startupTimingRef.current.imageAt === undefined) {
        startupTimingRef.current.imageAt = Date.now();
        if (__DEV__) {
          console.debug('[Bussy Reader] PDF startup image ready', {
            openMs: startupTimingRef.current.openedAt === undefined
              ? undefined
              : startupTimingRef.current.openedAt - startupTimingRef.current.startedAt,
            imageMs: startupTimingRef.current.imageAt - startupTimingRef.current.startedAt,
          });
        }
      }

      void textPromise.then((text) => {
        if (token !== renderTokenRef.current || activeSession !== sessionRef.current) return;
        rememberText(page, text);
        callbacksRef.current.onPageText(page, text, false);
        if (startupTimingRef.current && startupTimingRef.current.textAt === undefined) {
          startupTimingRef.current.textAt = Date.now();
          if (__DEV__) {
            console.debug('[Bussy Reader] PDF startup text ready', {
              openMs: startupTimingRef.current.openedAt === undefined
                ? undefined
                : startupTimingRef.current.openedAt - startupTimingRef.current.startedAt,
              imageMs: startupTimingRef.current.imageAt === undefined
                ? undefined
                : startupTimingRef.current.imageAt - startupTimingRef.current.startedAt,
              textMs: startupTimingRef.current.textAt - startupTimingRef.current.startedAt,
            });
          }
        }

        const nextPage = page + 1;
        if (nextPage < activeSession.pageCount && !textCacheRef.current.has(nextPage)) {
          void getPdfPageText(activeSession.id, nextPage)
            .then((prefetchedText) => {
              if (activeSession !== sessionRef.current) return;
              rememberText(nextPage, prefetchedText);
              callbacksRef.current.onPageText(nextPage, prefetchedText, true);
            })
            .catch(() => {
              // Look-ahead is opportunistic; a failure must not affect the visible page.
            });
        }
      }).catch((error) => {
        if (token !== renderTokenRef.current || activeSession !== sessionRef.current) return;
        callbacksRef.current.onError(error instanceof Error ? error.message : 'The PDF page text could not be extracted.');
      });
    } catch (error) {
      if (token !== renderTokenRef.current || activeSession !== sessionRef.current) return;
      if (activateFallback()) {
        renderTokenRef.current += 1;
        return;
      }
      callbacksRef.current.onError(error instanceof Error ? error.message : 'The PDF page could not be rendered.');
    } finally {
      if (token === renderTokenRef.current) callbacksRef.current.onLoadingChange(false);
    }
  }, [activateFallback, layout.height, layout.width, margin, rememberText]);
  renderPageRef.current = renderPageForSession;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setSession(null);
      setPageImage(null);
      setHasError(false);
      setFallback(null);
      setPageCount(0);
      setCurrentPage(0);
      currentPageRef.current = 0;
      pageCountRef.current = 0;
      textCacheRef.current.clear();
      lastRenderedLayoutRef.current = null;
      renderTokenRef.current += 1;
      startupTimingRef.current = { startedAt: Date.now() };
      callbacksRef.current.onLoadingChange(true);

      try {
        const opened = await openPdfWithTimeout(uri);
        if (cancelled) {
          await closePdf(opened.id);
          return;
        }
        const nextSession = { id: opened.id, pageCount: Math.max(0, Math.floor(opened.pageCount)) };
        sessionRef.current = nextSession;
        pageCountRef.current = nextSession.pageCount;
        currentPageRef.current = nextSession.pageCount > 0
          ? clampPage(initialPage, nextSession.pageCount)
          : 0;
        setCurrentPage(currentPageRef.current);
        if (startupTimingRef.current) {
          startupTimingRef.current.openedAt = Date.now();
        }
        setSession(nextSession);
        setPageCount(nextSession.pageCount);
        callbacksRef.current.onLoaded(nextSession.pageCount);
        callbacksRef.current.onReady();

        if (nextSession.pageCount > 0) {
          // Wait for the measured surface size before rendering. Rendering once
          // at a fallback size and immediately repeating it makes startup slower.
        } else {
          callbacksRef.current.onLoadingChange(false);
          callbacksRef.current.onError('This PDF does not contain any readable pages.');
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'This PDF could not be opened.';
          if (message === PDF_RETRY_MESSAGE) setHasError(true);
          else if (activateFallback()) return;
          callbacksRef.current.onLoadingChange(false);
          callbacksRef.current.onError(message);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      renderTokenRef.current += 1;
      const active = sessionRef.current;
      sessionRef.current = null;
      if (active) void closePdf(active.id);
    };
  }, [activateFallback, initialPage, retryNonce, uri]);

  useEffect(() => {
    if (
      session
      && layout.width > 0
      && layout.height > 0
      && lastRenderedLayoutRef.current !== null
      && targetPage !== undefined
      && targetPage !== currentPageRef.current
    ) {
      void renderPageForSession(session, targetPage);
    }
  }, [layout.height, layout.width, renderPageForSession, session, targetPage]);

  useEffect(() => {
    if (session && layout.width > 0 && layout.height > 0) {
      const previous = lastRenderedLayoutRef.current;
      if (previous?.width === layout.width && previous.height === layout.height) return;
      lastRenderedLayoutRef.current = { width: layout.width, height: layout.height };
      void renderPageRef.current(session, currentPageRef.current);
    }
  }, [layout.height, layout.width, session]);

  useEffect(() => {
    if (session && onNavigateReady) {
      onNavigateReady((page) => {
        void renderPageForSession(session, page);
      });
    }
  }, [onNavigateReady, renderPageForSession, session]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((previous) => (
      previous.width === width && previous.height === height ? previous : { width, height }
    ));
  };

  const pageLabel = pageCount > 0 ? `${currentPage + 1} / ${pageCount}` : 'Loading PDF…';

  return (
    <View testID="pdf-reader-surface" onLayout={handleLayout} style={[styles.container, { backgroundColor: theme.background }]}>
      {fallback && !hasError ? (
        <PdfFallbackWebView
          key={`${uri}-${retryNonce}`}
          uri={uri}
          fileSize={fallback.fileSize}
          initialPage={initialPage}
          targetPage={targetPage}
          theme={theme}
          layout={layout}
          retryNonce={retryNonce}
          onLoaded={(count) => {
            pageCountRef.current = count;
            setPageCount(count);
            callbacksRef.current.onLoaded(count);
            callbacksRef.current.onReady();
          }}
          onPageChanging={(page) => {
            currentPageRef.current = page;
            callbacksRef.current.onPageChanging(page, pageCountRef.current);
            callbacksRef.current.onLoadingChange(true);
          }}
          onPageRendered={(page) => {
            currentPageRef.current = page;
            setCurrentPage(page);
            callbacksRef.current.onPageChanged(page, pageCountRef.current);
            callbacksRef.current.onLoadingChange(false);
          }}
          onPageText={(page, text) => {
            rememberText(page, text);
            callbacksRef.current.onPageText(page, text, false);
          }}
          onError={(message) => {
            setHasError(true);
            callbacksRef.current.onLoadingChange(false);
            callbacksRef.current.onError(message);
          }}
          onNavigateReady={onNavigateReady}
        />
      ) : pageImage ? (
        <Image
          accessibilityLabel={`PDF page ${pageLabel}`}
          resizeMode="contain"
          source={{ uri: pageImage }}
          style={styles.page}
        />
      ) : hasError ? (
        <Pressable
          accessibilityLabel={PDF_RETRY_MESSAGE}
          accessibilityRole="button"
          onPress={() => setRetryNonce((value) => value + 1)}
          style={styles.emptyPage}
        >
          <Text style={[styles.message, { color: theme.muted }]}>{PDF_RETRY_MESSAGE}</Text>
        </Pressable>
      ) : (
        <View style={styles.emptyPage}>
          <ActivityIndicator color={theme.foreground} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  page: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  emptyPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  message: {
    fontSize: 14,
  },
  fallbackWebView: {
    flex: 1,
    borderWidth: 0,
  },
});