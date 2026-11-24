// Google sign-in runs here, not in the popup: the sign-in window steals focus,
// which closes the popup and would kill any code running inside it.
//
// Uses chrome.identity.launchWebAuthFlow, which works in Chrome, Edge, Brave
// and Opera (unlike getAuthToken, which is Chrome-only).

import { CLIENT_ID } from './config.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SCOPES = ['openid', 'email', DRIVE_SCOPE];

// The email stays across browser restarts so we can sign back in silently;
// the access token lives in session storage, which is cleared on restart.
async function getEmail() {
  return (await chrome.storage.local.get('email')).email || null;
}

async function authFlow({ interactive, loginHint }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(), // https://<id>.chromiumapp.org/
    scope: SCOPES.join(' '),
    include_granted_scopes: 'true',
    prompt: interactive ? 'select_account' : 'none',
    ...(loginHint ? { login_hint: loginHint } : {}),
  });

  const redirect = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive });
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  if (params.get('error')) throw new Error(params.get('error'));

  const token = params.get('access_token');
  // Google lets people untick individual permissions; we can't work without Drive.
  if (!(params.get('scope') || '').split(' ').includes(DRIVE_SCOPE)) {
    throw new Error(chrome.i18n.getMessage('driveAccessNeeded'));
  }

  const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());

  const expiresIn = Number(params.get('expires_in') || 3600);
  await chrome.storage.local.set({ email: info.email });
  await chrome.storage.session.set({ token, expiresAt: Date.now() + (expiresIn - 60) * 1000 });
  return { email: info.email, token };
}

// Returns a usable token, refreshing silently if possible; null if the user must sign in.
async function getValidToken() {
  const { token, expiresAt } = await chrome.storage.session.get(['token', 'expiresAt']);
  if (token && Date.now() < expiresAt) return token;

  const email = await getEmail();
  if (!email) return null;
  try {
    return (await authFlow({ interactive: false, loginHint: email })).token;
  } catch {
    return null;
  }
}

async function signOut() {
  const { token } = await chrome.storage.session.get('token');
  if (token) {
    // Revoke so the next sign-in shows the account picker and consent again.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    }).catch(() => {});
  }
  await chrome.storage.session.clear();
  await chrome.storage.local.remove('email');
}

const handlers = {
  status: async () => ({ email: await getEmail() }),
  signIn: async () => ({ email: (await authFlow({ interactive: true })).email }),
  signOut: async () => (await signOut(), {}),
  token: async () => ({ token: await getValidToken() }),
  invalidate: async () => (await chrome.storage.session.clear(), {}),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler()
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true; // keep the channel open for the async reply
});
