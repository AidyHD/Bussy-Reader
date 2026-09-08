import { Feather } from '@expo/vector-icons';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as KeepAwake from 'expo-keep-awake';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Modal, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { PdfReaderView } from '@/components/PdfReaderView';
import { Book, useLibrary } from '@/context/LibraryContext';
import { useColors } from '@/hooks/useColors';
import * as ReadAloudSpeech from '@/modules/bussy-reader-speech/src';

const chunkText = (text: string) => text.split(/\n\s*\n/).map((chunk) => chunk.trim()).filter(Boolean).reduce<string[]>((pages, chunk) => {
  if (chunk.length <= 1800) return [...pages, chunk];
  for (let index = 0; index < chunk.length; index += 1800) pages.push(chunk.slice(index, index + 1800));
  return pages;
}, []);

const sampleForUnsupported = (book: Book) => `This ${book.type.toUpperCase()} is stored locally and ready to read.\n\nBussy Reader keeps the original file private on this device. Native pagination is enabled for this document format in the reader shell, and your position will be restored the next time you open it.\n\nUse the controls below to adjust your reading surface, add a bookmark, or start read aloud.`;

const SPEECH_RATES = [0.8, 1, 1.05, 1.25, 1.5] as const;
type SpeechRate = (typeof SPEECH_RATES)[number];
const DEFAULT_SPEECH_RATE: SpeechRate = 1.05;
const MAX_SPEECH_SEGMENT_LENGTH = 320;
const PDF_TEXT_CACHE_LIMIT = 2;

type SpeechSegment = {
  text: string;
  start: number;
  end: number;
};

const splitSpeechSegments = (text: string, startOffset: number): SpeechSegment[] => {
  const start = Math.max(0, Math.min(text.length, Math.floor(startOffset)));
  const remaining = text.slice(start);
  if (!remaining) return [];

  const segments: SpeechSegment[] = [];
  let cursor = start;
  let remainingText = remaining;
  while (remainingText.length > 0) {
    let length = Math.min(MAX_SPEECH_SEGMENT_LENGTH, remainingText.length);
    if (remainingText.length > MAX_SPEECH_SEGMENT_LENGTH) {
      const boundary = remainingText.slice(0, MAX_SPEECH_SEGMENT_LENGTH).search(/[.!?](?:\s|$)[\s\S]*$/);
      if (boundary >= 0) length = boundary + 1;
      else {
        const space = remainingText.lastIndexOf(' ', MAX_SPEECH_SEGMENT_LENGTH);
        if (space > 80) length = space;
      }
    }
    const segmentText = remainingText.slice(0, length).trim();
    const leadingWhitespace = remainingText.slice(0, length).search(/\S/);
    const segmentStart = cursor + Math.max(0, leadingWhitespace);
    const segmentEnd = segmentStart + segmentText.length;
    if (segmentText) segments.push({ text: segmentText, start: segmentStart, end: segmentEnd });
    cursor += length;
    remainingText = remainingText.slice(length);
  }
  return segments;
};
const AUDIO_MODE = {
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'doNotMix',
} as const;

const INACTIVE_AUDIO_MODE = {
  playsInSilentMode: false,
  shouldPlayInBackground: false,
  interruptionMode: 'doNotMix',
} as const;
const SILENT_AUDIO_FILE_NAME = 'bussy-reader-silence.wav';
const SILENT_AUDIO_BASE64 = 'UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YcgAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

