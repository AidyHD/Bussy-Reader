import colors, { type AppTheme, themeColors } from '@/constants/colors';

/**
 * Returns the design tokens for the selected app theme.
 *
 * Screens that do not have access to reader settings use pitch as the stable
 * fallback, while the library, Settings, and reader screens pass the saved
 * theme explicitly.
 */
export function useColors(theme: AppTheme = 'pitch') {
  const palette = themeColors[theme];
  return { ...palette, radius: colors.radius };
}