import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme } from '@/src/theme';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';
import { AnimatedKeyboardAvoidingView, SlideModal } from './SlideModal';

export function Label({ children, size = 15, weight = '400', muted = false, style, testID }: any) {
  const { colors } = useTheme();
  return <Text testID={testID} style={[{ color: muted ? colors.muted : colors.onSurface, fontSize: size, fontWeight: weight, lineHeight: size * 1.4 }, style]}>{children}</Text>;
}
export function Icon({ name, size = 21, color }: any) { const { colors } = useTheme(); return <Ionicons name={name} size={size} color={color || colors.onSurface} />; }
export function Button({ title, onPress, testID, icon, variant = 'primary', busy = false, disabled = false, style }: any) {
  const s = useStyles(), { colors } = useTheme(), reduceMotion = useReducedMotion();
  const textColor = variant === 'primary' ? colors.onBrandPrimary : variant === 'danger' ? colors.error : colors.brandPrimary;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [s.button, variant === 'primary' ? s.primary : variant === 'secondary' ? s.secondary : s.ghost, variant === 'primary' && pressed && { backgroundColor: colors.brandPressed }, { opacity: disabled ? 0.4 : pressed ? 0.65 : 1, transform: [{ scale: pressed && !reduceMotion ? 0.98 : 1 }] }, style]}>
    {busy ? <ActivityIndicator color={textColor} /> : <>{icon && <Icon name={icon} size={18} color={textColor} />}<Text style={[s.buttonText, { color: textColor }]}>{title}</Text></>}
  </Pressable>;
}
export function IconButton({ name, onPress, testID, label, color }: any) {
  const s = useStyles();
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={event => { event.stopPropagation(); onPress?.(event); }} style={({ pressed }) => [s.iconButton, { opacity: pressed ? 0.5 : 1 }]}><Icon name={name} color={color} /></Pressable>;
}
export function Card({ children, style, testID }: any) { const s = useStyles(); return <View testID={testID} style={[s.card, style]}>{children}</View>; }
export function Empty({ title, detail, icon = 'file-tray-outline', action, actionLabel = 'Create your first item', testID = 'empty-state' }: any) {
  const s = useStyles(), { colors } = useTheme();
  return <View testID={testID} style={s.empty}><View style={s.emptyIcon}><Icon name={icon} size={26} color={colors.brandPrimary} /></View><Label size={18} weight="600" style={s.center}>{title}</Label><Label muted style={s.center}>{detail}</Label>{action && <Button title={actionLabel} testID={`${testID}-action`} variant="secondary" onPress={action} style={s.emptyButton} />}</View>;
}
export function Chips({ options, value, onChange, testID = 'filter' }: any) {
  const s = useStyles();
  return <View style={s.chipRow}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
    {options.map((item: any) => { const key = typeof item === 'string' ? item : item.value; const title = typeof item === 'string' ? item : item.label; return <Pressable accessibilityRole="button" accessibilityState={{ selected: key === value }} testID={`${testID}-${key}`} key={key} onPress={() => onChange(key)} style={[s.chip, key === value && s.chipActive]}><Label size={13} weight="500" style={key === value ? s.chipTextActive : undefined}>{title}</Label></Pressable>; })}
  </ScrollView></View>;
}
export function Input({ label, value, onChangeText, testID, multiline, placeholder, keyboardType, editable = true }: any) {
  const s = useStyles(), { colors } = useTheme();
  return <View style={s.field}><Label size={13} weight="600">{label}</Label><TextInput testID={testID} accessibilityLabel={label} value={value == null ? '' : String(value)} onChangeText={onChangeText} multiline={multiline} placeholder={placeholder} placeholderTextColor={colors.placeholder} keyboardType={keyboardType || 'default'} editable={editable} autoCapitalize={keyboardType ? 'none' : 'sentences'} style={[s.input, multiline && s.multiline, !editable && { opacity: 0.6 }]} /></View>;
}
export function Sheet({ visible, title, onClose, children, footer }: any) {
  const s = useStyles(), insets = useSafeAreaInsets();
  return <SlideModal visible={visible} onClose={onClose} direction="bottom" overlayStyle={s.overlay} backdropTestID="sheet-backdrop">{(motionStyle: any) => <AnimatedKeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }, motionStyle]}><View style={s.handle} /><View style={s.sheetHeader}><Label size={22} weight="600" style={{ flex: 1 }}>{title}</Label><IconButton name="close" label="Close" testID="sheet-close" onPress={onClose} /></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.sheetContent}>{children}</ScrollView>{footer && <View style={s.footer}>{footer}</View>}</AnimatedKeyboardAvoidingView>}</SlideModal>;
}
export function Confirm({ visible, title = 'Delete this item?', message, onCancel, onConfirm, busy, error, confirmLabel = 'Delete' }: any) {
  return <Sheet visible={visible} title={title} onClose={onCancel} footer={<Button title={confirmLabel} variant="danger" testID="confirm-action" onPress={onConfirm} busy={busy} />}><Label>{message || 'This action cannot be undone.'}</Label>{error ? <ErrorMessage message={error} /> : null}<Button title="Keep item" variant="secondary" testID="confirm-cancel" onPress={onCancel} style={{ marginTop: 28 }} /></Sheet>;
}
export function ErrorMessage({ message, retry }: any) { const { colors } = useTheme(); return <View testID="error-message" style={{ gap: 8, paddingVertical: 12 }}><Label style={{ color: colors.error }}>{message}</Label>{retry && <Button title="Retry" onPress={retry} testID="error-retry" variant="secondary" />}</View>; }
export const useStyles = makeStyles(c => ({
  card: { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, borderRadius: 20, padding: 20, gap: 12 },
  button: { minHeight: 48, paddingHorizontal: 20, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  primary: { backgroundColor: c.brand }, secondary: { backgroundColor: c.brandSecondary }, ghost: { backgroundColor: c.transparent }, buttonText: { fontSize: 15, fontWeight: '600' },
  iconButton: { height: 44, width: 44, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 20, gap: 10 }, emptyIcon: { backgroundColor: c.brandTertiary, width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, center: { textAlign: 'center' }, emptyButton: { marginTop: 12 },
  chipRow: { height: 56, flexShrink: 0 }, chips: { paddingHorizontal: 20, gap: 8, alignItems: 'center' }, chip: { height: 36, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, flexShrink: 0, justifyContent: 'center' }, chipActive: { backgroundColor: c.brandSecondary, borderColor: c.brandPrimary }, chipTextActive: { color: c.onBrandSecondary },
  field: { gap: 8, marginBottom: 18 }, input: { color: c.onSurface, backgroundColor: c.surfaceTertiary, outlineColor: c.brandPrimary, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, paddingVertical: 14, minHeight: 50, fontSize: 16 }, multiline: { minHeight: 110, textAlignVertical: 'top' },
  overlay: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' }, sheet: { backgroundColor: c.surfaceRaised, maxHeight: '92%', height: '80%', borderTopLeftRadius: 26, borderTopRightRadius: 26, width: '100%', maxWidth: 700, alignSelf: 'center', paddingTop: 10, overflow: 'hidden' }, handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, alignSelf: 'center' }, sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 12, paddingBottom: 14 }, sheetContent: { padding: 22, paddingTop: 6, paddingBottom: 30 }, footer: { paddingHorizontal: 22, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.border },
}));