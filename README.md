# DropToDocs — browser extension

Click the toolbar icon, sign in with Google once, then pick or drop a
`.doc`/`.docx`. The file is uploaded to your Google Drive, converted to a Google
Doc, and opened in a new tab.

Works in Chrome, Edge, Brave and Opera (it uses `chrome.identity.launchWebAuthFlow`,
not the Chrome-only `getAuthToken`).

## What users see

Install → click icon → **Sign in with Google** → Google's account picker and
"allow access to files this app creates" screen → done. They stay signed in
after that; the extension refreshes access silently in the background.

## Developer setup (once, by you — users never do this)

1. **Load the extension** to get its ID:
   - Open `chrome://extensions`, turn on **Developer mode**.
   - **Load unpacked** → pick this extension's folder (the one with `manifest.json`).
   - Copy the **ID** on the card.

2. **Create the OAuth client** at <https://console.cloud.google.com>:
   - Create (or pick) a project.
   - **APIs & Services → Library** → enable **Google Drive API**.
   - **OAuth consent screen** → External; app name, support email, add yourself
     under **Test users**. Scopes: `openid`, `email`, `.../auth/drive.file`.
   - **Credentials → Create credentials → OAuth client ID** →
     Application type **Web application**.
   - Under **Authorized redirect URIs** add
     `https://<EXTENSION_ID>.chromiumapp.org/` (with the trailing slash).
   - Copy the **Client ID**.

3. Paste it into [config.js](config.js), then reload the extension.

## Keeping the extension ID stable

The redirect URI is tied to the extension ID, so the ID must not change:

- Before publishing, upload the extension to the Chrome Web Store as a draft.
  In the Developer Dashboard → **Package → View public key**, copy the key and
  add it to `manifest.json` as `"key": "..."`. Your unpacked copy then has the
  same ID as the store version, so one redirect URI covers both.
  (Remove `"key"` from the zip you actually upload.)
- If you also publish on the **Microsoft Edge Add-ons** store, that listing gets
  its own ID — add a second redirect URI for it. (Edge users installing from the
  Chrome Web Store use the Chrome ID, so nothing extra is needed for them.)

## Publishing checklist

- OAuth consent screen: switch **Publishing status** from *Testing* to
  *In production*. In Testing mode only listed test users can sign in.
- `drive.file`, `openid` and `email` are non-sensitive scopes, so there's no
  security assessment — Google will just verify your branding: app name, logo,
  homepage, privacy policy URL, and ownership of that domain.
- Chrome Web Store listing needs a privacy policy and the "single purpose" /
  permission justifications (`identity` for sign-in, `storage` for remembering
  the account, Google APIs host access for uploading).
