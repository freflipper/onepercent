import { backend } from './client';
import { validateCallback, clearCallbackLocation } from './auth-platform';

const exchanges = new Map<string, Promise<void>>();
const signInServiceError =
  'The sign-in service could not complete Google sign-in. Please try again. If this continues, the Google sign-in settings need to be checked.';
export async function completeOAuth(url: string) {
  let parsed: URL;
  try {
    parsed = validateCallback(url);
  } catch {
    clearCallbackLocation();
    throw new Error('Invalid authentication callback. Please start Google sign-in again.');
  }
  // Capture the validated callback, then remove its code and provider details before
  // any asynchronous work. A later exchange must not erase a newer callback URL.
  clearCallbackLocation();
  const parameters = [parsed.searchParams, new URLSearchParams(parsed.hash.slice(1))];
  if (
    parameters.some((params) =>
      ['error', 'error_code', 'error_description'].some((key) => params.has(key)),
    )
  ) {
    const errors = parameters.flatMap((params) => params.getAll('error'));
    const codes = parameters.flatMap((params) => params.getAll('error_code'));
    const denied =
      errors.length > 0 &&
      errors.every((error) => error === 'access_denied') &&
      codes.every((code) => code === 'access_denied');
    // Never display provider descriptions: they can contain codes, tokens or secrets.
    throw new Error(
      denied ? 'Google sign-in was cancelled or rejected. Please try again.' : signInServiceError,
    );
  }
  const code = parsed.searchParams.get('code');
  if (!code) throw new Error('The sign-in callback did not contain an authorization code.');
  if (!exchanges.has(code))
    exchanges.set(
      code,
      (async () => {
        try {
          const { error } = await backend().auth.exchangeCodeForSession(code);
          if (error) throw error;
        } catch {
          throw new Error(
            'This sign-in attempt could not be completed. Please start Google sign-in again in this browser.',
          );
        }
      })(),
    );
  await exchanges.get(code);
}
export function resetOAuth() { exchanges.clear(); }
