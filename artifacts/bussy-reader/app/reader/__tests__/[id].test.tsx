import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import ReaderScreen from '@/app/reader/[id]';

const mockPdfProps = {
  onLoaded: jest.fn(),
  onPageChanging: jest.fn(),
  onPageChanged: jest.fn(),
  onPageText: jest.fn(),
  spokenOffset: 0,
  onError: jest.fn(),
  onLoadingChange: jest.fn(),
  onReady: jest.fn(),
  onNavigateReady: jest.fn(),
};
const mockPdfNavigate = jest.fn();
const mockSpeechSpeak = Speech.speak as jest.Mock;
const mockSpeechStop = Speech.stop as jest.Mock;
const mockCreateAudioPlayer = createAudioPlayer as jest.Mock;
const mockAudioMode = setAudioModeAsync as jest.Mock;
const mockAlert = jest.spyOn(Alert, 'alert');
const mockStoredOffset = { value: 0 };
const mockUpdateProgress = jest.fn().mockResolvedValue(undefined);
const mockSilentPlayer = {
  play: jest.fn(),
  pause: jest.fn(),
  remove: jest.fn(),
  addListener: jest.fn((_event: string, listener: (status: { playing: boolean; isLoaded?: boolean }) => void) => {
    playbackStatusListener = listener;
    return mockSilentAudioStatusSubscription;
  }),
  playing: true,
  loop: false,
  volume: 1,
};
let appStateListener: ((state: AppStateStatus) => void) | null = null;
let playbackStatusListener: ((status: { playing: boolean; isLoaded?: boolean }) => void) | null = null;
const mockAppStateSubscription = { remove: jest.fn() };
const mockSilentAudioStatusSubscription = { remove: jest.fn() };
const mockReadAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;
const mockGetInfoAsync = FileSystem.getInfoAsync as jest.Mock;
const mockOpenPdf = jest.fn();
const mockRenderPdfPage = jest.fn();
const mockGetPdfPageText = jest.fn();
const mockClosePdf = jest.fn();

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
}));

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => mockSilentPlayer),
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/modules/bussy-reader-pdf/src', () => ({
  openPdf: mockOpenPdf,
  renderPdfPage: mockRenderPdfPage,
  getPdfPageText: mockGetPdfPageText,
  closePdf: mockClosePdf,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'book-1' }),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#000',
    foreground: '#fff',
    primary: '#fff',
    primaryForeground: '#000',
  }),
}));

