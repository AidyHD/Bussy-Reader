import { Buffer } from 'buffer';
import { File } from 'expo-file-system';

export const PDF_RANGE_CHUNK_SIZE = 256 * 1024;

const formatFileError = (uri: string, error: unknown) => {
  const details = error instanceof Error ? error.message : 'The local file could not be read.';
  return `Unable to access local PDF "${uri}". Verify that it still exists and can be opened. ${details}`;
};

export const getPdfFileSize = (uri: string) => {
  try {
    const file = new File(uri);
    if (!file.exists || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error('The file is missing, empty, or unreadable.');
    }
    return file.size;
  } catch (error) {
    throw new Error(formatFileError(uri, error));
  }
};

export const readPdfRangeAsBase64 = (uri: string, begin: number, end: number) => {
  const start = Math.max(0, Math.floor(begin));
  const requestedEnd = Math.max(start, Math.floor(end));
  const boundedEnd = Math.min(requestedEnd, start + PDF_RANGE_CHUNK_SIZE);
  if (boundedEnd <= start) {
    throw new Error('The PDF requested an empty byte range.');
  }

  let handle: ReturnType<File['open']> | null = null;
  try {
    handle = new File(uri).open();
    handle.offset = start;
    const bytes = handle.readBytes(boundedEnd - start);
    if (bytes.length === 0) {
      throw new Error('The PDF returned no bytes for a requested range.');
    }
    return Buffer.from(bytes).toString('base64');
  } catch (error) {
    throw new Error(formatFileError(uri, error));
  } finally {
    handle?.close();
  }
};