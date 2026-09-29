import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { makeStyles, useTheme } from '@/src/theme';
import { useStore } from '@/src/store';
import { Button, ErrorMessage, Icon, Label } from '@/src/components/ui';

export default function Login() {
  const s = useStyles(), { colors } = useTheme(), { signIn, authError, authLoading, retry } = useStore();
  return <SafeAreaView style={s.screen}><ScrollView contentContainerStyle={s.content}>
    <View style={s.top}><Label size={13} weight="600" muted style={{ letterSpacing: 2 }}>YOUR PERSONAL WORKSPACE</Label><View style={s.brand}><Label size={92} weight="600" style={{ letterSpacing: -7 }}>1%</Label><View style={s.brandDot} /></View></View>
    <View style={s.middle}><View style={s.line} /><Label testID="login-heading" size={34} weight="600">A little more clarity.{"\n"}Every day.</Label><Label size={16} muted style={{ marginTop: 16, maxWidth: 310 }}>Your plans, notes, school and money. Together in one quiet space.</Label>
      <View style={s.features}>{[['calendar-outline', 'Make room for your day'], ['document-text-outline', 'Keep your thoughts together'], ['lock-closed-outline', 'A workspace that stays yours']].map(([icon, text]) => <View key={text} style={s.feature}><View style={s.icon}><Icon name={icon} size={20} color={colors.brandPrimary} /></View><Label size={14}>{text}</Label></View>)}</View>
    </View>
    <View style={s.bottom}>{authLoading ? <ActivityIndicator color={colors.brandPrimary} /> : <Button title="Continue with Google" testID="google-sign-in" icon="logo-google" onPress={signIn} />}{authError ? <ErrorMessage message={authError} retry={() => retry().catch(() => {})} /> : null}<Label size={12} muted style={{ textAlign: 'center', marginTop: 16 }}>Sign in to your private workspace.</Label></View>
  </ScrollView></SafeAreaView>;
}
const useStyles = makeStyles(c => ({ screen: { flex: 1, backgroundColor: c.surface }, content: { flexGrow: 1, padding: 30, paddingTop: 36, paddingBottom: 32, maxWidth: 520, width: '100%', alignSelf: 'center' }, top: { paddingBottom: 25 }, brand: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 14 }, brandDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: c.brandPrimary, marginTop: 26 }, middle: { flex: 1, paddingTop: 18 }, line: { width: 42, height: 3, borderRadius: 2, backgroundColor: c.brandPrimary, marginBottom: 24 }, features: { paddingTop: 32, gap: 16, paddingBottom: 36 }, feature: { flexDirection: 'row', alignItems: 'center', gap: 12 }, icon: { width: 40, height: 40, backgroundColor: c.brandSecondary, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, bottom: { paddingTop: 10 } }));
