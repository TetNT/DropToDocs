const $ = (id) => document.getElementById(id);
const signedOutEl = $('signed-out');
const signedInEl = $('signed-in');
const signinBtn = $('signin');
const drop = $('drop');
const input = $('file');
const openAfter = $('open-after');
const list = $('files');
const statusEl = $('status');

// File extension -> Google file type it's converted to.
const KINDS = {
  doc: 'document', docx: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation',
};
const LABELS = { document: 'Docs', spreadsheet: 'Sheets', presentation: 'Slides' };
const URL_PATHS = { document: 'document', spreadsheet: 'spreadsheets', presentation: 'presentation' };
const PARALLEL_UPLOADS = 3;

const extOf = (name) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

function spinner() {
  const s = document.createElement('span');
  s.className = 'spinner';
  s.setAttribute('aria-hidden', 'true');
  return s;
}

function setStatus(msg, isError = false, busy = false) {
  statusEl.className = isError ? 'error' : '';
  statusEl.replaceChildren(...(busy ? [spinner()] : []), msg);
}

// All Google sign-in work happens in background.js.
async function send(type) {
  const res = await chrome.runtime.sendMessage({ type });
  if (res?.error) throw new Error(res.error);
  return res;
}

let currentEmail = null;

function render(email) {
  currentEmail = email || null;
  signedOutEl.hidden = !!email;
  signedInEl.hidden = !email;
  $('email').textContent = email ? `Signed in as ${email}` : '';
  if (email) loadStorage();
  else $('storage').hidden = true;
}

/* ---------- Sign in / out ---------- */

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
  list.replaceChildren();
  setStatus('');
});

/* ---------- "Open files after upload" setting ---------- */

chrome.storage.local.get('openAfterUpload').then(({ openAfterUpload }) => {
  if (openAfterUpload !== undefined) openAfter.checked = openAfterUpload;
});
openAfter.addEventListener('change', () => {
  chrome.storage.local.set({ openAfterUpload: openAfter.checked });
});

/* ---------- "Save to" setting ---------- */

// New installs start with this folder; clearing the box means top level.
const DEFAULT_FOLDER = 'DropToDocs';
const folderInput = $('folder-name');

// "  Work / Imports/ " -> "Work/Imports"; "" or "/" -> "" (top level).
function cleanFolderPath(raw) {
  return raw.split('/').map((s) => s.trim()).filter(Boolean).join('/');
}

chrome.storage.local.get('folderPath').then(({ folderPath }) => {
  folderInput.value = folderPath ?? DEFAULT_FOLDER;
});
folderInput.addEventListener('change', () => {
  folderInput.value = cleanFolderPath(folderInput.value);
  chrome.storage.local.set({ folderPath: folderInput.value });
});

/* ---------- Token handling ---------- */

class SignedOutError extends Error {}

let tokenPromise = null;

// One token for the whole batch; refreshed once if Google rejects it.
function getToken(refresh = false) {
  if (refresh || !tokenPromise) {
    tokenPromise = (async () => {
      if (refresh) await send('invalidate');
      const { token } = await send('token');
      if (!token) throw new SignedOutError('Your session expired. Please sign in again.');
      return token;
    })();
  }
  return tokenPromise;
}

/* ---------- Destination folder ---------- */

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const quote = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Small Drive API helper: retries once on an expired token; null on 404.
async function driveJson(url, opts = {}) {
  const call = async (token) =>
    fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } });
  let res = await call(await getToken());
  if (res.status === 401) res = await call(await getToken(true));
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Google Drive error (${res.status})`);
  }
  return res.json();
}

// The extension can only see folders it created, so this finds its own
// folder (e.g. after a reinstall) rather than any folder with that name.
async function findOrCreateFolder(name, parentId) {
  const q = `mimeType='${FOLDER_MIME}' and name='${quote(name)}' and trashed=false and '${parentId || 'root'}' in parents`;
  const found = await driveJson(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  if (found?.files?.length) return found.files[0].id;

  const created = await driveJson(`${DRIVE}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return created.id;
}

