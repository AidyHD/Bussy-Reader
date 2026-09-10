const pitch = {
  text: '#F1EEE8',
  tint: '#FF7D68',
  background: '#0C0D0C',
  foreground: '#F1EEE8',
  card: '#171917',
  cardForeground: '#F1EEE8',
  primary: '#FF7D68',
  primaryForeground: '#1B0D0A',
  secondary: '#232522',
  secondaryForeground: '#F1EEE8',
  muted: '#20221F',
  mutedForeground: '#979891',
  accent: '#2B2521',
  accentForeground: '#F1EEE8',
  destructive: '#FF6B62',
  destructiveForeground: '#1B0D0A',
  border: '#2A2D29',
  input: '#2A2D29',
};

const sepia = {
  text: '#453829',
  tint: '#A86642',
  background: '#F2E5CD',
  foreground: '#453829',
  card: '#E8D6B7',
  cardForeground: '#453829',
  primary: '#A86642',
  primaryForeground: '#FFF8ED',
  secondary: '#DDC6A4',
  secondaryForeground: '#453829',
  muted: '#E5D1AE',
  mutedForeground: '#806D57',
  accent: '#E5CBAA',
  accentForeground: '#453829',
  destructive: '#B54F43',
  destructiveForeground: '#FFF8ED',
  border: '#D1B991',
  input: '#D1B991',
};

const light = {
  text: '#242421',
  tint: '#C85E4B',
  background: '#F8F8F5',
  foreground: '#242421',
  card: '#FFFFFF',
  cardForeground: '#242421',
  primary: '#C85E4B',
  primaryForeground: '#FFFFFF',
  secondary: '#ECECE6',
  secondaryForeground: '#242421',
  muted: '#F0F0EB',
  mutedForeground: '#76766C',
  accent: '#F3E5DF',
  accentForeground: '#5D2B23',
  destructive: '#C7473E',
  destructiveForeground: '#FFFFFF',
  border: '#E0E0D8',
  input: '#E0E0D8',
};

export const themeColors = { pitch, sepia, light };
export type AppTheme = keyof typeof themeColors;

const colors = {
  ...themeColors,
  // The default palette is kept under `light` for existing callers that only
  // need a fallback palette.
  radius: 8,
};

export default colors;
