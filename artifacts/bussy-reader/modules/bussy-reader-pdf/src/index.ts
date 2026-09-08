import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';

type NativePdfModule = {
  open: (uri: string) => Promise<{ id: string; pageCount: number }>;
  renderPage: (sessionId: string, pageIndex: number, maxWidth: number, maxHeight: number) => Promise<string>;
  getPageText: (sessionId: string, pageIndex: number) => Promise<string>;
  close: (sessionId: string) => Promise<void>;
};

let nativeModule: NativePdfModule | null | undefined;

const getNativePdfModule = () => {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  if (nativeModule !== undefined) return nativeModule;
  try {
    nativeModule = requireNativeModule<NativePdfModule>('BussyReaderPdf');
  } catch {
    nativeModule = null;
  }
  return nativeModule;
};

export const openPdf = (uri: string) => {
  const native = getNativePdfModule();
  if (!native) throw new Error('Native PDF reading is unavailable in this app build.');
  return native.open(uri);
};

export const renderPdfPage = (
  sessionId: string,
  pageIndex: number,
  maxWidth: number,
  maxHeight: number,
) => {
  const native = getNativePdfModule();
  if (!native) throw new Error('Native PDF rendering is unavailable in this app build.');
  return native.renderPage(sessionId, pageIndex, maxWidth, maxHeight);
};

export const getPdfPageText = (sessionId: string, pageIndex: number) => {
  const native = getNativePdfModule();
  if (!native) throw new Error('Native PDF text extraction is unavailable in this app build.');
  return native.getPageText(sessionId, pageIndex);
};

export const closePdf = (sessionId: string) => {
  const native = getNativePdfModule();
  if (native) return native.close(sessionId);
  return Promise.resolve();
};