// Returns the folder ID to upload into, or null for the top level of My Drive.
// Folder IDs are remembered per account, so the folder keeps working even if
// it is renamed or moved in Drive.
async function resolveDestination() {
  const path = cleanFolderPath(folderInput.value);
  folderInput.value = path;
  if (!path) {
    await chrome.storage.local.set({ folderPath: '' });
    return null;
  }
  const { folderIds = {} } = await chrome.storage.local.get('folderIds');
  const mine = folderIds[currentEmail] || {};

  if (mine[path]) {
    const f = await driveJson(`${DRIVE}/${mine[path]}?fields=id,trashed`);
    if (f && !f.trashed) return mine[path];
  }

  let parent = null;
  for (const part of path.split('/')) parent = await findOrCreateFolder(part, parent);

  folderIds[currentEmail] = { ...mine, [path]: parent };
  await chrome.storage.local.set({ folderIds, folderPath: path });
  return parent;
}

/* ---------- Upload ---------- */

function upload(file, kind, token, folderId) {
  const metadata = {
    name: file.name.replace(/\.[^.]+$/, ''),
    mimeType: `application/vnd.google-apps.${kind}`, // tells Drive to convert
    ...(folderId ? { parents: [folderId] } : {}),
  };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  body.append('file', file);

  return fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }
  );
}

async function uploadWithRetry(file, kind, folderId) {
  let res = await upload(file, kind, await getToken(), folderId);
  if (res.status === 401) {
    // Token was revoked or expired early: get a fresh one and retry once.
    res = await upload(file, kind, await getToken(true), folderId);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Upload failed (${res.status})`);
  }
  const { id, webViewLink } = await res.json();
  return webViewLink || `https://docs.google.com/${URL_PATHS[kind]}/d/${id}/edit`;
}

/* ---------- Google storage display ---------- */

// Google shows sizes in 1024-based units labelled GB, so do the same.
function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const digits = n >= 100 || i === 0 ? 0 : 1;
  return `${n.toFixed(digits).replace(/\.0$/, '')} ${units[i]}`;
}

