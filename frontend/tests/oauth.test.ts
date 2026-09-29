import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOAuth, resetOAuth } from '../src/cloud/oauth';
import { normaliseBasePath } from '../src/cloud/paths';

const exchange = vi.hoisted(() => vi.fn(async (_code: string) => ({ error: null as Error | null })));
vi.mock('../src/cloud/client', () => ({ backend: () => ({ auth: { exchangeCodeForSession: exchange } }) }));
vi.mock('../src/cloud/auth-platform', () => import('../src/cloud/auth-platform.web'));
const origin = 'https://onepercent.example';
// CI configures the Pages base path before running tests, as it does for the build.
const configuredBase = normaliseBasePath(process.env.EXPO_PUBLIC_BASE_PATH || '');
const callback = `${configuredBase}/auth/callback`;
beforeEach(() => {
  resetOAuth(); exchange.mockClear(); exchange.mockResolvedValue({ error: null });
  vi.stubGlobal('window', { location: { origin, pathname: callback, href: origin + callback + '?code=test' }, history: { state: {}, replaceState: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe('Google PKCE callback', () => {
  it('exchanges a callback only once and strips its URL before awaiting the server', async () => {
    exchange.mockImplementation(async () => {
      expect(window.history.replaceState).toHaveBeenCalledWith({}, '', callback);
      return { error: null };
    });
    await Promise.all([completeOAuth(origin + callback + '?code=once'), completeOAuth(origin + callback + '?code=once')]);
    expect(exchange).toHaveBeenCalledTimes(1);
  });
  it('rejects another origin and never exchanges its code', async () => {
    await expect(completeOAuth('https://other.example' + callback + '?code=foreign')).rejects.toThrow('Invalid authentication callback');
    expect(exchange).not.toHaveBeenCalled();
  });
  it('rejects a callback outside the configured base path, even on the same origin', async () => {
    const otherCallback = configuredBase ? '/auth/callback' : '/onepercent/auth/callback';
    await expect(completeOAuth(origin + otherCallback + '?code=wrong-base')).rejects.toThrow('Invalid authentication callback');
    expect(exchange).not.toHaveBeenCalled();
  });
  it('accepts the trailing slash added by static hosting', async () => {
    await completeOAuth(origin + callback + '/?code=pages');
    expect(exchange).toHaveBeenCalledWith('pages');
  });
  it('does not echo provider details that may contain an OAuth code or secret', async () => {
    await expect(completeOAuth(origin + callback + '?error=server_error&error_description=TEST_ONLY_PRIVATE_DETAIL'))
      .rejects.toThrow('The sign-in service could not complete Google sign-in.');
    expect(exchange).not.toHaveBeenCalled();
  });
  it('sanitises exchange errors', async () => {
    exchange.mockResolvedValue({ error: new Error('TEST_ONLY_PRIVATE_DETAIL') });
    await expect(completeOAuth(origin + callback + '?code=expired')).rejects.toThrow('This sign-in attempt could not be completed.');
  });
  it('allows root and repository base paths and rejects unsafe routes', () => {
    expect(normaliseBasePath('')).toBe('');
    expect(normaliseBasePath('/onepercent/')).toBe('/onepercent');
    expect(() => normaliseBasePath('//other.example')).toThrow();
    expect(() => normaliseBasePath('/../escape')).toThrow();
  });
});
