import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PdfThumbnailGenerator } from '@/components/PdfThumbnailGenerator';

export type ThemeName = 'pitch' | 'sepia' | 'light';
export type LayoutMode = 'grid' | 'list';
export type SortMode = 'lastRead' | 'name' | 'dateAdded';

export type Bookmark = {
  id: string;
  label: string;
  position: number;
  createdAt: number;
};

export type Book = {
  id: string;
  name: string;
  uri: string;
  coverUri?: string;
  type: 'pdf' | 'epub' | 'txt';
  size?: number;
  addedAt: number;
  lastReadAt?: number;
  position: number;
  spokenOffset: number;
  progress: number;
  bookmarks: Bookmark[];
};

export type ReaderSettings = {
  theme: ThemeName;
  fontSize: number;
  lineSpacing: number;
  margin: number;
  keepAwake: boolean;
};

type LibraryContextValue = {
  books: Book[];
  settings: ReaderSettings;
  layout: LayoutMode;
  sort: SortMode;
  hydrated: boolean;
  importBook: () => Promise<void>;
  removeBook: (bookId: string) => Promise<void>;
  updateProgress: (bookId: string, position: number, total: number, spokenOffset?: number) => Promise<void>;
  addBookmark: (bookId: string, position: number, label: string) => Promise<void>;
  setSettings: (patch: Partial<ReaderSettings>) => void;
  setLayout: (layout: LayoutMode) => void;
  setSort: (sort: SortMode) => void;
};

type ThumbnailJob = {
  sourceUri: string;
  outputUri: string;
};

const BOOKS_KEY = 'bussy-reader-books-v1';
const SETTINGS_KEY = 'bussy-reader-settings-v1';

const defaultSettings: ReaderSettings = {
  theme: 'pitch',
  fontSize: 18,
  lineSpacing: 1.65,
  margin: 24,
  keepAwake: true,
};

