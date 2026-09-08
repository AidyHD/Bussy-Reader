/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#F1EEE8',
    tint: '#FF7D68',

    // Core surfaces
    background: '#0C0D0C',
    foreground: '#F1EEE8',

    // Cards / elevated surfaces
    card: '#171917',
    cardForeground: '#F1EEE8',

    // Primary action color (buttons, links, active states)
    primary: '#FF7D68',
    primaryForeground: '#1B0D0A',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#232522',
    secondaryForeground: '#F1EEE8',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#20221F',
    mutedForeground: '#979891',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#2B2521',
    accentForeground: '#F1EEE8',

    // Destructive actions (delete, error states)
    destructive: '#FF6B62',
    destructiveForeground: '#1B0D0A',

    // Borders and input outlines
    border: '#2A2D29',
    input: '#2A2D29',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
