// Design tokens for this app. Light theme only.Always modify the colors and theme to Dark, Light or Dark and Light according to the design guidelines.
//
// The keys match the "color" block of /app/design_guidelines.json. Fill the
// values from that file (or from the user's brand colors). Keep every key; do
// not add a second theme or colors file; do not write color literals in
// components.
//
// How the names work: a plain key is a background, and its `on` partner is the
// text or icon color that sits on top of it. Always use them as a pair.
//   <View style={{ backgroundColor: colors.brandPrimary }}>
//     <Text style={{ color: colors.onBrandPrimary }}>Continue</Text>
//   </View>
//
// Styling a screen or component: build the sheet with makeStyles so colors
// and layout live together and follow the active scheme:
//   const useStyles = makeStyles((colors) => ({
//     card: { backgroundColor: colors.surfaceSecondary, padding: 16 },
//     title: { color: colors.onSurfaceSecondary, fontSize: 16 },
//   }));
//   function Screen() {
//     const styles = useStyles();
//     return <View style={styles.card}><Text style={styles.title}>Hi</Text></View>;
//   }
// For color props that are not styles (icon color, placeholderTextColor,
// ActivityIndicator) read useTheme().colors inside the component.
// Never call StyleSheet.create with color values at module level; it cannot
// follow the scheme.
//
// To support dark mode later: add `dark` to `themes` with every key filled.
// Nothing else changes; the device setting takes over automatically.
// Feel free to add as many new colors as you need to support the design guidelines.

import { useMemo, useSyncExternalStore } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // ---------------------------------------------------------------------------
  // Surfaces: backgrounds, from the screen down to small fills.
  // Each `on` key is the text and icon color for that background.
  // ---------------------------------------------------------------------------
  surface: "#F6F7F3",
  onSurface: "#242921",
  surfaceSecondary: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  onSurfaceSecondary: "#343D32",
  surfaceTertiary: "#EDF0E9",
  onSurfaceTertiary: "#56614F",
  surfaceInverse: "#1F2937", // tooltips, snackbars, anything popping against the theme
  onSurfaceInverse: "#FFFFFF", // text and icons on the inverse surface
  muted: "#747B70",
  placeholder: "#747B70",

  // ---------------------------------------------------------------------------
  // Brand: the identity color and the fills built from it.
  // Neutral by default; replace with the design guidelines values.
  // ---------------------------------------------------------------------------
  brand: "#4C1D95",
  onBrand: "#FFFFFF", // text and icons placed directly on brand
  brandPrimary: "#4C1D95",
  brandPressed: "#3B176E",
  onBrandPrimary: "#FFFFFF", // text and icons on brandPrimary
  brandSecondary: "#ECE6F5",
  onBrandSecondary: "#4C1D95",
  brandTertiary: "#F3EEF8",
  onBrandTertiary: "#4C1D95",

  // ---------------------------------------------------------------------------
  // Status: semantic only, never decorative. Fill for badges, banners and
  // toasts; the `on` key is text on that fill. The plain key is also safe as
  // text on `surface`.
  // ---------------------------------------------------------------------------
  success: "#15803D",
  onSuccess: "#FFFFFF",
  warning: "#B45309",
  onWarning: "#FFFFFF",
  error: "#B91C1C",
  onError: "#FFFFFF",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",

  // ---------------------------------------------------------------------------
  // Lines
  // ---------------------------------------------------------------------------
  border: "#E2E6DD",
  borderStrong: "#D1D5DB", // focus rings, selected outlines, 1.5pt max
  divider: "#E5E7EB", // subtle list separators
  overlay: "rgba(15,22,14,0.45)",
  transparent: "transparent",
  paper: "#FFFFFF",
  paperInk: "#20221F",
  paperLine: "#DCE2E9",
  highlight: "#E8C952",
  inkBlue: "#4366A3",
  inkRed: "#B45151",
  inkGreen: "#566D52", // Existing content swatch, independent of interface accents.
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark: {
  ...light, surface: '#000000', onSurface: '#F5F3F7', surfaceSecondary: '#101014', onSurfaceSecondary: '#F5F3F7',
  surfaceRaised: '#19171F', surfaceTertiary: '#19171F', onSurfaceTertiary: '#B5B0BE', surfaceInverse: '#19171F', onSurfaceInverse: '#F5F3F7',
  muted: '#B5B0BE', placeholder: '#97909F', brand: '#4C1D95', onBrand: '#FFFFFF', brandPrimary: '#B8A3D9', onBrandPrimary: '#FFFFFF',
  // Solid fills use brand; brandPrimary keeps small text/icons/indicators legible.
  brandSecondary: '#201329', onBrandSecondary: '#F5F3F7', brandTertiary: '#201329', onBrandTertiary: '#B8A3D9',
  border: '#2A2632', borderStrong: '#2A2632', divider: '#2A2632', overlay: 'rgba(0,0,0,0.45)',
  inkGreen: '#B4CAA5', success: '#9BCD9C', error: '#F2A29B', warning: '#ECC07B', info: '#A5BDF0'
} };

// In-app theme toggle, only after `dark` exists in `themes`. Call
// setColorScheme("dark"), setColorScheme("light"), or setColorScheme(null) to
// follow the device. Every useTheme() consumer re-renders. Persisting the
// choice and re-applying it on launch is the toggle's job.
let overrideScheme: ColorScheme | null = null;
const schemeListeners = new Set<() => void>();
export function setColorScheme(scheme: ColorScheme | null) {
  overrideScheme = scheme;
  schemeListeners.forEach(listener => listener());
  // RN 0.86 re-reads the device scheme only for the literal "unspecified";
  // null would pin useColorScheme() to null and the app to light.
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

// Keep native surfaces (alerts, pickers, navigation chrome) on the schemes this
// app ships: light only forces light; once `dark` exists the device decides.
// Optional call because react-native-web does not implement it.
setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const override = useSyncExternalStore(callback => { schemeListeners.add(callback); return () => { schemeListeners.delete(callback); }; }, () => overrideScheme, () => null);
  const scheme: ColorScheme = override || (system === 'dark' && themes.dark ? 'dark' : 'light');
  return { scheme, colors: themes[scheme] ?? themes.light };
}

// Themed StyleSheet: returns a hook that builds the sheet from the active
// scheme's colors and memoizes it until the scheme changes.
export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}