const LibraryContext = createContext<LibraryContextValue | null>(null);

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function LibraryProvider({ children }: PropsWithChildren) {
  const [books, setBooks] = useState<Book[]>([]);
  const [settings, setSettingsState] = useState<ReaderSettings>(defaultSettings);
  const [layout, setLayout] = useState<LayoutMode>('grid');
  const [sort, setSort] = useState<SortMode>('lastRead');
  const [hydrated, setHydrated] = useState(false);
  const [thumbnailJob, setThumbnailJob] = useState<ThumbnailJob | null>(null);
  const thumbnailResolverRef = useRef<{
    resolve: (coverUri: string | null) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const [storedBooks, storedSettings] = await Promise.all([
          AsyncStorage.getItem(BOOKS_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        if (storedBooks) {
          const parsedBooks = JSON.parse(storedBooks) as Book[];
          setBooks(parsedBooks.map((book) => ({
            ...book,
            spokenOffset: Number.isFinite(book.spokenOffset) && book.spokenOffset >= 0 ? book.spokenOffset : 0,
          })));
        }
        if (storedSettings) setSettingsState({ ...defaultSettings, ...(JSON.parse(storedSettings) as Partial<ReaderSettings>) });
      } finally {
        setHydrated(true);
      }
    };
    void hydrate();
  }, []);

  const persistBooks = async (next: Book[]) => {
    setBooks(next);
    await AsyncStorage.setItem(BOOKS_KEY, JSON.stringify(next));
  };

  const generatePdfThumbnail = (sourceUri: string, outputUri: string) => new Promise<string | null>((resolve) => {
    if (thumbnailResolverRef.current) {
      clearTimeout(thumbnailResolverRef.current.timeout);
      thumbnailResolverRef.current.resolve(null);
    }
    const timeout = setTimeout(() => {
      thumbnailResolverRef.current = null;
      setThumbnailJob(null);
      resolve(null);
    }, 15000);
    thumbnailResolverRef.current = { resolve, timeout };
    setThumbnailJob({ sourceUri, outputUri });
  });

  const completePdfThumbnail = async (base64Png: string | null) => {
    const resolver = thumbnailResolverRef.current;
    if (!resolver || !thumbnailJob) return;
    clearTimeout(resolver.timeout);
    thumbnailResolverRef.current = null;
    setThumbnailJob(null);
    if (!base64Png) {
      resolver.resolve(null);
      return;
    }
    try {
      await FileSystem.writeAsStringAsync(thumbnailJob.outputUri, base64Png, { encoding: FileSystem.EncodingType.Base64 });
      resolver.resolve(thumbnailJob.outputUri);
    } catch {
      resolver.resolve(null);
    }
  };

  const importBook = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/epub+zip', 'text/plain'],
      copyToCacheDirectory: false,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const lowerName = asset.name.toLowerCase();
    const type: Book['type'] = lowerName.endsWith('.pdf') ? 'pdf' : lowerName.endsWith('.epub') ? 'epub' : 'txt';
    const directory = `${FileSystem.documentDirectory ?? ''}library/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const destination = `${directory}${makeId()}-${asset.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await FileSystem.copyAsync({ from: asset.uri, to: destination });

    const bookId = makeId();
    let coverUri: string | undefined;
    if (type === 'pdf' && FileSystem.documentDirectory) {
      try {
        const coversDirectory = `${FileSystem.documentDirectory}covers/`;
        await FileSystem.makeDirectoryAsync(coversDirectory, { intermediates: true });
        coverUri = (await generatePdfThumbnail(destination, `${coversDirectory}${bookId}.png`)) ?? undefined;
      } catch (error) {
        console.warn('[Bussy Reader] PDF cover generation failed; importing without a cover.', {
          uri: destination,
          error,
        });
      }
    }

    const book: Book = {
      id: bookId,
      name: asset.name.replace(/\.(pdf|epub|txt)$/i, ''),
      uri: destination,
      coverUri,
      type,
      size: asset.size,
      addedAt: Date.now(),
      position: 0,
      spokenOffset: 0,
      progress: 0,
      bookmarks: [],
    };
    await persistBooks([book, ...books]);
  };

  const removeBook = async (bookId: string) => {
    const book = books.find((item) => item.id === bookId);
    if (book) {
      try { await FileSystem.deleteAsync(book.uri, { idempotent: true }); } catch { /* local cleanup is best effort */ }
      if (book.coverUri) {
        try { await FileSystem.deleteAsync(book.coverUri, { idempotent: true }); } catch { /* local cleanup is best effort */ }
      }
    }
    await persistBooks(books.filter((item) => item.id !== bookId));
  };

  const updateProgress = async (bookId: string, position: number, total: number, spokenOffset?: number) => {
    const next = books.map((book) => book.id === bookId
      ? {
        ...book,
        position,
        spokenOffset: spokenOffset === undefined
          ? (Number.isFinite(book.spokenOffset) && book.spokenOffset >= 0 ? book.spokenOffset : 0)
          : Math.max(0, Math.floor(spokenOffset)),
        progress: total > 0 ? Math.min(1, position / total) : 0,
        lastReadAt: Date.now(),
      }
      : book);
    await persistBooks(next);
  };

  const addBookmark = async (bookId: string, position: number, label: string) => {
    const next = books.map((book) => book.id === bookId
      ? { ...book, bookmarks: [...book.bookmarks, { id: makeId(), label, position, createdAt: Date.now() }] }
      : book);
    await persistBooks(next);
  };

  const setSettings = (patch: Partial<ReaderSettings>) => {
    const next = { ...settings, ...patch };
    setSettingsState(next);
    void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  };

  const value = useMemo(() => ({
    books, settings, layout, sort, hydrated, importBook, removeBook, updateProgress, addBookmark, setSettings, setLayout, setSort,
  }), [books, settings, layout, sort, hydrated]);

  return (
    <LibraryContext.Provider value={value}>
      {children}
      {thumbnailJob && <PdfThumbnailGenerator sourceUri={thumbnailJob.sourceUri} onComplete={(base64Png) => { void completePdfThumbnail(base64Png); }} />}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useLibrary must be used inside LibraryProvider');
  return context;
}