"""Prepare a local theme copy from the user's own supported Windows installation."""
from pathlib import Path
import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
from stage_runtime import ROOT, Asar, stage


def make_profile(package, app_version, mode, local_data, user_home, codex_home=None, existing=None):
    if mode not in ('isolated', 'original'):
        raise ValueError('Unknown profile mode')
    result = dict(existing or {})
    result.update(schemaVersion=1, defaultMode=mode)
    if mode == 'original':
        family = package['family']
        if not family or any(c in family for c in ('/', chr(92))) or family in ('.', '..'):
            raise ValueError('Invalid installed package family')
        app_data = Path(local_data) / 'Packages' / family / 'LocalCache/Roaming/Codex'
        browser_data = app_data / 'web/Codex'
        codex = Path(codex_home) if codex_home else Path(user_home) / '.codex'
        for folder in (app_data, browser_data, codex):
            if not folder.is_dir():
                raise ValueError('Existing profile directory was not found; no replacement was created: ' + str(folder))
        result['original'] = {
            'authorizedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'authorization': 'User explicitly selected --profile original during setup.',
            'appData': str(app_data.resolve()), 'browserData': str(browser_data.resolve()),
            'codexHome': str(codex.resolve()), 'appVersion': app_version,
            'msixVersion': package['version'], 'installedApp': package['installedApp'],
        }
    return result


def installed_package():
    if os.name != 'nt':
        raise ValueError('Native theme setup is supported on Windows only.')
    powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    script = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-AppxPackage -Name OpenAI.Codex | ForEach-Object { @{version=[string]$_.Version;family=$_.PackageFamilyName;installedApp=(Join-Path $_.InstallLocation 'app')} }) | ConvertTo-Json -Compress"
    result = subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-Command', script], capture_output=True, encoding='utf-8', check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    data = json.loads(result.stdout.lstrip(chr(0xfeff)) or 'null')
    packages = data if isinstance(data, list) else ([data] if data else [])
    if len(packages) != 1:
        raise ValueError('Expected one installed OpenAI.Codex MSIX package. Install and open the official app first.')
    return packages[0], powershell


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix('.json.setup-tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, file)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=['isolated', 'original'], help='Default: existing selection, or isolated for a new clone.')
    parser.add_argument('--check', action='store_true', help='Inspect installation and profile paths without writing or starting anything.')
    args = parser.parse_args()
    package, powershell = installed_package()
    version = json.loads(Asar(Path(package['installedApp'])/'resources/app.asar').read('package.json'))['version']
    adapter_file = ROOT/'adapters'/f'{version}.json'
    if not adapter_file.is_file():
        raise ValueError(f'Codex {version} is not supported by this release. No files were patched.')
    adapter = json.loads(adapter_file.read_text(encoding='utf-8'))
    if adapter['msixVersion'] != package['version']:
        raise ValueError('The installed MSIX version does not match this release. No files were patched.')
    profile_file = ROOT/'data/launch-profile.json'
    existing = json.loads(profile_file.read_text(encoding='utf-8-sig')) if profile_file.exists() else None
    mode = args.profile or (existing or {}).get('defaultMode', 'isolated')
    profile = make_profile(package, version, mode, os.environ['LOCALAPPDATA'], Path.home(), os.environ.get('CODEX_HOME'), existing)
    summary = {'appVersion':version, 'msixVersion':package['version'], 'installedApp':package['installedApp'], 'profileMode':mode, 'checkOnly':args.check}
    print(json.dumps(summary, indent=2), flush=True)
    if args.check:
        return
    if not (ROOT/'dist/build-manifest.json').is_file():
        raise ValueError('Run npm ci and npm run build first.')
    (ROOT/'diagnostics').mkdir(exist_ok=True)
    report = stage(package['installedApp'])
    write_json(ROOT/'diagnostics/installed-app.json', {**package, 'appVersion':version})
    if profile_file.exists() and not (profile_file.parent/'launch-profile.before-setup.json').exists():
        shutil.copy2(profile_file, profile_file.parent/'launch-profile.before-setup.json')
    write_json(profile_file, profile)
    subprocess.run([sys.executable, '-B', str(ROOT/'scripts/verify_stage.py')], cwd=ROOT, check=True)
    subprocess.run([str(powershell), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT/'scripts/create-launchers.ps1')], cwd=ROOT, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    print('Setup complete. No application was launched; use a generated shortcut after closing other instances.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Setup stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
