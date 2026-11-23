# DropToDocs — browser extension

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/droptodocs/figacbdpfaiopjfiabnmpdbfchjnfndl)

Click the toolbar icon, sign in with Google once, then pick or drop one or more
Word, Excel or PowerPoint files (`.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`).
Each is uploaded to your Google Drive (into a `DropToDocs` folder by default; the
folder name, or `Work/Imports`-style path, can be changed, or files can go to the top
level), converted to a Google Doc, Sheet or Slides presentation, and (if "Open files
after upload" is ticked) opened in a new tab.

Works in Chrome, Edge, Brave and Opera (it uses `chrome.identity.launchWebAuthFlow`,
not the Chrome-only `getAuthToken`).

Free and open source under the [MIT license](LICENSE). If it saves you time, you can
[buy me a coffee](https://buymeacoffee.com/appinbound) ☕

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

## Icon

The icon is drawn by [tools/make_icons.py](tools/make_icons.py) (needs Python with
Pillow). To change colors or shapes, edit the script and run
`python tools/make_icons.py` from the repo root; it rewrites `icons/icon*.png`.
Copy `icons/icon128.png` to `docs/icon.png` afterwards so the website matches.

## Website (homepage + privacy policy)

`docs/` holds the public pages Google and the Chrome Web Store ask for:

- `docs/index.html`: homepage, https://appinbound.com/DropToDocs/
- `docs/privacy.html`: privacy policy, https://appinbound.com/DropToDocs/privacy.html

They're served by GitHub Pages from this repo's `main` branch, `/docs` folder.
The `appinbound.com` domain is set on the
[TetNT.github.io](https://github.com/TetNT/TetNT.github.io) repository; GitHub
serves this project site under it automatically, so don't set a custom domain
here.

## Packaging for the store

```bash
python tools/package.py
```

Writes `dist/DropToDocs-<version>.zip` with only the files the extension needs
(no `docs/`, `tools/`, README or git files, and any `"key"` field removed from
the manifest). Upload that zip in the Chrome Developer Dashboard.
