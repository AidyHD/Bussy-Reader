import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { pdfjsSource, pdfjsWorkerSource } from '@/lib/pdfjs-source';
import {
  getPdfFileSize,
  PDF_RANGE_CHUNK_SIZE,
  readPdfRangeAsBase64,
} from '@/lib/pdf-range-bridge';

type PdfThumbnailGeneratorProps = {
  sourceUri: string;
  onComplete: (base64Png: string | null) => void;
};

type ThumbnailMessage =
  | { type: 'thumbnail'; base64Png: string }
  | { type: 'error'; message: string };

const THUMBNAIL_TIMEOUT_MS = 15_000;

const buildThumbnailHtml = (sourceUri: string, fileSize: number) => `
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
       const PDF_FILE_SIZE = ${Math.max(0, Math.floor(fileSize))};
       const PDF_RANGE_CHUNK_SIZE = ${PDF_RANGE_CHUNK_SIZE};
      const PDFJS_SOURCE = ${JSON.stringify(pdfjsSource)};
      const PDFJS_WORKER_SOURCE = ${JSON.stringify(pdfjsWorkerSource)};
      const canvas = document.getElementById('thumbnail');

      const send = (payload) => {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
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

       const handleNativeMessage = (event) => {
         try {
           const payload = JSON.parse(event.data);
           if (payload.type === 'pdfRangeResponse') handleRangeResponse(payload);
         } catch (error) {
           send({ type: 'error', message: error instanceof Error ? error.message : 'The thumbnail reader received an invalid response.' });
         }
       };
       window.addEventListener('message', handleNativeMessage);
       document.addEventListener('message', handleNativeMessage);

       let pdf = null;
       let pdfPage = null;
       let workerUrl = null;
      try {
        const moduleUrl = URL.createObjectURL(new Blob([PDFJS_SOURCE], { type: 'text/javascript' }));
         workerUrl = URL.createObjectURL(new Blob([PDFJS_WORKER_SOURCE], { type: 'text/javascript' }));
        const pdfjsLib = await import(moduleUrl);
        URL.revokeObjectURL(moduleUrl);
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

         let LocalPdfRangeTransport = class extends pdfjsLib.PDFDataRangeTransport {
           requestDataRange(begin, end) {
             const requestId = nextRangeRequestId++;
             pendingRangeRequests.set(requestId, { next: begin, end });
             requestNextRange(requestId);
           }
         };
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
         pdfPage = await pdf.getPage(1);
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
        send({ type: 'thumbnail', base64Png: dataUrl.slice(dataUrl.indexOf(',') + 1) });
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : 'The PDF cover could not be generated.' });
       } finally {
         pdfPage?.cleanup();
         await pdf?.destroy().catch(() => {});
         if (workerUrl) URL.revokeObjectURL(workerUrl);
      }
    </script>
  </body>
</html>
`;

export function PdfThumbnailGenerator({ sourceUri, onComplete }: PdfThumbnailGeneratorProps) {
  const completedRef = useRef(false);
  const webViewRef = useRef<WebView>(null);
  const onCompleteRef = useRef(onComplete);
  const [fileSize, setFileSize] = React.useState<number | null>(null);

  onCompleteRef.current = onComplete;

  const complete = (base64Png: string | null) => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current(base64Png);
  };

  useEffect(() => {
    completedRef.current = false;
    setFileSize(null);
    try {
      setFileSize(getPdfFileSize(sourceUri));
    } catch (error) {
      console.error('[Bussy Reader] Failed to load local PDF for thumbnail', {
        uri: sourceUri,
        error,
      });
      complete(null);
    }
  }, [sourceUri]);

  const html = useMemo(() => fileSize === null ? null : buildThumbnailHtml(sourceUri, fileSize), [sourceUri, fileSize]);

  useEffect(() => {
    if (html === null) return;
    const timeout = setTimeout(() => {
      console.warn('[Bussy Reader] PDF thumbnail timed out; using the styled placeholder cover.', {
        uri: sourceUri,
      });
      complete(null);
    }, THUMBNAIL_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [html, sourceUri]);

  const handleMessage = (event: WebViewMessageEvent) => {
    if (completedRef.current) return;
    try {
       const message = JSON.parse(event.nativeEvent.data) as ThumbnailMessage | { type: 'pdfRangeRequest'; requestId: number; begin: number; end: number };
       if (message.type === 'pdfRangeRequest') {
         try {
           const base64 = readPdfRangeAsBase64(sourceUri, message.begin, message.end);
            webViewRef.current?.postMessage(JSON.stringify({
              type: 'pdfRangeResponse',
              requestId: message.requestId,
              begin: message.begin,
              base64,
            }));
         } catch (error) {
           console.error('[Bussy Reader] Local PDF thumbnail range error', {
             uri: sourceUri,
             error,
           });
            webViewRef.current?.postMessage(JSON.stringify({
              type: 'pdfRangeResponse',
              requestId: message.requestId,
              begin: message.begin,
              error: error instanceof Error ? error.message : 'The local PDF range could not be read.',
            }));
         }
         return;
       }
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

  if (html === null) return null;

  return (
    <WebView
      ref={webViewRef}
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