import { File } from 'expo-file-system';
import {
  getPdfFileSize,
  PDF_RANGE_CHUNK_SIZE,
  readPdfRangeAsBase64,
} from '@/lib/pdf-range-bridge';

const mockFile = File as unknown as jest.Mock;
const mockHandle = {
  offset: 0,
  readBytes: jest.fn((length: number) => new Uint8Array(length)),
  close: jest.fn(),
};

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
}));

describe('PDF range bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFile.mockImplementation(() => ({
      exists: true,
      size: 100 * 1024 * 1024,
      open: () => mockHandle,
    }));
  });

  it('caps native reads to one bounded range chunk', () => {
    const encoded = readPdfRangeAsBase64('file:///book.pdf', 4096, 100 * 1024 * 1024);

    expect(mockHandle.offset).toBe(4096);
    expect(mockHandle.readBytes).toHaveBeenCalledWith(PDF_RANGE_CHUNK_SIZE);
    expect(encoded).toBeTruthy();
    expect(mockHandle.close).toHaveBeenCalled();
  });

  it('reports actionable local-file errors when metadata is unavailable', () => {
    mockFile.mockImplementation(() => ({ exists: false, size: 0 }));

    expect(() => getPdfFileSize('file:///missing-book.pdf')).toThrow(
      'Unable to access local PDF "file:///missing-book.pdf". Verify that it still exists and can be opened.',
    );
  });
});