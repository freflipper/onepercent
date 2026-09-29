import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { StoreProvider, useStore } from '@/src/store';
import { useTheme } from '@/src/theme';
import Login from '@/src/screens/Login';
import { Label } from '@/src/components/ui';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from '@/src/cloud/auth';

export default function RootLayout() {
  // Prewarm the icon font before any screen uses glyphs (including Expo Go).
  useFonts(Ionicons.font);
  // One app level ErrorBoundary; a render crash shows a reload screen
  // instead of a blank app.
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider><KeyboardProvider><AuthProvider><StoreProvider><Gate /></StoreProvider></AuthProvider></KeyboardProvider></SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function Gate() {
  const { user, authLoading } = useStore();
  const { scheme, colors } = useTheme();
  const reduceMotion = useReducedMotion();
  return <View style={[styles.root, { backgroundColor: colors.surface }]}><StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />{authLoading ? <View testID="session-restoring" style={styles.restoring}><ActivityIndicator color={colors.brandPrimary} /></View> : !user ? <Login /> : <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface }, animation: reduceMotion ? 'none' : 'slide_from_right', animationDuration: 200 }} />}<GlobalToast /></View>;
}

function GlobalToast() {
  const { notice, user } = useStore(), { colors } = useTheme(), insets = useSafeAreaInsets();
  if (!notice || !user) return null;
  return <View pointerEvents="none" testID="app-toast" style={[styles.toast, { bottom: insets.bottom + 16, backgroundColor: colors.surfaceInverse }]}><Label size={13} style={{ color: colors.onSurfaceInverse }}>{notice}</Label></View>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, restoring: { flex: 1, alignItems: 'center', justifyContent: 'center' }, toast: { position: 'absolute', left: 20, right: 20, borderRadius: 14, padding: 16 } });