jest.mock('@/context/LibraryContext', () => ({
  useLibrary: () => ({
    books: [{
      id: 'book-1',
      name: 'Regression PDF',
      type: 'pdf',
      uri: 'file:///regression.pdf',
      position: 0,
      spokenOffset: mockStoredOffset.value,
      bookmarks: [],
    }],
    settings: {
      keepAwake: false,
      theme: 'dark',
      margin: 24,
      fontSize: 18,
      lineSpacing: 1.5,
    },
    updateProgress: mockUpdateProgress,
    addBookmark: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('@/components/PdfReaderView', () => ({
  PdfReaderView: (props: typeof mockPdfProps) => {
    const mockReact = require('react') as typeof React;
    Object.assign(mockPdfProps, props);
    mockReact.useEffect(() => {
      props.onNavigateReady?.(mockPdfNavigate);
    }, [props.onNavigateReady]);
    return null;
  },
}));

describe('ReaderScreen read aloud PDF flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appStateListener = null;
    playbackStatusListener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener;
      return mockAppStateSubscription;
    });
    mockSilentPlayer.loop = false;
    mockSilentPlayer.volume = 1;
    mockSilentPlayer.playing = true;
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 200 * 1024 * 1024 });
    mockOpenPdf.mockResolvedValue({ id: 'session-1', pageCount: 2 });
    mockRenderPdfPage.mockResolvedValue('native-page-image');
    mockGetPdfPageText.mockResolvedValue('');
    mockClosePdf.mockResolvedValue(undefined);
    mockStoredOffset.value = 0;
    Object.assign(mockPdfProps, {
      onLoaded: jest.fn(),
      onPageChanging: jest.fn(),
      onPageChanged: jest.fn(),
      onPageText: jest.fn(),
      spokenOffset: 0,
      onError: jest.fn(),
      onLoadingChange: jest.fn(),
      onReady: jest.fn(),
      onNavigateReady: jest.fn(),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const renderReader = async () => {
    const screen = render(<ReaderScreen />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      mockPdfProps.onLoaded(2);
      mockPdfProps.onPageChanged(0, 2);
    });
    return screen;
  };

  it('skips a blank PDF page and continues read aloud on the next page', async () => {
    const screen = await renderReader();

    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
    });
    expect(mockCreateAudioPlayer).toHaveBeenCalledWith(
      'file:///cache/bussy-reader-silence.wav',
      expect.objectContaining({ keepAudioSessionActive: true }),
    );
    expect(mockSilentPlayer.loop).toBe(true);
    expect(mockSilentPlayer.volume).toBe(0);
    expect(mockSilentPlayer.play).toHaveBeenCalled();
    await act(async () => {
      mockPdfProps.onPageText(0, '   ');
      jest.runOnlyPendingTimers();
    });

    expect(mockPdfNavigate).toHaveBeenCalledWith(1);
    expect(mockSpeechSpeak).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
    expect(screen.getByText('Pause')).toBeTruthy();

    await act(async () => {
      mockPdfProps.onPageChanged(1, 2);
      mockPdfProps.onPageText(1, 'Text after the blank page');
    });

    expect(mockSpeechSpeak).toHaveBeenCalledWith(
      'Text after the blank page',
      expect.objectContaining({
        onDone: expect.any(Function),
        useApplicationAudioSession: true,
      }),
    );
  });

  it('passes large local PDFs to the reader without a JavaScript file read', async () => {
    await renderReader();

    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
  });

  it('does not reject a PDF based on file size', async () => {
    await renderReader();
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
  });

  it('keeps the reader and thumbnail paths URI-based and non-blocking', () => {
    const readerSource = readFileSync(join(__dirname, '../../../components/PdfReaderView.tsx'), 'utf8');
    const readerScreenSource = readFileSync(join(__dirname, '../[id].tsx'), 'utf8');
    const thumbnailSource = readFileSync(join(__dirname, '../../../components/PdfThumbnailGenerator.tsx'), 'utf8');
    const librarySource = readFileSync(join(__dirname, '../../../context/LibraryContext.tsx'), 'utf8');

    expect(readerSource).toContain('const PDF_URI =');
    expect(readerSource).toContain('pdfjsLib.getDocument');
    expect(readerSource).toContain('await openPdf({ url: PDF_URI });');
    expect(readerSource).not.toContain('readPdfRangeAsBase64');
    expect(readerSource).not.toContain('readAsStringAsync');
    expect(readerSource).toContain('Failed to render PDF page. Tap to retry.');
    expect(readerScreenSource).toContain('testID="pdf-loading-overlay"');
    expect(readerScreenSource).toContain('>Loading PDF…</Text>');
    expect(thumbnailSource).toContain('url: PDF_URI');
    expect(thumbnailSource).not.toContain('readPdfRangeAsBase64');
    expect(thumbnailSource).toContain('complete(null)');
    expect(thumbnailSource).toContain('THUMBNAIL_TIMEOUT_MS = 15_000');
    expect(thumbnailSource).toContain('onError={() => complete(null)}');
    expect(thumbnailSource).toContain('const workerUrl = URL.createObjectURL');
    expect(librarySource).toContain('try {');
    expect(librarySource).toContain('coverUri = (await generatePdfThumbnail');
  });

  it('requests the next PDF page directly from speech onDone and speaks its text', async () => {
    const screen = await renderReader();
    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
    });
    await act(async () => {
      mockPdfProps.onPageText(0, 'First page text');
    });

    const firstSpeechOptions = mockSpeechSpeak.mock.calls[0][1];

    await act(async () => {
      firstSpeechOptions.onDone();
    });

    expect(mockPdfNavigate).toHaveBeenCalledWith(1);
    expect(mockSpeechSpeak).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockPdfProps.onPageChanged(1, 2);
      mockPdfProps.onPageText(1, 'Second page text');
    });

    expect(mockSpeechSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeechSpeak.mock.calls[1][0]).toBe('Second page text');
    expect(mockSpeechSpeak.mock.calls[1][1].useApplicationAudioSession).toBe(true);
    expect(screen.getByText('Pause')).toBeTruthy();

    await act(async () => {
      // The WebView can emit a duplicate pageChanging event after the
      // programmatic page transition has already completed.
      mockPdfProps.onPageChanging(1, 2);
    });
    expect(screen.getByText('Pause')).toBeTruthy();

    await act(async () => {
      mockSpeechSpeak.mock.calls[1][1].onDone();
    });
    expect(mockSilentPlayer.pause).toHaveBeenCalled();
    expect(mockSilentPlayer.remove).toHaveBeenCalled();
    expect(screen.getByText('Read aloud')).toBeTruthy();
  });

  it('speaks a prefetched next page without waiting for its render callback', async () => {
    const screen = await renderReader();
    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
      mockPdfProps.onPageText(0, 'First page text');
      mockPdfProps.onPageText(1, 'Prefetched second page text', true);
    });

    const firstSpeechOptions = mockSpeechSpeak.mock.calls[0][1];
    await act(async () => {
      firstSpeechOptions.onDone();
    });

    expect(mockPdfNavigate).toHaveBeenCalledWith(1);
    expect(mockSpeechSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeechSpeak.mock.calls[1][0]).toBe('Prefetched second page text');
    expect(screen.getByText('Pause')).toBeTruthy();
  });

  it('cancels on manual navigation and ignores stale speech callbacks', async () => {
    const screen = await renderReader();
    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
    });
    await act(async () => {
      mockPdfProps.onPageText(0, 'First page text');
    });

    const firstSpeechOptions = mockSpeechSpeak.mock.calls[0][1];

    await act(async () => {
      mockPdfProps.onPageChanging(1, 2);
    });

    expect(mockSpeechStop).toHaveBeenCalled();
    expect(screen.getByText('Read aloud')).toBeTruthy();

    await act(async () => {
      firstSpeechOptions.onDone();
      mockPdfProps.onPageText(1, 'Stale page text');
    });

    expect(mockSpeechSpeak).toHaveBeenCalledTimes(1);
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockAudioMode).toHaveBeenCalledWith({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    });
    expect(mockSilentPlayer.pause).toHaveBeenCalled();
    expect(mockSilentPlayer.remove).toHaveBeenCalled();
  });

  it('releases the silent player when the reader unmounts during speech', async () => {
    const screen = await renderReader();
    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
      mockPdfProps.onPageText(0, 'First page text');
    });

    screen.unmount();

    expect(mockSilentPlayer.pause).toHaveBeenCalled();
    expect(mockSilentPlayer.remove).toHaveBeenCalled();
  });

  it('resumes the current PDF page from its latest speech boundary after an interruption', async () => {
    const screen = await renderReader();
    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
      mockPdfProps.onPageText(0, '0123456789');
    });

    const firstSpeechOptions = mockSpeechSpeak.mock.calls[0][1];
    expect(playbackStatusListener).not.toBeNull();

    await act(async () => {
      firstSpeechOptions.onBoundary({ charIndex: 3, charLength: 2 });
      mockSilentPlayer.playing = false;
      playbackStatusListener?.({ playing: false, isLoaded: true });
      firstSpeechOptions.onStopped();
    });

    expect(screen.getByText('Pause')).toBeTruthy();
    expect(mockSilentPlayer.pause).not.toHaveBeenCalled();
    expect(mockSilentPlayer.remove).not.toHaveBeenCalled();

    await act(async () => {
      mockSilentPlayer.playing = true;
      playbackStatusListener?.({ playing: true, isLoaded: true });
    });

    expect(mockSpeechSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeechSpeak.mock.calls[1][0]).toBe('56789');
    expect(mockSpeechSpeak.mock.calls[1][1].useApplicationAudioSession).toBe(true);
    expect(screen.getByText('Pause')).toBeTruthy();
  });

  it('recovers once per repeated interruption without replacing the keep-alive subscription', async () => {
    const screen = await renderReader();
    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
      mockPdfProps.onPageText(0, 'First page text');
    });

    expect(playbackStatusListener).not.toBeNull();
    expect(mockSilentPlayer.addListener).toHaveBeenCalledTimes(1);
    const firstSpeechOptions = mockSpeechSpeak.mock.calls[0][1];

    await act(async () => {
      mockSilentPlayer.playing = false;
      playbackStatusListener?.({ playing: false, isLoaded: true });
      playbackStatusListener?.({ playing: false, isLoaded: true });
      firstSpeechOptions.onStopped();
    });

    expect(mockSpeechSpeak).toHaveBeenCalledTimes(1);
    expect(mockSilentAudioStatusSubscription.remove).not.toHaveBeenCalled();

    await act(async () => {
      mockSilentPlayer.playing = true;
      playbackStatusListener?.({ playing: true, isLoaded: true });
    });

    expect(mockSpeechSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeechSpeak.mock.calls[1][0]).toBe('First page text');
    const secondSpeechOptions = mockSpeechSpeak.mock.calls[1][1];

    await act(async () => {
      mockSilentPlayer.playing = false;
      playbackStatusListener?.({ playing: false, isLoaded: true });
      secondSpeechOptions.onStopped();
      playbackStatusListener?.({ playing: false, isLoaded: true });
    });

    expect(mockSpeechSpeak).toHaveBeenCalledTimes(2);
    expect(mockSilentAudioStatusSubscription.remove).not.toHaveBeenCalled();

    await act(async () => {
      mockSilentPlayer.playing = true;
      playbackStatusListener?.({ playing: true, isLoaded: true });
      playbackStatusListener?.({ playing: true, isLoaded: true });
    });

    expect(mockSpeechSpeak).toHaveBeenCalledTimes(3);
    expect(mockSpeechSpeak.mock.calls[2][0]).toBe('First page text');
    expect(mockSilentPlayer.addListener).toHaveBeenCalledTimes(1);
    expect(mockSilentAudioStatusSubscription.remove).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
    });

    expect(mockSilentAudioStatusSubscription.remove).toHaveBeenCalledTimes(1);
    expect(mockSilentPlayer.pause).toHaveBeenCalledTimes(1);
    expect(mockSilentPlayer.remove).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Read aloud')).toBeTruthy();
  });

  it('stops and releases the keep-alive after an unrecoverable speech error', async () => {
    const screen = await renderReader();
    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
      mockPdfProps.onPageText(0, 'First page text');
    });

    await act(async () => {
      mockSpeechSpeak.mock.calls[0][1].onError(new Error('speech service unavailable'));
    });

    expect(screen.getByText('Read aloud')).toBeTruthy();
    expect(mockSilentAudioStatusSubscription.remove).toHaveBeenCalledTimes(1);
    expect(mockSilentPlayer.pause).toHaveBeenCalled();
    expect(mockSilentPlayer.remove).toHaveBeenCalled();
  });

  it('reasserts background audio and resumes the silent keep-alive across app sleep', async () => {
    const screen = await renderReader();
    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
      mockPdfProps.onPageText(0, 'First page text');
    });

    expect(appStateListener).not.toBeNull();
    mockSilentPlayer.playing = false;
    await act(async () => {
      appStateListener?.('background');
    });

    expect(mockAudioMode).toHaveBeenCalledWith({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    expect(mockSilentPlayer.play).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Pause')).toBeTruthy();

    screen.unmount();
  });

  it('resumes speech from the saved character offset and forwards it to the PDF highlight layer', async () => {
    mockStoredOffset.value = 6;
    const screen = await renderReader();

    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
      mockPdfProps.onPageText(0, '0123456789');
    });

    expect(mockSpeechSpeak.mock.calls[0][0]).toBe('6789');
    expect(mockPdfProps.spokenOffset).toBe(6);
    expect(screen.getByTestId('reading-offset').props.children).toBe('60%');
  });

  it('advances the saved highlight from speech boundaries during an utterance', async () => {
    const screen = await renderReader();
    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
      mockPdfProps.onPageText(0, '0123456789');
    });

    const speechOptions = mockSpeechSpeak.mock.calls[0][1];
    await act(async () => {
      speechOptions.onBoundary({ charIndex: 3, charLength: 2 });
    });

    expect(mockPdfProps.spokenOffset).toBe(5);
    expect(screen.getByTestId('reading-offset').props.children).toBe('50%');
    expect(mockUpdateProgress).toHaveBeenLastCalledWith('book-1', 0, 2, 5);
  });

  it('resets the spoken offset when the page changes and persists the reset', async () => {
    const screen = await renderReader();
    await act(async () => {
      mockPdfProps.onPageText(0, 'First page text');
    });
    mockUpdateProgress.mockClear();

    await act(async () => {
      mockPdfProps.onPageChanged(1, 2);
      mockPdfProps.onPageText(1, 'Second page text');
    });

    expect(screen.getByTestId('reading-offset').props.children).toBe('0%');
    expect(mockUpdateProgress).toHaveBeenCalledWith('book-1', 1, 2, 0);
  });

  it('cancels speech and moves the highlight when the reading scrubber is dragged', async () => {
    const screen = await renderReader();
    await act(async () => {
      fireEvent.press(screen.getByTestId('read-aloud-button'));
      mockPdfProps.onPageText(0, '0123456789');
    });
    await act(async () => {
      fireEvent(screen.getByTestId('reading-scrubber'), 'layout', {
        nativeEvent: { layout: { width: 100, height: 28 } },
      });
    });
    await act(async () => {
      fireEvent(screen.getByTestId('reading-scrubber'), 'touchStart', {
        nativeEvent: { locationX: 50 },
      });
    });

    expect(mockSpeechStop).toHaveBeenCalled();
    expect(screen.getByTestId('reading-offset').props.children).toBe('50%');
    expect(mockPdfProps.spokenOffset).toBe(5);
  });
});