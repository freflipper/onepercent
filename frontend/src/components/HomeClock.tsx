import React, { memo } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/src/theme';
import { useHomeTime } from '@/src/hooks/useHomeTime';
import { Card, Icon, Label } from './ui';

// Only this small card updates every second; the dashboard does not.
export const HomeClock = memo(function HomeClock({ zone, styles: s }: any) {
  const now = useHomeTime(zone, 1000), { colors } = useTheme();
  return <Card testID="date-time-card" style={s.clockCard}><View style={s.cardHead}><Icon name="sunny-outline" color={colors.brandPrimary} size={18} /><Label size={11} weight="600" muted style={s.eyebrow}>DATE & TIME</Label><Label size={11} muted style={{ marginLeft: 'auto' }}>{now.zone.split('/').pop()?.replace('_', ' ')}</Label></View><View style={s.clockRow}><View><Label testID="home-clock" size={44} weight="500" style={{ letterSpacing: -1.8, fontVariant: ['tabular-nums'] }}>{now.hoursMinutes}<Label size={23} muted>{now.seconds}</Label></Label><Label testID="home-date" size={13} muted>{now.fullDate}</Label></View><View style={s.dayTile}><Label size={11} weight="600" style={{ color: colors.brandPrimary }}>{now.monthShort}</Label><Label size={25} weight="600">{now.day}</Label></View></View></Card>;
});