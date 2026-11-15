const $ = (id) => document.getElementById(id);
const signedOutEl = $('signed-out');
const signedInEl = $('signed-in');
const signinBtn = $('signin');
const drop = $('drop');
const input = $('file');
const statusEl = $('status');

const ALLOWED = /\.docx?$/i;

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'error' : '';
}

// All Google sign-in work happens in background.js.
async function send(type) {
  const res = await chrome.runtime.sendMessage({ type });
  if (res?.error) throw new Error(res.error);
  return res;
}

function render(email) {
  signedOutEl.hidden = !!email;
  signedInEl.hidden = !email;
  $('email').textContent = email ? `Signed in as ${email}` : '';
}

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  setStatus('');
  try {
    // If the popup closes while the Google window is open, sign-in still
    // finishes in the background; reopening the popup shows the account.
    const { email } = await send('signIn');
    render(email);
  } catch (e) {
    // Closing the Google window is not worth an error message.
    if (!/did not approve|closed|cancel/i.test(e.message)) setStatus(e.message, true);
  } finally {
    signinBtn.disabled = false;
  }
});

$('signout').addEventListener('click', async () => {
  await send('signOut');
  render(null);
  setStatus('');
});

async function uploadAsGoogleDoc(file, token) {
  const metadata = {
    name: file.name.replace(/\.docx?$/i, ''),
    mimeType: 'application/vnd.google-apps.document', // tells Drive to convert
  };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  body.append('file', file);

  return fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }
  );
}

async function tokenOrSignOut() {
  const { token } = await send('token');
  if (!token) {
    render(null);
    throw new Error('Your session expired. Please sign in again.');
  }
  return token;
}

async function handleFile(file) {
  if (!file) return;
  if (!ALLOWED.test(file.name)) {
    setStatus('Please choose a .doc or .docx file.', true);
    return;
  }

  drop.classList.add('busy');
  try {
    setStatus(`Uploading "${file.name}"…`);
    let res = await uploadAsGoogleDoc(file, await tokenOrSignOut());

    if (res.status === 401) {
      // Token was revoked or expired early: drop it and retry once.
      await send('invalidate');
      res = await uploadAsGoogleDoc(file, await tokenOrSignOut());
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Upload failed (${res.status})`);
    }

    const { id, webViewLink } = await res.json();
    setStatus('Opening in Google Docs…');
    chrome.tabs.create({ url: webViewLink || `https://docs.google.com/document/d/${id}/edit` });
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    drop.classList.remove('busy');
    input.value = '';
  }
}

input.addEventListener('change', () => handleFile(input.files[0]));

['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); })
);
drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

send('status')
  .then(({ email }) => render(email))
  .catch((e) => { render(null); setStatus(e.message, true); });
