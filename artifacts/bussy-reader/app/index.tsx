import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useLibrary, Book, SortMode, ThemeName } from '@/context/LibraryContext';
import { useColors } from '@/hooks/useColors';

const sortLabels: Record<SortMode, string> = { lastRead: 'Last read', name: 'Name', dateAdded: 'Date added' };

function BookCover({ book, compact, onPress, theme }: { book: Book; compact?: boolean; onPress: () => void; theme: ThemeName }) {
  const colors = useColors(theme);
  const accent = book.type === 'pdf' ? '#FF7D68' : book.type === 'epub' ? '#C4A7FF' : '#86D6B2';
  const [coverFailed, setCoverFailed] = useState(false);
  const hasCover = Boolean(book.coverUri && !coverFailed);
  return (
    <Pressable
      testID={`book-${book.id}`}
      onPress={onPress}
      style={({ pressed }) => [compact ? styles.bookRow : styles.bookCard, pressed && styles.pressed]}
    >
      <View style={[styles.cover, compact && styles.coverCompact, { backgroundColor: colors.card, borderColor: accent }]}>
        {hasCover && <><Image source={{ uri: book.coverUri }} style={styles.coverImage} resizeMode="cover" onError={() => setCoverFailed(true)} /><View style={styles.coverScrim} /></>}
        <View style={[styles.coverStripe, { backgroundColor: accent }]} />
        {!hasCover && <Feather name={book.type === 'pdf' ? 'file-text' : book.type === 'epub' ? 'book-open' : 'align-left'} size={compact ? 18 : 26} color={accent} />}
        <Text numberOfLines={2} style={[styles.coverTitle, compact && styles.coverTitleCompact, { color: hasCover ? '#FFFFFF' : colors.foreground }]}>{book.name}</Text>
        <Text style={[styles.coverType, { color: hasCover ? '#FFFFFF' : colors.mutedForeground }]}>{book.type.toUpperCase()}</Text>
      </View>
      <View style={compact ? styles.rowDetails : styles.cardDetails}>
        <Text numberOfLines={2} style={[styles.bookName, { color: colors.foreground }]}>{book.name}</Text>
        <Text style={[styles.bookMeta, { color: colors.mutedForeground }]}>{book.progress > 0 ? `${Math.round(book.progress * 100)}% complete` : 'Not started'}</Text>
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { width: `${Math.max(book.progress * 100, book.progress > 0 ? 3 : 0)}%`, backgroundColor: accent }]} />
        </View>
      </View>
    </Pressable>
  );
}

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { books, settings, layout, sort, hydrated, importBook, setLayout, setSort } = useLibrary();
  const colors = useColors(settings.theme);
  const [sortVisible, setSortVisible] = useState(false);
  const sortedBooks = useMemo(() => [...books].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'dateAdded' ? b.addedAt - a.addedAt : (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0)), [books, sort]);

  const handleImport = async () => {
    await Haptics.selectionAsync();
    try { await importBook(); } catch { Alert.alert('Could not import file', 'Choose a local PDF, EPUB, or TXT file and try again.'); }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom + 82 }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>YOUR PRIVATE SHELF</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Cheeky Reader</Text>
        </View>
        <Pressable testID="settings-button" onPress={() => router.push('/settings')} style={[styles.iconButton, { backgroundColor: colors.card }]}>
          <Feather name="sliders" size={20} color={colors.foreground} />
        </Pressable>
      </View>

      <View style={styles.toolbar}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{books.length} {books.length === 1 ? 'book' : 'books'}</Text>
        <View style={styles.toolbarActions}>
          <Pressable testID="sort-button" onPress={() => setSortVisible(true)} style={styles.toolbarButton}>
            <Feather name="filter" size={15} color={colors.mutedForeground} />
            <Text style={[styles.toolbarLabel, { color: colors.mutedForeground }]}>{sortLabels[sort]}</Text>
          </Pressable>
          <Pressable testID="layout-button" onPress={() => setLayout(layout === 'grid' ? 'list' : 'grid')} style={[styles.iconButtonSmall, { backgroundColor: colors.card }]}>
            <Feather name={layout === 'grid' ? 'list' : 'grid'} size={17} color={colors.foreground} />
          </Pressable>
        </View>
      </View>

      {!hydrated ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : books.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.card }]}>
            <Feather name="book-open" size={30} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Add your first book </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Import your first document and get reading.</Text>
          <Pressable testID="import-empty-button" onPress={handleImport} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
            <Feather name="plus" size={18} color={colors.primaryForeground} />
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Import a document</Text>
          </Pressable>
          <Text style={[styles.supportedText, { color: colors.mutedForeground }]}>PDF  ·  EPUB  ·  TXT</Text>
        </View>
      ) : (
        <FlatList
          data={sortedBooks}
          key={layout}
          numColumns={layout === 'grid' ? 2 : 1}
          keyExtractor={(book) => book.id}
          contentContainerStyle={layout === 'grid' ? styles.gridContent : styles.listContent}
          columnWrapperStyle={layout === 'grid' ? styles.gridRow : undefined}
          showsVerticalScrollIndicator={false}
           renderItem={({ item }) => <BookCover book={item} compact={layout === 'list'} theme={settings.theme} onPress={() => router.push(`/reader/${item.id}`)} />}
          ListFooterComponent={<Pressable testID="import-button" onPress={handleImport} style={[styles.importRow, { borderColor: colors.border }]}><Feather name="plus" size={18} color={colors.primary} /><Text style={[styles.importText, { color: colors.primary }]}>Import another document</Text></Pressable>}
        />
      )}

      <Modal transparent visible={sortVisible} animationType="fade" onRequestClose={() => setSortVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSortVisible(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Sort library</Text>
            {(Object.keys(sortLabels) as SortMode[]).map((option) => (
              <Pressable key={option} onPress={() => { setSort(option); setSortVisible(false); }} style={styles.optionRow}>
                <Text style={[styles.optionText, { color: colors.foreground }]}>{sortLabels[option]}</Text>
                {sort === option && <Feather name="check" size={18} color={colors.primary} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 22 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginBottom: 6 },
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -1 },
  iconButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconButtonSmall: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toolbarButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolbarLabel: { fontSize: 12 },
  loader: { marginTop: 100 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 38, paddingBottom: 80 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  emptyText: { textAlign: 'center', fontSize: 14, lineHeight: 21, marginBottom: 24 },
  primaryButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 14 },
  primaryButtonText: { fontSize: 14, fontWeight: '700' },
  supportedText: { fontSize: 10, letterSpacing: 1.2, marginTop: 16 },
  gridContent: { paddingHorizontal: 18, paddingBottom: 40 },
  listContent: { paddingHorizontal: 22, paddingBottom: 40 },
  gridRow: { justifyContent: 'space-between', marginBottom: 18 },
  bookCard: { width: '47%', marginBottom: 4 },
  bookRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  cover: { height: 190, borderRadius: 16, borderWidth: 1, padding: 16, justifyContent: 'flex-end', overflow: 'hidden' },
  coverCompact: { width: 62, height: 80, borderRadius: 12, padding: 9, alignItems: 'center', justifyContent: 'center' },
  coverImage: { ...StyleSheet.absoluteFillObject },
  coverScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.34)' },
  coverStripe: { position: 'absolute', left: 0, top: 0, width: 6, height: '100%' },
  coverTitle: { fontSize: 16, fontWeight: '700', lineHeight: 20, marginTop: 14 },
  coverTitleCompact: { display: 'none' },
  coverType: { fontSize: 9, letterSpacing: 1.2, fontWeight: '700', marginTop: 8 },
  cardDetails: { paddingHorizontal: 3, paddingTop: 9 },
  rowDetails: { flex: 1, paddingLeft: 14 },
  bookName: { fontSize: 14, fontWeight: '600' },
  bookMeta: { fontSize: 11, marginTop: 4 },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 9 },
  progressFill: { height: '100%', borderRadius: 2 },
  importRow: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, marginTop: 6 },
  importText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.72 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.58)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 36 },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  optionRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128,128,128,0.18)' },
  optionText: { fontSize: 15, fontWeight: '500' },
});