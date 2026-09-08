import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  closePdf,
  getPdfPageText,
  openPdf,
  renderPdfPage,
} from '@/modules/bussy-reader-pdf/src';

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
  Math.max(0, Math.min(pageCount - 1, Math.floor(page)))
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
      callbacksRef.current.onError(error instanceof Error ? error.message : 'The PDF page could not be rendered.');
    } finally {
      if (token === renderTokenRef.current) callbacksRef.current.onLoadingChange(false);
    }
  }, [layout.height, layout.width, margin, rememberText]);
  renderPageRef.current = renderPageForSession;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setSession(null);
      setPageImage(null);
      setHasError(false);
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
  }, [initialPage, retryNonce, uri]);

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
      {pageImage ? (
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
});