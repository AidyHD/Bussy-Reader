import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useLibrary, ThemeName } from '@/context/LibraryContext';
import { BUY_ME_A_COFFEE_URL } from '@/constants/Support';
import { useColors } from '@/hooks/useColors';

const themeLabels: Record<ThemeName, string> = { pitch: 'Pitch black', sepia: 'Sepia', light: 'Light' };

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { settings, setSettings } = useLibrary();
  const colors = useColors(settings.theme);

  const handleSupportPress = async () => {
    try {
      await WebBrowser.openBrowserAsync(BUY_ME_A_COFFEE_URL);
    } catch {
      try {
        await Linking.openURL(BUY_ME_A_COFFEE_URL);
      } catch {
        // Keep a browser failure from taking down the reader.
      }
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: colors.card }]}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>READING PREFERENCES</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.preferenceLabel, { color: colors.mutedForeground }]}>Reader theme</Text>
          <View style={styles.themeRow}>
            {(Object.keys(themeLabels) as ThemeName[]).map((theme) => (
              <Pressable
                key={theme}
                accessibilityRole="button"
                accessibilityState={{ selected: settings.theme === theme }}
                onPress={() => setSettings({ theme })}
                style={[
                  styles.themeChip,
                  {
                    borderColor: settings.theme === theme ? colors.primary : colors.border,
                    backgroundColor: settings.theme === theme ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Text style={{ color: settings.theme === theme ? colors.primaryForeground : colors.foreground, fontSize: 13 }}>
                  {themeLabels[theme]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.preferenceLabel, { color: colors.mutedForeground }]}>Text size</Text>
          <View style={styles.themeRow}>
            <Pressable
              accessibilityLabel="Decrease text size"
              onPress={() => setSettings({ fontSize: Math.max(14, settings.fontSize - 1) })}
              style={[styles.roundButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.roundButtonText, { color: colors.foreground }]}>A−</Text>
            </Pressable>
            <Text style={[styles.sizeValue, { color: colors.foreground }]}>{settings.fontSize} pt</Text>
            <Pressable
              accessibilityLabel="Increase text size"
              onPress={() => setSettings({ fontSize: Math.min(28, settings.fontSize + 1) })}
              style={[styles.roundButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.roundButtonText, { color: colors.foreground }]}>A+</Text>
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.keepAwake }}
            onPress={() => setSettings({ keepAwake: !settings.keepAwake })}
            style={styles.optionRow}
          >
            <View>
              <Text style={[styles.optionText, { color: colors.foreground }]}>Keep screen awake</Text>
              <Text style={[styles.optionHint, { color: colors.mutedForeground }]}>While reading visually</Text>
            </View>
            <Feather name={settings.keepAwake ? 'toggle-right' : 'toggle-left'} size={26} color={settings.keepAwake ? colors.primary : colors.mutedForeground} />
          </Pressable>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SUPPORT DEVELOPMENT</Text>
        <Pressable
          accessibilityLabel="Support Cheeky Reader"
          accessibilityRole="button"
          onPress={() => { void handleSupportPress(); }}
          style={({ pressed }) => [
            styles.supportCard,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.supportIcon, { backgroundColor: colors.accent }]}>
            <Feather name="heart" size={22} color={colors.primary} />
          </View>
          <View style={styles.supportCopy}>
            <Text style={[styles.supportTitle, { color: colors.foreground }]}>Support Cheeky Reader</Text>
            <Text style={[styles.supportSubtitle, { color: colors.mutedForeground }]}>Help keep updates coming with a small tip</Text>
          </View>
          <Feather name="external-link" size={18} color={colors.mutedForeground} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 22 },
  backButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 42 },
  title: { fontSize: 22, fontWeight: '700' },
  content: { paddingHorizontal: 22 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginTop: 6, marginBottom: 10 },
  card: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8 },
  preferenceLabel: { fontSize: 12, fontWeight: '600', marginTop: 13, marginBottom: 10 },
  themeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  themeChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  roundButton: { width: 42, height: 38, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  roundButtonText: { fontSize: 15, fontWeight: '600' },
  sizeValue: { flex: 1, textAlign: 'center', fontSize: 14 },
  optionRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(128,128,128,0.18)', marginTop: 16 },
  optionText: { fontSize: 15, fontWeight: '500' },
  optionHint: { fontSize: 12, marginTop: 3 },
  supportCard: { minHeight: 88, borderRadius: 18, borderWidth: 1, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13 },
  supportIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  supportCopy: { flex: 1 },
  supportTitle: { fontSize: 15, fontWeight: '700' },
  supportSubtitle: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  pressed: { opacity: 0.72 },
});