import type { ExpoConfig, ConfigContext } from 'expo/config';
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config, name: '1%', slug: config.slug || 'one-percent', scheme: 'onepercent',
  experiments: { ...config.experiments, baseUrl: process.env.EXPO_PUBLIC_BASE_PATH || '' },
  android: { ...config.android, permissions: [...(config.android?.permissions || []), 'POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM'] },
  plugins: [...(config.plugins || []), 'expo-notifications', 'expo-document-picker'],
});
