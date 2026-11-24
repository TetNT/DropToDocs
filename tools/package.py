"""Builds the Chrome Web Store upload: dist/DropToDocs-<version>.zip

Run from the repo root:  python tools/package.py

Only the files the extension needs go in. The manifest's "key" field (used to
pin the extension ID during local development) is stripped, as the store
rejects uploads that contain it.
"""
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ['background.js', 'config.js', 'popup.html', 'popup.js']
ICON_SIZES = [16, 32, 48, 128]


def main() -> None:
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    manifest.pop('key', None)

    if 'YOUR_CLIENT_ID' in (ROOT / 'config.js').read_text(encoding='utf-8'):
        sys.exit('config.js still has the placeholder client ID; add the real one first.')

    files = FILES + [f'icons/icon{s}.png' for s in ICON_SIZES]
    files += sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / '_locales').glob('*/messages.json'))
    missing = [f for f in files if not (ROOT / f).is_file()]
    if missing:
        sys.exit(f'Missing files: {", ".join(missing)}')

    out = ROOT / 'dist' / f'{manifest["name"]}-{manifest["version"]}.zip'
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
        for f in files:
            z.write(ROOT / f, f)

    print(f'Wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.1f} KB)')
    for name in ['manifest.json'] + files:
        print('  ', name)


if __name__ == '__main__':
    main()