export default function ReaderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { books, settings, updateProgress, addBookmark } = useLibrary();
  const book = books.find((item) => item.id === id);
  const [pages, setPages] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [activePageText, setActivePageText] = useState('');
  const [overlay, setOverlay] = useState(true);
  const [bookmarksVisible, setBookmarksVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const [spokenOffset, setSpokenOffset] = useState(0);
  const [speechRate, setSpeechRate] = useState<SpeechRate>(DEFAULT_SPEECH_RATE);
  const [ttsVisible, setTtsVisible] = useState(false);
  const [activeTextPage, setActiveTextPage] = useState<number | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const listRef = useRef<FlatList<string>>(null);
  const pageRef = useRef(page);
  const pageCountRef = useRef(0);
  const speechSessionRef = useRef(0);
  const speechPageRef = useRef<number | null>(null);
  const speechTextRef = useRef<{ page: number; text: string; session: number } | null>(null);
  const speechInterruptedRef = useRef(false);
  const speechInFlightRef = useRef(false);
  const activeSpeechUtteranceRef = useRef<string | null>(null);
  const speechRecoveryAttemptsRef = useRef(0);
  const speechUtteranceRef = useRef(0);
  const spokenOffsetRef = useRef(0);
  const speechBoundaryOffsetRef = useRef<number | null>(null);
  const isReadingAloudRef = useRef(false);
  const bookRef = useRef(book);
  const pagesRef = useRef(pages);
  const pageTextCacheRef = useRef(new Map<number, string>());
  const navigatePdfRef = useRef<((page: number) => void) | null>(null);
  const pendingSpeechPageRef = useRef<number | null>(null);
  const ttsNavigationPageRef = useRef<number | null>(null);
  const speakPageRef = useRef<((page: number, text: string, session: number, requestedOffset?: number) => void) | null>(null);
  const requestSpeechPageRef = useRef<((page: number, session: number) => void) | null>(null);
  const silentAudioPlayerRef = useRef<AudioPlayer | null>(null);
  const silentAudioStatusSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const silentAudioStartedRef = useRef(false);
  const silentAudioUriRef = useRef<string | null>(null);
  const silentAudioPreparationRef = useRef<Promise<string> | null>(null);

  const prepareSilentAudio = () => {
    if (silentAudioUriRef.current) return Promise.resolve(silentAudioUriRef.current);
    if (silentAudioPreparationRef.current) return silentAudioPreparationRef.current;

    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory) return Promise.reject(new Error('Audio cache is unavailable on this device.'));

    const uri = `${cacheDirectory}${SILENT_AUDIO_FILE_NAME}`;
    const preparation = FileSystem.writeAsStringAsync(uri, SILENT_AUDIO_BASE64, { encoding: 'base64' })
      .then(() => {
        silentAudioUriRef.current = uri;
        return uri;
      })
      .catch((error) => {
        silentAudioPreparationRef.current = null;
        throw error;
      });
    silentAudioPreparationRef.current = preparation;
    return preparation;
  };

  const releaseSilentAudio = () => {
    silentAudioStartedRef.current = false;
    silentAudioStatusSubscriptionRef.current?.remove();
    silentAudioStatusSubscriptionRef.current = null;
    const player = silentAudioPlayerRef.current;
    silentAudioPlayerRef.current = null;
    speechInterruptedRef.current = false;
    speechBoundaryOffsetRef.current = null;
    if (!player) return;
    try {
      player.pause();
    } catch {
      // The native player may already be released during an interruption.
    }
    try {
      player.remove();
    } catch {
      // Cleanup is intentionally idempotent across speech and unmount callbacks.
    }
  };

  const startSilentAudio = async (session: number) => {
    const uri = await prepareSilentAudio();
    if (session !== speechSessionRef.current || !isReadingAloudRef.current) return;

    const player = createAudioPlayer(uri, {
      updateInterval: 1000,
      keepAudioSessionActive: true,
    });
    try {
      player.loop = true;
      player.volume = 0;
      silentAudioPlayerRef.current = player;
      silentAudioStatusSubscriptionRef.current = player.addListener('playbackStatusUpdate', (status) => {
        if (session !== speechSessionRef.current || !isReadingAloudRef.current || !silentAudioStartedRef.current) return;

        if (status.isLoaded === false) {
          stopReading();
          return;
        }

        if (!status.playing) {
          if (!speechInFlightRef.current || speechInterruptedRef.current) return;
          speechInterruptedRef.current = true;
          speechInFlightRef.current = false;
          ReadAloudSpeech.stop();
          return;
        }

        if (!speechInterruptedRef.current) return;
        speechInterruptedRef.current = false;
        const interruptedSpeech = speechTextRef.current;
        if (
          interruptedSpeech
          && interruptedSpeech.session === session
          && interruptedSpeech.page === speechPageRef.current
        ) {
          speakPageRef.current?.(
            interruptedSpeech.page,
            interruptedSpeech.text,
            session,
            speechBoundaryOffsetRef.current ?? spokenOffsetRef.current,
          );
        } else {
          requestSpeechPageRef.current?.(pageRef.current, session);
        }
      });
      player.play();
      silentAudioStartedRef.current = true;
    } catch (error) {
      silentAudioStatusSubscriptionRef.current?.remove();
      silentAudioStatusSubscriptionRef.current = null;
      player.remove();
      throw error;
    }
  };

  useEffect(() => {
    if (settings.keepAwake) {
      void KeepAwake.activateKeepAwakeAsync();
    } else {
      void KeepAwake.deactivateKeepAwake();
    }
    return () => { void KeepAwake.deactivateKeepAwake(); };
  }, [settings.keepAwake]);

  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setActivePageText('');
      setActiveTextPage(null);
      setTotalPages(0);
      try {
        if (book.type === 'pdf') {
          const info = await FileSystem.getInfoAsync(book.uri);
          if (!info.exists) {
            throw new Error('The local PDF file no longer exists. Try importing it again.');
          }
          if (cancelled) return;
          setPages([]);
          setPage(book.position);
          setSpokenOffset(Math.max(0, Math.floor(book.spokenOffset ?? 0)));
          return;
        }
        const content = book.type === 'txt'
          ? await FileSystem.readAsStringAsync(book.uri)
          : sampleForUnsupported(book);
        const loadedPages = chunkText(content);
        if (cancelled) return;
        setPages(loadedPages.length ? loadedPages : ['This document has no readable text.']);
        setTotalPages(loadedPages.length || 1);
        setPage(Math.min(book.position, Math.max(loadedPages.length - 1, 0)));
        setSpokenOffset(Math.max(0, Math.floor(book.spokenOffset ?? 0)));
      } catch (error) {
        console.error('[Bussy Reader] Failed to load local document', {
          uri: book.uri,
          error,
        });
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'This document could not be opened.');
          setLoading(false);
        }
      } finally {
        if (!cancelled && book.type !== 'pdf') setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [book?.id, book?.uri, book?.type]);

  useEffect(() => {
    const count = book?.type === 'pdf' ? totalPages : pages.length;
    if (!book || count === 0) return;
    void updateProgress(book.id, Math.min(page, count - 1), count, spokenOffset);
  }, [book?.id, page, pages.length, totalPages, spokenOffset]);

  const pageCount = book?.type === 'pdf' ? totalPages : pages.length;
  const pageWidth = stageSize.width || windowWidth;
  const pageHeight = stageSize.height || Math.max(1, windowHeight - insets.top - insets.bottom - 180);

  bookRef.current = book;
  pagesRef.current = pages;
  isReadingAloudRef.current = isReadingAloud;
  pageRef.current = page;
  pageCountRef.current = pageCount;
  spokenOffsetRef.current = spokenOffset;

  const currentPageText = book?.type === 'pdf'
    ? (activeTextPage === page ? activePageText : pageTextCacheRef.current.get(page) ?? '')
    : pages[page] ?? '';
  const currentTextLength = currentPageText.length;
  const visibleSpokenOffset = Math.max(0, Math.min(currentTextLength, spokenOffset));

  const updateSpokenOffset = (nextOffset: number) => {
    const clamped = Math.max(0, Math.min(currentTextLength, Math.floor(nextOffset)));
    spokenOffsetRef.current = clamped;
    setSpokenOffset(clamped);
  };

  const setSpokenOffsetValue = (nextOffset: number) => {
    const clamped = Math.max(0, Math.floor(nextOffset));
    spokenOffsetRef.current = clamped;
    setSpokenOffset(clamped);
  };

  const resetSpokenOffset = () => {
    spokenOffsetRef.current = 0;
    speechBoundaryOffsetRef.current = null;
    setSpokenOffset(0);
  };

  const cachePdfPageText = (textPage: number, text: string) => {
    pageTextCacheRef.current.delete(textPage);
    pageTextCacheRef.current.set(textPage, text);
    while (pageTextCacheRef.current.size > PDF_TEXT_CACHE_LIMIT) {
      const oldestPage = pageTextCacheRef.current.keys().next().value;
      if (oldestPage === undefined) break;
      pageTextCacheRef.current.delete(oldestPage);
    }
  };

  const finishReading = (session: number) => {
    if (session !== speechSessionRef.current) return;
    isReadingAloudRef.current = false;
    speechInFlightRef.current = false;
    activeSpeechUtteranceRef.current = null;
    speechRecoveryAttemptsRef.current = 0;
    speechPageRef.current = null;
    speechTextRef.current = null;
    speechInterruptedRef.current = false;
    pendingSpeechPageRef.current = null;
    ttsNavigationPageRef.current = null;
    releaseSilentAudio();
    setIsReadingAloud(false);
    void setAudioModeAsync(INACTIVE_AUDIO_MODE);
  };

  const stopReading = () => {
    speechSessionRef.current += 1;
    isReadingAloudRef.current = false;
    speechInFlightRef.current = false;
    activeSpeechUtteranceRef.current = null;
    speechRecoveryAttemptsRef.current = 0;
    speechPageRef.current = null;
    speechTextRef.current = null;
    speechInterruptedRef.current = false;
    pendingSpeechPageRef.current = null;
    ttsNavigationPageRef.current = null;
    releaseSilentAudio();
    setIsReadingAloud(false);
    ReadAloudSpeech.stop();
    void setAudioModeAsync(INACTIVE_AUDIO_MODE);
  };

  const scrubToOffset = (nextOffset: number) => {
    if (currentTextLength === 0) return;
    if (isReadingAloudRef.current) stopReading();
    updateSpokenOffset(nextOffset);
  };

  const scrubFromLocation = (locationX: number) => {
    if (scrubberWidth > 0) scrubToOffset((locationX / scrubberWidth) * currentTextLength);
  };

  const [scrubberWidth, setScrubberWidth] = useState(0);
  const scrubberPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => currentTextLength > 0,
    onMoveShouldSetPanResponder: () => currentTextLength > 0,
    onPanResponderGrant: (event) => {
      scrubFromLocation(event.nativeEvent.locationX);
    },
    onPanResponderMove: (event) => {
      scrubFromLocation(event.nativeEvent.locationX);
    },
  }), [currentTextLength, scrubberWidth, scrubFromLocation]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => {
      if (!isReadingAloudRef.current) return;

      void setAudioModeAsync(AUDIO_MODE).catch(() => {
        if (isReadingAloudRef.current) stopReading();
      });

      const player = silentAudioPlayerRef.current;
      if (!player || player.playing) return;

      if (speechInFlightRef.current && !speechInterruptedRef.current) {
        speechInterruptedRef.current = true;
        speechInFlightRef.current = false;
        ReadAloudSpeech.stop();
      }

      try {
        player.play();
      } catch {
        if (isReadingAloudRef.current) stopReading();
      }
    });

    return () => subscription.remove();
  }, []);

  const speakPage = (targetPage: number, text: string, session: number, requestedOffset?: number) => {
    if (session !== speechSessionRef.current || !isReadingAloudRef.current) return;
    const count = pageCountRef.current;
    if (targetPage < 0 || targetPage >= count) {
      finishReading(session);
      return;
    }

    pendingSpeechPageRef.current = null;
    const textToSpeak = text.trim();
    const startOffset = Math.max(0, Math.min(textToSpeak.length, Math.floor(
      requestedOffset ?? (targetPage === pageRef.current ? spokenOffsetRef.current : 0),
    )));
    const segments = splitSpeechSegments(textToSpeak, startOffset);
    if (segments.length === 0) {
      speechPageRef.current = null;
      speechInFlightRef.current = false;
      if (targetPage < count - 1) {
        if (session === speechSessionRef.current) requestSpeechPageRef.current?.(targetPage + 1, session);
      } else {
        finishReading(session);
      }
      return;
    }

    const speakSegment = (segmentIndex: number) => {
      if (session !== speechSessionRef.current || !isReadingAloudRef.current) return;
      const segment = segments[segmentIndex];
      if (!segment) return;

      setSpokenOffsetValue(segment.start);
      speechBoundaryOffsetRef.current = null;
      speechPageRef.current = targetPage;
      speechTextRef.current = { page: targetPage, text: textToSpeak, session };
      speechInFlightRef.current = true;
      const utteranceId = `bussy-reader-${session}-${targetPage}-${speechUtteranceRef.current++}`;
      activeSpeechUtteranceRef.current = utteranceId;
      ReadAloudSpeech.speak(segment.text, {
        utteranceId,
        rate: speechRate,
          onBoundary: ({ charIndex, charLength }) => {
            if (
              session !== speechSessionRef.current
              || !isReadingAloudRef.current
              || activeSpeechUtteranceRef.current !== utteranceId
              || speechInterruptedRef.current
            ) return;

            const boundaryEnd = Math.min(
              segment.end,
              segment.start + Math.max(0, Math.floor(charIndex)) + Math.max(0, Math.floor(charLength)),
            );
            if (
              speechBoundaryOffsetRef.current === null
              || boundaryEnd > speechBoundaryOffsetRef.current
            ) {
              speechBoundaryOffsetRef.current = boundaryEnd;
              if (boundaryEnd > spokenOffsetRef.current) setSpokenOffsetValue(boundaryEnd);
            }
          },
        onDone: () => {
          if (
            session !== speechSessionRef.current
            || !isReadingAloudRef.current
            || activeSpeechUtteranceRef.current !== utteranceId
          ) return;
          if (speechInterruptedRef.current) return;
          activeSpeechUtteranceRef.current = null;
          speechRecoveryAttemptsRef.current = 0;
          setSpokenOffsetValue(segment.end);
          if (segmentIndex < segments.length - 1) {
            speakSegment(segmentIndex + 1);
            return;
          }
          speechInFlightRef.current = false;
          speechPageRef.current = null;
          if (targetPage < pageCountRef.current - 1) {
            requestSpeechPageRef.current?.(targetPage + 1, session);
          } else {
            finishReading(session);
          }
        },
        onStopped: () => {
          if (session !== speechSessionRef.current || activeSpeechUtteranceRef.current !== utteranceId) return;
          activeSpeechUtteranceRef.current = null;
          speechInFlightRef.current = false;
          const silentPlayer = silentAudioPlayerRef.current;
          if (silentPlayer && !silentPlayer.playing) {
            speechInterruptedRef.current = true;
            return;
          }
          if (speechInterruptedRef.current) return;
          speechPageRef.current = null;
          isReadingAloudRef.current = false;
          releaseSilentAudio();
          setIsReadingAloud(false);
          void setAudioModeAsync(INACTIVE_AUDIO_MODE);
        },
        onError: () => {
          if (session !== speechSessionRef.current || activeSpeechUtteranceRef.current !== utteranceId) return;
          activeSpeechUtteranceRef.current = null;
          speechInFlightRef.current = false;
          speechPageRef.current = null;
          speechTextRef.current = null;
          speechInterruptedRef.current = false;
          isReadingAloudRef.current = false;
          releaseSilentAudio();
          setIsReadingAloud(false);
          void setAudioModeAsync(INACTIVE_AUDIO_MODE);
          Alert.alert('Read aloud stopped', 'Speech could not continue on this page.');
        },
        onServiceLost: () => {
          if (session !== speechSessionRef.current || !isReadingAloudRef.current) return;
          if (activeSpeechUtteranceRef.current !== utteranceId) return;

          activeSpeechUtteranceRef.current = null;
          speechInFlightRef.current = false;
          speechInterruptedRef.current = false;
          if (speechRecoveryAttemptsRef.current >= 1) {
            stopReading();
            Alert.alert(
              'Read aloud stopped',
              'Android speech service was lost twice. Tap Read aloud to try again.',
            );
            return;
          }

          speechRecoveryAttemptsRef.current += 1;
          speakPageRef.current?.(targetPage, textToSpeak, session, segment.start);
        },
      });
    };

    speakSegment(0);
  };

  const requestSpeechPage = (targetPage: number, session: number) => {
    if (session !== speechSessionRef.current || !isReadingAloudRef.current) return;
    const count = pageCountRef.current;
    if (targetPage < 0 || targetPage >= count) {
      finishReading(session);
      return;
    }

    pendingSpeechPageRef.current = targetPage;
    const currentBook = bookRef.current;
    if (!currentBook) return;

    if (currentBook.type !== 'pdf') {
      if (pageRef.current !== targetPage) resetSpokenOffset();
      setPage(targetPage);
      speakPageRef.current?.(targetPage, pagesRef.current[targetPage] ?? '', session);
      return;
    }

    const shouldNavigate = pageRef.current !== targetPage;
    if (shouldNavigate) {
      ttsNavigationPageRef.current = targetPage;
      resetSpokenOffset();
      setPage(targetPage);
      navigatePdfRef.current?.(targetPage);
    }

    const cachedText = pageTextCacheRef.current.get(targetPage);
    if (cachedText !== undefined) {
      speakPageRef.current?.(targetPage, cachedText, session);
    } else if (!shouldNavigate && navigatePdfRef.current) {
      ttsNavigationPageRef.current = targetPage;
      navigatePdfRef.current(targetPage);
    }
  };

  speakPageRef.current = speakPage;
  requestSpeechPageRef.current = requestSpeechPage;

  useLayoutEffect(() => {
    pageTextCacheRef.current.clear();
    navigatePdfRef.current = null;
    pendingSpeechPageRef.current = null;
    ttsNavigationPageRef.current = null;
  }, [book?.id]);

  useEffect(() => {
    if (book?.type !== 'pdf' && pageCount > 0 && pageWidth > 0) {
      listRef.current?.scrollToOffset({ offset: page * pageWidth, animated: true });
    }
  }, [book?.type, page, pageCount, pageWidth]);

  useEffect(() => () => {
    speechSessionRef.current += 1;
    isReadingAloudRef.current = false;
    speechInFlightRef.current = false;
    activeSpeechUtteranceRef.current = null;
    speechRecoveryAttemptsRef.current = 0;
    speechPageRef.current = null;
    speechTextRef.current = null;
    speechInterruptedRef.current = false;
    releaseSilentAudio();
    ReadAloudSpeech.stop();
    void setAudioModeAsync(INACTIVE_AUDIO_MODE);
  }, []);

  const theme = useMemo(() => settings.theme === 'sepia' ? { background: '#F2E5CD', foreground: '#453829', muted: '#8A7660', border: '#D9C6A6' } : settings.theme === 'light' ? { background: '#F8F8F5', foreground: '#242421', muted: '#76766C', border: '#E4E4DD' } : { background: '#090909', foreground: '#F2F0EA', muted: '#8B8A84', border: '#2B2B2A' }, [settings.theme]);

  if (!book) return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={{ color: colors.foreground }}>Document not found.</Text></View>;

  const goToPage = (next: number) => {
    if (pageCount === 0) return;
    const clamped = Math.max(0, Math.min(pageCount - 1, next));
    if (isReadingAloudRef.current) stopReading();
    resetSpokenOffset();
    setPage(clamped);
  };

  const renderHighlightedText = (text: string, offset: number) => {
    const clamped = Math.max(0, Math.min(text.length, Math.floor(offset)));
    if (clamped === 0) return text;
    return (
      <>
        <Text style={styles.spokenHighlight}>{text.slice(0, clamped)}</Text>
        {text.slice(clamped)}
      </>
    );
  };

  const toggleSpeech = async () => {
    if (isReadingAloudRef.current) {
      stopReading();
      return;
    }

    let session: number | null = null;
    try {
      await setAudioModeAsync(AUDIO_MODE);
      speechSessionRef.current += 1;
      session = speechSessionRef.current;
      ReadAloudSpeech.stop();
      isReadingAloudRef.current = true;
      speechInFlightRef.current = false;
      activeSpeechUtteranceRef.current = null;
      speechRecoveryAttemptsRef.current = 0;
      speechPageRef.current = null;
      speechTextRef.current = null;
      speechInterruptedRef.current = false;
      pendingSpeechPageRef.current = null;
      ttsNavigationPageRef.current = null;
      setIsReadingAloud(true);
      await startSilentAudio(session);
      if (session !== speechSessionRef.current || !isReadingAloudRef.current) return;
      requestSpeechPageRef.current?.(pageRef.current, session);
    } catch {
      if (session !== null && session !== speechSessionRef.current) return;
      releaseSilentAudio();
      isReadingAloudRef.current = false;
      setIsReadingAloud(false);
      void setAudioModeAsync(INACTIVE_AUDIO_MODE);
      Alert.alert('Read aloud unavailable', 'Audio playback could not be started on this device.');
    }
  };

  const addCurrentBookmark = async () => {
    await addBookmark(book.id, page, `Page ${page + 1}`);
  };

  const handlePdfNavigateReady = useCallback((navigate: (page: number) => void) => {
    navigatePdfRef.current = navigate;
    if (isReadingAloudRef.current && pendingSpeechPageRef.current !== null) {
      navigate(pendingSpeechPageRef.current);
    }
  }, []);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.reader, { backgroundColor: theme.background }]}>
      <StatusBar style="light" />
      {overlay && <View style={[styles.readerHeader, { backgroundColor: theme.background }]}>
          <Pressable testID="reader-back" onPress={() => router.back()} style={styles.headerAction}><Feather name="arrow-left" size={21} color={theme.foreground} /></Pressable>
          <Text numberOfLines={1} style={[styles.readerTitle, { color: theme.foreground }]}>{book.name}</Text>
          <Pressable testID="bookmark-button" onPress={addCurrentBookmark} style={styles.headerAction}><Feather name="bookmark" size={20} color={theme.foreground} /></Pressable>
      </View>}
      <View
        style={styles.documentStage}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width !== stageSize.width || height !== stageSize.height) setStageSize({ width, height });
        }}
      >
        {book.type === 'pdf' ? (
          <PdfReaderView
            uri={book.uri}
            initialPage={Math.max(0, book.position)}
            targetPage={page}
            spokenOffset={visibleSpokenOffset}
            theme={theme}
            margin={settings.margin}
            onNavigateReady={handlePdfNavigateReady}
            onLoaded={(count) => {
              setTotalPages(count);
              setPage((current) => Math.min(current, Math.max(count - 1, 0)));
              setLoadError(null);
            }}
            onPageChanging={(nextPage, count) => {
              setTotalPages(count);
              setActivePageText('');
              setActiveTextPage(null);
              if (nextPage !== pageRef.current) resetSpokenOffset();
                if (
                  isReadingAloudRef.current
                  && ttsNavigationPageRef.current !== nextPage
                  && pageRef.current !== nextPage
                ) {
                 stopReading();
              }
            }}
            onPageChanged={(nextPage, count) => {
              setTotalPages(count);
              setPage(nextPage);
              setActivePageText('');
              setActiveTextPage(null);
              setLoadError(null);
              if (nextPage !== pageRef.current) resetSpokenOffset();
               if (ttsNavigationPageRef.current === nextPage) ttsNavigationPageRef.current = null;
            }}
            onPageText={(textPage, text, prefetched = false) => {
              cachePdfPageText(textPage, text);
              if (!prefetched) {
                setActiveTextPage(textPage);
                setActivePageText(text);
              }
               if (isReadingAloudRef.current && pendingSpeechPageRef.current === textPage) {
                 speakPageRef.current?.(textPage, text, speechSessionRef.current);
               }
            }}
             onError={(message) => {
                console.error('[Bussy Reader] Local PDF parser error', { uri: book.uri, message });
               setLoadError(`Unable to open this local PDF. Try importing it again. ${message}`);
               if (isReadingAloudRef.current) stopReading();
             }}
            onLoadingChange={setLoading}
            onReady={() => setLoadError(null)}
          />
        ) : (
          <FlatList
            ref={listRef}
            data={pages}
            horizontal
            pagingEnabled
            disableIntervalMomentum
            decelerationRate="fast"
            snapToInterval={pageWidth}
            snapToAlignment="start"
            initialScrollIndex={Math.min(book.position, Math.max(pages.length - 1, 0))}
            keyExtractor={(_, index) => `${book.id}-${index}`}
            renderItem={({ item, index }) => (
              <Pressable
                onPress={() => setOverlay((visible) => !visible)}
                style={[styles.textPage, { width: pageWidth, minHeight: pageHeight, paddingHorizontal: settings.margin }]}
              >
                <Text style={[styles.pageLabel, { color: theme.muted }]}>{String(index + 1).padStart(2, '0')} / {String(pages.length).padStart(2, '0')}</Text>
                 <Text style={[styles.pageText, { color: theme.foreground, fontSize: settings.fontSize, lineHeight: settings.fontSize * settings.lineSpacing }]}>{renderHighlightedText(item, index === page ? visibleSpokenOffset : 0)}</Text>
              </Pressable>
            )}
            onMomentumScrollEnd={(event) => {
              const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(pageWidth, 1));
              if (next !== page) {
                goToPage(next);
              }
            }}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            scrollEnabled={!loading}
            removeClippedSubviews
            getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
          />
        )}
        {loading && <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={[styles.loadingText, { color: theme.muted }]}>Loading…</Text></View>}
        {loadError && <View pointerEvents="none" style={[styles.errorBanner, { backgroundColor: `${theme.background}F2` }]}><Feather name="alert-circle" size={18} color={colors.primary} /><Text style={[styles.errorText, { color: theme.foreground }]}>{loadError}</Text></View>}
      </View>
       {overlay && <View style={[styles.readerFooter, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
           <View style={styles.footerRow}><Text style={[styles.progressText, { color: theme.muted }]}>Page {pageCount > 0 ? page + 1 : '—'} of {pageCount || '—'}</Text><Pressable testID="bookmarks-button" onPress={() => setBookmarksVisible(true)}><Text style={[styles.bookmarkLink, { color: colors.primary }]}>Bookmarks</Text></Pressable></View>
           <View style={styles.scrubberSection}>
             <View style={styles.scrubberLabelRow}>
               <Text style={[styles.scrubberLabel, { color: theme.muted }]}>Read aloud position</Text>
               <Text testID="reading-offset" style={[styles.scrubberLabel, { color: theme.muted }]}>{currentTextLength > 0 ? `${Math.round((visibleSpokenOffset / currentTextLength) * 100)}%` : '—'}</Text>
             </View>
             <View
               testID="reading-scrubber"
               accessibilityRole="adjustable"
               accessibilityLabel="Read aloud position"
               accessibilityValue={{ min: 0, max: currentTextLength, now: visibleSpokenOffset }}
               onLayout={(event) => setScrubberWidth(event.nativeEvent.layout.width)}
               onTouchStart={(event) => scrubFromLocation(event.nativeEvent.locationX)}
               onTouchMove={(event) => scrubFromLocation(event.nativeEvent.locationX)}
               style={[styles.scrubber, { opacity: currentTextLength > 0 ? 1 : 0.35 }]}
               {...scrubberPanResponder.panHandlers}
             >
               <View style={[styles.scrubberTrack, { backgroundColor: theme.border }]}>
                 <View style={[styles.scrubberFill, { width: `${currentTextLength > 0 ? (visibleSpokenOffset / currentTextLength) * 100 : 0}%`, backgroundColor: colors.primary }]} />
               </View>
               <View style={[styles.scrubberThumb, { left: `${currentTextLength > 0 ? (visibleSpokenOffset / currentTextLength) * 100 : 0}%`, backgroundColor: colors.primary, borderColor: theme.background }]} />
             </View>
           </View>
          <View style={styles.controls}>
             <Pressable disabled={page <= 0 || pageCount === 0} onPress={() => goToPage(page - 1)} style={[styles.control, { opacity: page <= 0 || pageCount === 0 ? 0.35 : 1 }]}><Feather name="chevron-left" size={23} color={theme.foreground} /></Pressable>
              <View style={styles.speechActions}>
                <Pressable disabled={pageCount === 0} testID="read-aloud-button" onPress={() => void toggleSpeech()} style={[styles.speakButton, { backgroundColor: colors.primary, opacity: pageCount === 0 ? 0.5 : 1 }]}><Feather name={isReadingAloud ? 'pause' : 'volume-2'} size={18} color={colors.primaryForeground} /><Text style={{ color: colors.primaryForeground, fontWeight: '700', fontSize: 13 }}>{isReadingAloud ? 'Pause' : 'Read aloud'}</Text></Pressable>
                <Pressable testID="tts-settings-button" accessibilityLabel="Read aloud settings" onPress={() => setTtsVisible(true)} style={[styles.speedButton, { borderColor: theme.border }]}><Feather name="sliders" size={16} color={theme.foreground} /></Pressable>
              </View>
             <Pressable disabled={page >= pageCount - 1 || pageCount === 0} onPress={() => goToPage(page + 1)} style={[styles.control, { opacity: page >= pageCount - 1 || pageCount === 0 ? 0.35 : 1 }]}><Feather name="chevron-right" size={23} color={theme.foreground} /></Pressable>
          </View>
      </View>}
      <Modal transparent visible={bookmarksVisible} animationType="slide" onRequestClose={() => setBookmarksVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setBookmarksVisible(false)}>
          <Pressable style={[styles.bookmarkSheet, { backgroundColor: theme.background }]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.sheetHeader}><Text style={[styles.sheetTitle, { color: theme.foreground }]}>Bookmarks</Text><Pressable onPress={() => setBookmarksVisible(false)}><Feather name="x" size={20} color={theme.muted} /></Pressable></View>
            {book.bookmarks.length === 0 ? <Text style={[styles.noBookmarks, { color: theme.muted }]}>Bookmarks you add while reading will appear here.</Text> : book.bookmarks.map((bookmark) => <Pressable key={bookmark.id} onPress={() => { setBookmarksVisible(false); goToPage(bookmark.position); }} style={[styles.bookmarkItem, { borderBottomColor: theme.border }]}><Feather name="bookmark" size={16} color={colors.primary} /><Text style={[styles.bookmarkLabel, { color: theme.foreground }]}>{bookmark.label}</Text><Feather name="chevron-right" size={16} color={theme.muted} /></Pressable>)}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal transparent visible={ttsVisible} animationType="slide" onRequestClose={() => setTtsVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTtsVisible(false)}>
          <Pressable style={[styles.ttsSheet, { backgroundColor: theme.background }]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={[styles.sheetTitle, { color: theme.foreground }]}>Read aloud</Text>
                <Text style={[styles.ttsSubtitle, { color: theme.muted }]}>Choose a comfortable playback speed.</Text>
              </View>
              <Pressable accessibilityLabel="Close read aloud settings" onPress={() => setTtsVisible(false)}><Feather name="x" size={20} color={theme.muted} /></Pressable>
            </View>
            <Text style={[styles.speedLabel, { color: theme.muted }]}>Playback speed</Text>
            <View style={styles.speedOptions}>
              {SPEECH_RATES.map((rate) => {
                const selected = speechRate === rate;
                return (
                  <Pressable
                    key={rate}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setSpeechRate(rate)}
                    style={[styles.speedOption, { borderColor: selected ? colors.primary : theme.border, backgroundColor: selected ? `${colors.primary}18` : 'transparent' }]}
                  >
                    <Text style={{ color: selected ? colors.primary : theme.foreground, fontWeight: '700' }}>{rate.toFixed(rate === 1.05 ? 2 : 1)}x</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable disabled={pageCount === 0} testID="tts-modal-toggle" onPress={() => void toggleSpeech()} style={[styles.modalSpeechButton, { backgroundColor: colors.primary, opacity: pageCount === 0 ? 0.5 : 1 }]}>
              <Feather name={isReadingAloud ? 'pause' : 'volume-2'} size={18} color={colors.primaryForeground} />
              <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>{isReadingAloud ? 'Pause reading' : 'Read current page'}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  reader: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  documentStage: { flex: 1, minHeight: 0, overflow: 'hidden' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 13 },
  errorBanner: { position: 'absolute', top: '43%', left: 28, right: 28, padding: 18, borderRadius: 16, flexDirection: 'row', gap: 10, alignItems: 'flex-start', zIndex: 2 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 19 },
  readerHeader: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  readerTitle: { flex: 1, textAlign: 'center', fontWeight: '600', fontSize: 14, marginHorizontal: 12 },
  headerAction: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  textPage: { flex: 1, justifyContent: 'center', paddingVertical: 28 },
  pageLabel: { fontSize: 11, letterSpacing: 1.2, fontWeight: '700', marginBottom: 22 },
  pageText: { fontWeight: '400' },
  spokenHighlight: { backgroundColor: 'rgba(128, 128, 128, 0.38)' },
  readerFooter: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 18, borderTopWidth: StyleSheet.hairlineWidth },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  progressText: { fontSize: 11, fontWeight: '600' },
  bookmarkLink: { fontSize: 12, fontWeight: '700' },
  scrubberSection: { marginBottom: 12 },
  scrubberLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  scrubberLabel: { fontSize: 10, fontWeight: '600' },
  scrubber: { height: 28, justifyContent: 'center', position: 'relative' },
  scrubberTrack: { height: 4, borderRadius: 3, overflow: 'hidden' },
  scrubberFill: { height: '100%', borderRadius: 3 },
  scrubberThumb: { position: 'absolute', top: 7, width: 14, height: 14, marginLeft: -7, borderRadius: 7, borderWidth: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  control: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  speechActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  speakButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 13 },
  speedButton: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.58)', justifyContent: 'flex-end' },
  bookmarkSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 34 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  noBookmarks: { paddingVertical: 24, lineHeight: 21, fontSize: 14 },
  bookmarkItem: { minHeight: 54, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  bookmarkLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
  ttsSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 28 },
  ttsSubtitle: { marginTop: 4, fontSize: 13 },
  speedLabel: { marginTop: 20, marginBottom: 10, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  speedOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  speedOption: { minWidth: 58, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderRadius: 12, alignItems: 'center' },
  modalSpeechButton: { marginTop: 24, minHeight: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
