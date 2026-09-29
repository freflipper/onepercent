import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { useStore } from '@/src/store';
import { api } from '@/src/api';
import { dateInput, parseDate } from '@/src/dates';
import { makeStyles, useTheme } from '@/src/theme';
import {
  notificationStatus,
  enableNotifications,
  sendTestNotification,
  syncNotifications,
} from '@/src/notifications';
import { Shell } from '@/src/components/Shell';
import {
  Button,
  Card,
  Confirm,
  ErrorMessage,
  Icon,
  Input,
  Label,
  Sheet,
} from '@/src/components/ui';
import { Choice } from '@/src/components/Form';

export default function Settings() {
  const { user, data, saveProfile, setThemePreference, logout, setNotice } = useStore(),
    s = useStyles(),
    { colors } = useTheme();
  const [values, setValues] = useState<any>({
      updated_at: user.updated_at,
      name: user.name,
      timezone: user.timezone,
      theme: user.theme,
      opening_balance: (user.opening_balance / 100).toFixed(2),
      opening_date: dateInput(user.opening_date),
      visible_days: [...user.visible_days],
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [permission, setPermission] = useState<any>(null),
    [explain, setExplain] = useState(false),
    [loggingOut, setLoggingOut] = useState(false),
    [storageStatus, setStorageStatus] = useState<any>(null);
  const update = (key: string, value: any) => setValues((v: any) => ({ ...v, [key]: value }));
  const [themeError, setThemeError] = useState(false);
  async function changeTheme(theme: 'Light' | 'Dark' | 'System') {
    update('theme', theme);
    setThemeError(false);
    setError('');
    try {
      const saved = await setThemePreference(theme, values.updated_at);
      if (saved?.updated_at) update('updated_at', saved.updated_at);
    } catch (e: any) {
      setThemeError(true);
      setError(e.message);
    }
  }
  useEffect(() => {
    notificationStatus()
      .then(setPermission)
      .catch(() => setPermission({ label: 'Notification status unavailable', supported: false }));
    api('/storage/status')
      .then(setStorageStatus)
      .catch(() => {});
  }, []);
  async function save() {
    setError('');
    setBusy(true);
    try {
      if (!/^-?\d+(\.\d{1,2})?$/.test(values.opening_balance.replace(',', '.')))
        throw new Error('Opening balance must have at most two decimal places.');
      const saved = await saveProfile({
        ...values,
        opening_date: parseDate(values.opening_date),
        opening_balance: Math.round(Number(values.opening_balance.replace(',', '.')) * 100),
      });
      if (saved?.updated_at) update('updated_at', saved.updated_at);
      setNotice('Settings saved.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function enable() {
    setExplain(false);
    try {
      const p = await enableNotifications();
      setPermission(p);
      if (p.granted) {
        await syncNotifications(data?.alerts || [], user.user_id);
        setNotice(
          Platform.OS === 'web'
            ? 'Browser reminders enabled. Keep this app open for alerts.'
            : 'Device reminders enabled and synchronised.',
        );
      }
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function test() {
    try {
      setError('');
      await sendTestNotification();
      setNotice(
        Platform.OS === 'web'
          ? 'Browser test requested. Check that the notification appears.'
          : 'Device test scheduled in 5 seconds.',
      );
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Shell title="Settings" section="settings">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <Card>
          <View style={s.profile}>
            <View style={s.avatar}>
              <Label size={22} weight="600">
                {user.name[0]}
              </Label>
            </View>
            <View style={{ flex: 1 }}>
              <Label size={20} weight="600">
                {user.name}
              </Label>
              <Label muted size={12}>
                {user.email}
              </Label>
            </View>
            <Icon name="lock-closed-outline" color={colors.muted} size={18} />
          </View>
          <Label muted size={12}>
            Google account · Private workspace in Supabase
          </Label>
        </Card>
        <Card>
          <Label size={18} weight="600">
            Your preferences
          </Label>
          <Input
            label="Profile name"
            testID="settings-name"
            value={values.name}
            onChangeText={(v: string) => update('name', v)}
          />
          <Input
            label="Time zone · IANA identifier"
            testID="settings-timezone"
            value={values.timezone}
            onChangeText={(v: string) => update('timezone', v)}
            placeholder="Europe/Rome"
          />
          <Choice
            label="Appearance"
            testID="settings-theme"
            value={values.theme}
            options={['Light', 'Dark', 'System'].map((v) => ({ label: v, value: v }))}
            onChange={changeTheme}
          />
          <Label muted size={12}>
            English · en-GB · 24-hour clock · Weeks start Monday
          </Label>
        </Card>
        <Card>
          <Label size={18} weight="600">
            Personal opening balance
          </Label>
          <Label muted size={13}>
            The balance before transactions on the opening date. Earlier movements stay in history
            but are not counted again.
          </Label>
          <Input
            label="Opening balance · EUR"
            testID="settings-opening-balance"
            keyboardType="numbers-and-punctuation"
            value={values.opening_balance}
            onChangeText={(v: string) => update('opening_balance', v)}
          />
          <Input
            label="Opening date · DD/MM/YYYY"
            testID="settings-opening-date"
            value={values.opening_date}
            onChangeText={(v: string) => update('opening_date', v)}
          />
        </Card>
        <Card>
          <Label size={18} weight="600">
            School week
          </Label>
          <Label muted size={12}>
            Choose the days shown in Weekly Subjects.
          </Label>
          {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
            (day, i) => (
              <Pressable
                testID={`visible-day-${i}`}
                key={day}
                onPress={() =>
                  update(
                    'visible_days',
                    values.visible_days.includes(i)
                      ? values.visible_days.filter((d: number) => d !== i)
                      : [...values.visible_days, i],
                  )
                }
                style={s.day}
              >
                <Label size={14}>{day}</Label>
                <Icon
                  name={values.visible_days.includes(i) ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={colors.brandPrimary}
                />
              </Pressable>
            ),
          )}
        </Card>
        <Button title="Save settings" testID="settings-save" onPress={save} busy={busy} />
        <Card>
          <Label size={18} weight="600">
            Notifications
          </Label>
          <Label testID="notification-permission-status" size={14} weight="600">
            {permission?.label || 'Checking permission…'}
          </Label>
          <Label muted size={13}>
            Browser reminders are checked while this app is open. Closing or suspending the app can
            prevent delivery. Reopen the app to refresh deadlines and read your notification inbox.
          </Label>
          <Label muted size={12}>
            Notification previews never include financial amounts. Delivery depends on browser
            permissions and device settings. This app does not use background push notifications.
          </Label>
          {permission?.supported ? (
            <>
              <Button
                title={
                  permission.granted
                    ? 'Synchronise reminders'
                    : permission.canAskAgain
                      ? 'Enable notifications'
                      : 'Permission help'
                }
                testID="notifications-enable"
                variant="secondary"
                onPress={async () => {
                  if (permission.granted) {
                    try {
                      await syncNotifications(data?.alerts || [], user.user_id);
                      setNotice(
                        Platform.OS === 'web'
                          ? 'Reminders refreshed. Keep this app open for alerts.'
                          : 'Device reminders synchronised.',
                      );
                    } catch (e: any) {
                      setError(e.message);
                    }
                  } else if (permission.canAskAgain) setExplain(true);
                  else if (Platform.OS === 'web')
                    setError(
                      'Allow notifications in the site controls beside the browser address, then reload 1%. On iPhone, add the app to your Home Screen first.',
                    );
                  else Linking.openSettings();
                }}
              />
              {!permission.granted && (
                <Label size={12} muted>
                  You can keep using 1% without notification permission.
                </Label>
              )}
              <Button
                title="Send test notification"
                testID="notifications-test"
                variant="secondary"
                onPress={test}
              />
            </>
          ) : (
            <Label size={13}>
              This browser cannot show system notifications. Your in-app inbox remains available. On
              iPhone, add 1% to your Home Screen and open it there to check support.
            </Label>
          )}
        </Card>
        <Card>
          <Label size={18} weight="600">
            Private attachments
          </Label>
          <Label testID="storage-status" size={13}>
            {storageStatus?.enabled
              ? 'Private Supabase storage configured'
              : 'Not activated · configuration required'}
          </Label>
          <Label size={12} muted>
            PNG, JPEG and WebP · 10 MB per file. Images are private and available through temporary
            links after signing in. Upload errors are shown before a file is marked as saved.
          </Label>
        </Card>
        <Card>
          <Label size={18} weight="600">
            Using this web app
          </Label>
          <Label muted size={13}>
            1% uses Google and Supabase for sign-in, private data and images. An internet connection
            is required to sign in, load and save your workspace. Unsaved notebook changes can be
            recovered from drafts on this device.
          </Label>
          <Label muted size={12}>
            You can add this app to your Home Screen from your browser. Print / Export PDF opens the
            browser print dialog. Installing the shortcut does not enable offline data or background
            reminders.
          </Label>
        </Card>
        {!!error && (
          <ErrorMessage
            message={error}
            retry={themeError ? () => changeTheme(values.theme) : undefined}
          />
        )}
        <Button
          title="Sign out"
          testID="settings-sign-out"
          variant="danger"
          icon="log-out-outline"
          onPress={() => setLoggingOut(true)}
        />
        <Label muted size={11} style={{ textAlign: 'center' }}>
          1% · Your space. Your pace.
        </Label>
      </ScrollView>
      <Sheet
        visible={explain}
        title="A gentle nudge, when you need it"
        onClose={() => setExplain(false)}
      >
        <Label>
          Allow notifications for plans, deadlines and renewals while 1% is open. Delivery is not
          guaranteed when this app is closed or suspended. You control this permission in your
          browser settings.
        </Label>
        <Button
          title="Continue"
          testID="notification-permission-continue"
          onPress={enable}
          style={{ marginTop: 28 }}
        />
        <Button
          title="Not now"
          testID="notification-permission-cancel"
          variant="ghost"
          onPress={() => setExplain(false)}
        />
      </Sheet>
      <Confirm
        visible={loggingOut}
        title="Sign out of 1%?"
        message="Your saved data stays in your account. Unsaved device drafts and browser reminders are cleared when you sign out."
        confirmLabel="Sign out"
        onCancel={() => setLoggingOut(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await logout();
          } catch (e: any) {
            setError(e.message);
            setLoggingOut(false);
          } finally {
            setBusy(false);
          }
        }}
        busy={busy}
      />
    </Shell>
  );
}
const useStyles = makeStyles((c) => ({
  content: {
    padding: 20,
    paddingBottom: 32,
    gap: 20,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: c.brandSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  day: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
}));
