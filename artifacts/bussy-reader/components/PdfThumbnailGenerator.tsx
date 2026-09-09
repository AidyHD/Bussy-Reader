import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { pdfjsSource, pdfjsWorkerSource } from '@/lib/pdfjs-source';

type PdfThumbnailGeneratorProps = {
  sourceUri: string;
  onComplete: (base64Png: string | null) => void;
};

type ThumbnailMessage =
  | { type: 'thumbnail'; base64Png: string }
  | { type: 'error'; message: string };

const THUMBNAIL_TIMEOUT_MS = 15_000;

const buildThumbnailHtml = (sourceUri: string) => `
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <canvas id="thumbnail"></canvas>
    <script type="module">
      const PDF_URI = ${JSON.stringify(sourceUri)};
      const PDFJS_SOURCE = ${JSON.stringify(pdfjsSource)};
      const PDFJS_WORKER_SOURCE = ${JSON.stringify(pdfjsWorkerSource)};
      const canvas = document.getElementById('thumbnail');

      const send = (payload) => {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      };

      try {
        const moduleUrl = URL.createObjectURL(new Blob([PDFJS_SOURCE], { type: 'text/javascript' }));
        const workerUrl = URL.createObjectURL(new Blob([PDFJS_WORKER_SOURCE], { type: 'text/javascript' }));
        const pdfjsLib = await import(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

        const pdf = await pdfjsLib.getDocument({
          url: PDF_URI,
          useWorkerFetch: false,
          disableAutoFetch: true,
          disableStream: false,
          isEvalSupported: false,
        }).promise;
        const pdfPage = await pdf.getPage(1);
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const maxWidth = 720;
        const maxHeight = 1024;
        const scale = Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height, 3);
        const viewport = pdfPage.getViewport({ scale });
        const pixelRatio = 2;
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = \`\${viewport.width}px\`;
        canvas.style.height = \`\${viewport.height}px\`;

        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('PDF thumbnail canvas is unavailable.');
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, viewport.width, viewport.height);
        await pdfPage.render({ canvasContext: context, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/png');
        pdfPage.cleanup();
        await pdf.cleanup();
        send({ type: 'thumbnail', base64Png: dataUrl.slice(dataUrl.indexOf(',') + 1) });
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : 'The PDF cover could not be generated.' });
      }
    </script>
  </body>
</html>
`;

export function PdfThumbnailGenerator({ sourceUri, onComplete }: PdfThumbnailGeneratorProps) {
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const html = useMemo(() => buildThumbnailHtml(sourceUri), [sourceUri]);

  onCompleteRef.current = onComplete;

  const complete = (base64Png: string | null) => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current(base64Png);
  };

  useEffect(() => {
    completedRef.current = false;
    const timeout = setTimeout(() => {
      console.warn('[Bussy Reader] PDF thumbnail timed out; using the styled placeholder cover.', {
        uri: sourceUri,
      });
      complete(null);
    }, THUMBNAIL_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [sourceUri]);

  const handleMessage = (event: WebViewMessageEvent) => {
    if (completedRef.current) return;
    try {
      const message = JSON.parse(event.nativeEvent.data) as ThumbnailMessage;
      if (message.type === 'error') {
        console.error('[Bussy Reader] Local PDF thumbnail parser error', {
          uri: sourceUri,
          message: message.message,
        });
      }
      complete(message.type === 'thumbnail' ? message.base64Png : null);
    } catch {
      complete(null);
    }
  };

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html, baseUrl: sourceUri.slice(0, Math.max(sourceUri.lastIndexOf('/') + 1, 0)) }}
      onMessage={handleMessage}
      onError={() => complete(null)}
      onHttpError={() => complete(null)}
      javaScriptEnabled
      domStorageEnabled
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      mixedContentMode="always"
      setSupportMultipleWindows={false}
      scrollEnabled={false}
      bounces={false}
      pointerEvents="none"
      style={styles.hiddenWebView}
    />
  );
}

const styles = StyleSheet.create({
  hiddenWebView: {
    position: 'absolute',
    left: -4,
    top: -4,
    width: 2,
    height: 2,
    opacity: 0.01,
  },
});