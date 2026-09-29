import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useStore } from '@/src/store';
import { sections } from '@/src/schema';
import { makeStyles, useTheme } from '@/src/theme';
import { Icon, IconButton, Label } from './ui';
import { AnimatedSafeArea, SlideModal } from './SlideModal';

export const go = (section: string, params: any = {}) => section ? router.push({ pathname: '/[section]', params: { section, ...params } }) : router.push('/');
export function Shell({ title, section = '', children, right, chrome }: any) {
  const [open, setOpen] = useState(false), [trading, setTrading] = useState(true);
  const { user } = useStore(), s = useStyles(), { colors } = useTheme();
  const navigate = (key: string) => { setOpen(false); go(key); };
  return <SafeAreaView edges={['top', 'bottom']} style={s.screen}>
    <View testID="sticky-header" style={s.header}><IconButton name="menu-outline" label="Open menu" testID="menu-open" onPress={() => setOpen(true)} /><Pressable testID="home-logo" onPress={() => go('')} accessibilityLabel="Home"><Label size={28} weight="700" style={s.logo}>1<TextPercent /></Label></Pressable><View style={s.headerRight}>{right || <IconButton testID="profile-button" name="person-circle-outline" label="Profile and settings" onPress={() => go('settings')} />}</View></View>
    {title ? <View style={s.titleRow}><Label testID="section-title" size={30} weight="600" style={{ flex: 1 }}>{title}</Label></View> : null}
    {chrome}{children}
    <SlideModal visible={open} onClose={() => setOpen(false)} direction="left" overlayStyle={s.drawerOverlay} backdropTestID="menu-backdrop">{(motionStyle: any) => <AnimatedSafeArea edges={['top', 'bottom']} style={[s.drawer, motionStyle]}>
      <View style={s.drawerHeader}><Pressable testID="drawer-home-logo" onPress={() => navigate('')}><Label size={36} weight="700">1%</Label></Pressable><IconButton name="close-outline" label="Close menu" testID="menu-close" onPress={() => setOpen(false)} /></View>
      <Label size={11} weight="600" muted style={s.workspaceLabel}>YOUR WORKSPACE</Label>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.drawerLinks}>
        {sections.map((item, i) => <React.Fragment key={item.key}>
          {i === 5 && <Pressable testID="trading-menu-toggle" onPress={() => setTrading(!trading)} style={s.navLink}><Icon name="trending-up-outline" size={19} /><Label size={14} style={{ flex: 1 }}>Trading Journal</Label><Icon name={trading ? 'chevron-up' : 'chevron-down'} size={14} /></Pressable>}
          {(!item.group || trading) && <Pressable testID={`nav-${item.key || 'home'}`} accessibilityRole="button" onPress={() => navigate(item.key)} style={[s.navLink, item.group && s.subLink, section === item.key && s.activeLink]}><Icon name={item.icon} size={18} color={section === item.key ? colors.brandPrimary : colors.muted} /><Label size={14} weight={section === item.key ? '600' : '400'}>{item.title}</Label>{section === item.key && <View style={s.activeDot} />}</Pressable>}
        </React.Fragment>)}
      </ScrollView>
      <View style={s.drawerFooter}><Pressable testID="nav-settings" style={s.navLink} onPress={() => navigate('settings')}><Icon name="settings-outline" size={19} /><Label size={14}>Settings</Label></Pressable><View style={s.profile}><View style={s.avatar}><Label weight="600">{user?.name?.slice(0, 1)}</Label></View><View style={{ flex: 1 }}><Label weight="600" size={14}>{user?.name}</Label><Label muted size={11}>Personal workspace</Label></View><Icon name="lock-closed-outline" size={16} color={colors.muted} /></View></View>
    </AnimatedSafeArea>}</SlideModal>
  </SafeAreaView>;
}
function TextPercent() { return <Label size={24} weight="500">%</Label>; }
const useStyles = makeStyles(c => ({ screen: { flex: 1, backgroundColor: c.surface }, header: { minHeight: 62, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surface }, logo: { letterSpacing: -1.5 }, headerRight: { minWidth: 44, alignItems: 'flex-end' }, titleRow: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 12, flexDirection: 'row' }, drawerOverlay: { flex: 1, backgroundColor: c.overlay }, drawer: { width: '84%', maxWidth: 320, height: '100%', backgroundColor: c.surfaceRaised, paddingHorizontal: 18 }, drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 20 }, workspaceLabel: { letterSpacing: 1.7, paddingHorizontal: 12, marginBottom: 14 }, drawerLinks: { paddingBottom: 18, gap: 3 }, navLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 12, borderRadius: 10 }, subLink: { paddingLeft: 35 }, activeLink: { backgroundColor: c.brandTertiary }, activeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.brandPrimary, marginLeft: 'auto' }, drawerFooter: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8, paddingBottom: 14 }, profile: { paddingHorizontal: 12, paddingTop: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }, avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.brandSecondary, alignItems: 'center', justifyContent: 'center' }, toast: { position: 'absolute', left: 20, right: 20, borderRadius: 14, padding: 16, backgroundColor: c.surfaceInverse } }));