"""Create a workspace-local copy of the installed app; never patch the source."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import shutil
import struct
import sys
from packaging_integrity import asar_header_digest, packaged_executable, read_fuses

ROOT = Path(__file__).resolve().parent.parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def within_root(path):
    resolved = path.resolve()
    if not resolved.is_relative_to(ROOT) or resolved == ROOT:
        raise ValueError(f"Output is outside the workspace: {resolved}")
    return resolved


def require_closed_runtime(target):
    executable = within_root(target/'ChatGPT.exe')
    if os.name != 'nt' or not executable.exists():
        return
    # Check the local copy before changing either the ASAR or PE resource.
    # Opening for exclusive write checks the image lock without writing bytes.
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW(str(executable), 0x40000000, 0, None, 3, 0x80, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ValueError('Close the theme copy before staging; its executable is in use or cannot be updated. No runtime files were changed.')
    kernel.CloseHandle(handle)


class Asar:
    def __init__(self, path):
        self.path = Path(path)
        with self.path.open('rb') as stream:
            marker, header_size, payload_size, json_size = struct.unpack('<4I', stream.read(16))
            if marker != 4 or json_size > 64 * 1024 * 1024 or payload_size + 4 != header_size:
                raise ValueError('Unsupported ASAR header')
            self.header = json.loads(stream.read(json_size))
            self.body_offset = 8 + header_size

    def entry(self, name, create=False):
        parts = PurePosixPath(name).parts
        if not parts or any(p in ('..', '') for p in parts) or name.startswith('/'):
            raise ValueError('Unsafe archive path')
        node = self.header
        for part in parts[:-1]:
            node = node.setdefault('files', {}).setdefault(part, {'files': {}}) if create else node['files'][part]
        if create:
            return node.setdefault('files', {}).setdefault(parts[-1], {})
        return node['files'][parts[-1]]

    def read(self, name):
        entry = self.entry(name)
        if entry.get('unpacked') or 'offset' not in entry:
            raise ValueError(f'Expected a packed file: {name}')
        with self.path.open('rb') as stream:
            stream.seek(self.body_offset + int(entry['offset']))
            data = stream.read(entry['size'])
            if len(data) != entry['size']:
                raise ValueError('Truncated ASAR file')
            return data

    def rewrite(self, destination, replacements):
        destination = within_root(Path(destination))
        if self.path.resolve() == destination:
            raise ValueError('Source archive must never be overwritten')
        body_size = self.path.stat().st_size - self.body_offset
        cursor = body_size
        for name, data in replacements.items():
            entry = self.entry(name, True)
            entry.clear()
            block_size = 4 * 1024 * 1024
            entry.update(size=len(data), offset=str(cursor), integrity={'algorithm':'SHA256', 'hash':digest(data), 'blockSize':block_size, 'blocks':[digest(data[i:i+block_size]) for i in range(0, len(data), block_size)]})
            cursor += len(data)
        raw = json.dumps(self.header, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        padding = (-len(raw)) % 4
        header = struct.pack('<4I', 4, len(raw) + padding + 8, len(raw) + padding + 4, len(raw)) + raw + bytes(padding)
        temporary = destination.with_suffix('.asar.staging')
        with temporary.open('wb') as output, self.path.open('rb') as source:
            output.write(header)
            source.seek(self.body_offset)
            shutil.copyfileobj(source, output, 4 * 1024 * 1024)
            for data in replacements.values():
                output.write(data)
        os.replace(temporary, destination)


def stage(app_path):
    app = Path(app_path).resolve()
    source = Asar(app / 'resources/app.asar')
    package = json.loads(source.read('package.json'))
    version = package['version']
    adapter_file = ROOT / 'adapters' / f'{version}.json'
    if not adapter_file.is_file():
        raise ValueError(f'No adapter for Codex {version}; no files were patched.')
    adapter = json.loads(adapter_file.read_text(encoding='utf-8'))
    for name, expected in adapter['sourceFiles'].items():
        if digest(source.read(name)) != expected:
            raise ValueError(f'Installed source changed: {name}. Adaptation is required.')
    for name, expected in adapter['runtimeBinaries'].items():
        if digest((app/name).read_bytes()) != expected:
            raise ValueError(f'Installed runtime binary changed: {name}. Adaptation is required.')
    build = ROOT / 'dist'
    build_manifest = json.loads((build / 'build-manifest.json').read_text())
    if build_manifest.get('appVersion') != version or build_manifest.get('adapterVersion') != adapter['adapterVersion']:
        raise ValueError('Theme build targets a different adapter; rebuild for the installed Codex version.')
    for item in build_manifest['files']:
        if digest((build/item['name']).read_bytes()) != item['sha256']:
            raise ValueError(f'Build file changed: {item["name"]}; run npm run build.')
    fuse_report = read_fuses(app)
    # Prepare a new theme beside the running one. The active app is never
    # patched in place; the launcher selects this copy only on its next start.
    runtime_name = version + '-theme-' + build_manifest['themeVersion']
    if any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-' for c in runtime_name):
        raise ValueError('Unsafe runtime version')
    target = within_root(ROOT / 'runtime' / runtime_name)
    require_closed_runtime(target)
    source_stat = (app/'resources/app.asar').stat()
    if not target.exists():
        print(f'Copying the installed runtime into {target}', flush=True)
        staging = within_root(ROOT / 'runtime' / (runtime_name + '.staging'))
        if staging.exists():
            raise ValueError(f'An unfinished runtime copy already exists: {staging}; inspect it before retrying.')
        staging.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(app, staging, copy_function=shutil.copyfile)
        os.replace(staging, target)
    elif not (target/'aemeath-stage.json').is_file():
        raise ValueError('Refusing to change an unrecognized runtime directory')
    assets = [{'id':'builtin-aemeath','name':'小爱','role':'companion','path':'assets/aemeath.webp'}]
    configuration = {'pathMode':'runtime-relative','workspaceRoot':'../..','runtimeRoot':'.','themeVersion':build_manifest['themeVersion'],'themeIds':build_manifest['themeIds'],'adapterVersion':adapter['adapterVersion'],'assets':assets}
    replacements = {}
    for name in ['host-storage.cjs','host-main.cjs','host-backgrounds.cjs']:
        replacements['.vite/build/aemeath_wish/'+name] = (build/name).read_bytes()
    replacements['.vite/build/aemeath_wish/config.json'] = json.dumps(configuration, ensure_ascii=False).encode()
    bootstrap = b'try { require("./aemeath_wish/host-main.cjs").install(require("electron"), require("./aemeath_wish/config.json")); } catch (e) { console.warn("[Aemeath Wish] Host unavailable:", e.message); }\n'
    replacements['.vite/build/early-bootstrap.js'] = bootstrap + source.read('.vite/build/early-bootstrap.js')
    replacements['.vite/build/preload.js'] = source.read('.vite/build/preload.js') + b'\n' + (build/'preload-extension.cjs').read_bytes()
    html = source.read('webview/index.html')
    if html.count(b'</body>') != 1:
        raise ValueError('Unexpected native HTML shape')
    replacements['webview/index.html'] = html.replace(b'</body>', b'<script type="module" src="./aemeath-wish/runtime.mjs"></script>\n</body>')
    for item in build_manifest['files']:
        if item['name'].endswith(('.mjs', '.css')):
            replacements['webview/aemeath-wish/'+item['name']] = (build/item['name']).read_bytes()
    print('Adding the theme to the local copy only.', flush=True)
    source.rewrite(target/'resources/app.asar', replacements)
    verify = Asar(target/'resources/app.asar')
    for name, expected in replacements.items():
        if verify.read(name) != expected:
            raise ValueError(f'Patched archive check failed: {name}')
    for name, expected in adapter['sourceFiles'].items():
        if name not in replacements and digest(verify.read(name)) != expected:
            raise ValueError(f'Untouched bundle check failed: {name}')
    after_stat = (app/'resources/app.asar').stat()
    if (source_stat.st_size, source_stat.st_mtime_ns) != (after_stat.st_size, after_stat.st_mtime_ns):
        raise ValueError('Installed source changed during staging; recheck the current installation.')
    for name, expected in adapter['sourceFiles'].items():
        if digest(Asar(app/'resources/app.asar').read(name)) != expected:
            raise ValueError('Installed source changed during staging')
    original_executable = (app/'ChatGPT.exe').read_bytes()
    packaged, integrity_report = packaged_executable(original_executable, asar_header_digest(app/'resources/app.asar'), asar_header_digest(target/'resources/app.asar'))
    temporary_executable = within_root(target/'ChatGPT.exe.staging')
    temporary_executable.write_bytes(packaged)
    os.replace(temporary_executable, target/'ChatGPT.exe')
    if (target/'ChatGPT.exe').read_bytes() != packaged or read_fuses(target) != fuse_report:
        raise ValueError('Local packaging metadata or unchanged runtime fuses failed verification')
    for name, expected in adapter['runtimeBinaries'].items():
        if digest((app/name).read_bytes()) != expected:
            raise ValueError('Installed runtime binary changed during staging')
        if name != 'ChatGPT.exe' and digest((target/name).read_bytes()) != expected:
            raise ValueError('An untouched local runtime binary differs from its source')
    report = {'themeVersion':build_manifest['themeVersion'],'appVersion':version,'adapterVersion':adapter['adapterVersion'],'buildManifestSha256':digest((build/'build-manifest.json').read_bytes()),'sourceApp':str(app),'runtime':str(target),'sourceFilesUnchanged':True,'archiveReplacementsVerified':len(replacements),'nativeUiVerified':False,'executableFuses':fuse_report,'packagingIntegrity':integrity_report,'stagedExecutableSha256':digest(packaged)}
    (target/'aemeath-stage.json').write_text(json.dumps(report,indent=2)+'\n')
    current_staging = within_root(ROOT/'runtime/current.json.staging')
    current_staging.write_text(json.dumps({'runtime':str(target.relative_to(ROOT)).replace('\\','/'),'version':version},indent=2)+'\n')
    os.replace(current_staging, ROOT/'runtime/current.json')
    (ROOT/'diagnostics/staging-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report, indent=2), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--app-path', type=Path)
    args = parser.parse_args()
    if args.app_path is None:
        metadata = json.loads((ROOT/'diagnostics/installed-app.json').read_text())
        args.app_path = Path(metadata['installedApp'])
    try:
        stage(args.app_path)
    except Exception as error:
        print(f'Staging stopped: {error}', file=sys.stderr)
        sys.exit(1)