function fetchQuota(token) {
  return fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Shows "X of Y used · Z free". Storage is shared by Drive, Gmail and Photos.
// Any problem just hides the display: it must never get in the way of uploads.
async function loadStorage() {
  const box = $('storage');
  try {
    let res = await fetchQuota(await getToken());
    if (res.status === 401) res = await fetchQuota(await getToken(true));
    if (!res.ok) throw new Error(`quota ${res.status}`);

    const q = (await res.json()).storageQuota || {};
    const usage = Number(q.usage);
    const limit = q.limit === undefined ? null : Number(q.limit); // no limit on some work/school accounts
    if (!Number.isFinite(usage)) throw new Error('no usage');

    const text = $('storage-text');
    const fill = box.querySelector('.fill');
    box.classList.remove('warn', 'full');
    box.querySelector('.bar').hidden = !limit;

    if (limit) {
      const ratio = Math.min(usage / limit, 1);
      const free = Math.max(limit - usage, 0);
      fill.style.width = `${Math.max(ratio * 100, 1)}%`;
      if (ratio >= 0.95) box.classList.add('full');
      else if (ratio >= 0.8) box.classList.add('warn');
      const used = document.createElement('b');
      used.textContent = `${formatBytes(usage)} of ${formatBytes(limit)} used`;
      text.replaceChildren(used, ratio >= 1 ? ' · Storage full' : ` · ${formatBytes(free)} free`);
      box.title = 'Google storage is shared by Drive, Gmail and Photos.';
    } else {
      const used = document.createElement('b');
      used.textContent = `${formatBytes(usage)} used`;
      text.replaceChildren(used, ' · no storage limit');
      box.title = '';
    }
    box.hidden = false;
  } catch {
    box.hidden = true;
  }
}

/* ---------- File list rows ---------- */

function addRow(file, kind) {
  const li = document.createElement('li');
  const badge = document.createElement('span');
  badge.className = `kind ${kind || ''}`;
  badge.textContent = LABELS[kind] || '?';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = file.name;
  name.title = file.name;
  const state = document.createElement('span');
  state.className = 'state';
  li.append(badge, name, state);
  list.append(li);

  return {
    set(text, isError = false, busy = false) {
      state.className = `state${isError ? ' error' : ''}`;
      state.replaceChildren(...(busy ? [spinner()] : []), text);
    },
    done(url, opened) {
      state.className = 'state';
      const btn = document.createElement('button');
      btn.textContent = opened ? 'Opened ↗' : 'Open ↗';
      btn.addEventListener('click', () => chrome.tabs.create({ url }));
      state.replaceChildren(btn);
    },
    fail(message) {
      this.set('Failed', true);
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = message;
      name.append(detail);
      name.style.whiteSpace = 'normal';
    },
  };
}

/* ---------- Batch handling ---------- */

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  list.replaceChildren();
  setStatus('');
  $('folder-link').hidden = true;
  tokenPromise = null;

  const jobs = [];
  for (const file of files) {
    const kind = KINDS[extOf(file.name)];
    const row = addRow(file, kind);
    if (kind) {
      row.set('Waiting…');
      jobs.push({ file, kind, row });
    } else {
      row.fail('Not a Word, Excel or PowerPoint file.');
    }
  }
  if (!jobs.length) return;

  const shouldOpen = openAfter.checked;
  const openedTabs = [];
  let failed = files.length - jobs.length;
  let signedOut = false;

  drop.classList.add('busy');
  folderInput.disabled = true;
  const finish = () => {
    drop.classList.remove('busy');
    folderInput.disabled = false;
    input.value = '';
  };

  // Find or create the destination folder once for the whole batch.
  let folderId = null;
  {
    const path = cleanFolderPath(folderInput.value);
    if (path) setStatus(`Preparing folder "${path}"…`, false, true);
    try {
      folderId = await resolveDestination();
    } catch (e) {
      finish();
      if (e instanceof SignedOutError) {
        render(null);
        setStatus(e.message, true);
      } else {
        for (const job of jobs) job.row.set('Not uploaded', true);
        setStatus(`Couldn't open the destination folder: ${e.message}`, true);
      }
      return;
    }
  }

  setStatus(jobs.length > 1 ? `Uploading ${jobs.length} files. Keep this window open…` : 'Uploading…', false, true);

  // Run a few uploads at a time.
  const queue = [...jobs];
  async function worker() {
    for (let job; (job = queue.shift()); ) {
      if (signedOut) { job.row.set('Skipped', true); failed++; continue; }
      job.row.set('Uploading…', false, true);
      try {
        const url = await uploadWithRetry(job.file, job.kind, folderId);
        if (shouldOpen) {
          // Open in the background: focusing a tab would close this popup
          // and stop the uploads still running.
          const tab = await chrome.tabs.create({ url, active: false });
          openedTabs.push(tab.id);
        }
        job.row.done(url, shouldOpen);
      } catch (e) {
        failed++;
        if (e instanceof SignedOutError) signedOut = true;
        job.row.fail(e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, jobs.length) }, worker));

  finish();
  if (!signedOut) loadStorage(); // usage changed

  const ok = files.length - failed;
  if (folderId && ok > 0) {
    const link = $('folder-link');
    link.hidden = false;
    link.querySelector('button').onclick = () =>
      chrome.tabs.create({ url: `https://drive.google.com/drive/folders/${folderId}` });
  }
  if (signedOut) {
    render(null);
    setStatus('Your session expired. Please sign in again.', true);
  } else if (failed) {
    setStatus(`${ok} of ${files.length} uploaded. ${failed} failed.`, true);
  } else if (shouldOpen) {
    // Everything worked: jump to the first new tab (this closes the popup).
    setStatus(ok > 1 ? `All ${ok} files opened.` : 'Opened.');
    if (openedTabs[0] !== undefined) chrome.tabs.update(openedTabs[0], { active: true });
  } else {
    const where = folderId ? `"${cleanFolderPath(folderInput.value)}"` : 'your Google Drive';
    setStatus(ok > 1 ? `All ${ok} files are in ${where}.` : `Uploaded to ${where}.`);
  }
}

input.addEventListener('change', () => handleFiles(input.files));

['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); })
);
drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

send('status')
  .then(({ email }) => render(email))
  .catch((e) => { render(null); setStatus(e.message, true); });
