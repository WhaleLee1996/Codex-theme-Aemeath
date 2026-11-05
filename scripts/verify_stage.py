from pathlib import Path
import hashlib
import json
import subprocess
from stage_runtime import Asar, ROOT, within_root
from packaging_integrity import asar_header_digest, integrity_resource, read_fuses

current = json.loads((ROOT/'runtime/current.json').read_text())
runtime = within_root(ROOT / current['runtime'])
stage = json.loads((runtime/'aemeath-stage.json').read_text())
executable = (runtime/'ChatGPT.exe').read_bytes()
assert hashlib.sha256(executable).hexdigest() == stage['stagedExecutableSha256']
assert integrity_resource(executable)['digest'] == asar_header_digest(runtime/'resources/app.asar')
assert read_fuses(runtime) == stage['executableFuses']
archive = Asar(runtime/'resources/app.asar')
build = json.loads((ROOT/'dist/build-manifest.json').read_text())
checked = []
for item in build['files']:
    if item['name'].endswith(('.mjs', '.css')):
        name = 'webview/aemeath-wish/' + item['name']
    elif item['name'] in ('host-main.cjs', 'host-storage.cjs', 'host-backgrounds.cjs'):
        name = '.vite/build/aemeath_wish/' + item['name']
    else:
        continue
    if hashlib.sha256(archive.read(name)).hexdigest() != item['sha256']:
        raise RuntimeError('Staged file differs from current build: '+name)
    checked.append(name)
for name in ['.vite/build/early-bootstrap.js', '.vite/build/preload.js']:
    result = subprocess.run(['node', '--check', '--input-type=commonjs'], input=archive.read(name), capture_output=True, cwd=ROOT)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8'))
html = archive.read('webview/index.html')
assert html.count(b'./aemeath-wish/runtime.mjs') == 1
assert b'Content-Security-Policy' in html
configuration=json.loads(archive.read('.vite/build/aemeath_wish/config.json'))
assert configuration['pathMode'] == 'runtime-relative'
assert (runtime/configuration['workspaceRoot']).resolve() == ROOT
assert (runtime/configuration['runtimeRoot']).resolve() == runtime
assert configuration['themeIds'] == build['themeIds']
for asset in configuration['assets']:
    assert not Path(asset['path']).is_absolute()
    assert (ROOT/asset['path']).resolve().is_relative_to(ROOT)
    assert (ROOT/asset['path']).is_file()
report={'verificationMode':'offline-package-verification','stagedBuildFilesVerified':len(checked),'nativePatchedEntrypointsSyntaxChecked':2,'registeredThemesVerified':configuration['themeIds'],'nativeCspRetained':True,'runtimeEntryCount':1,'workspaceBoundPathsVerified':True,'packagingIntegrityMatchesArchive':True,'runtimeFusesUnchanged':True,'nativeApplicationLaunchedByThisCheck':False,'nativeVisualAcceptance':False}
(ROOT/'diagnostics/runtime-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
