$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRuntime = Get-Content -LiteralPath (Join-Path $taskRoot 'runtime\current.json') -Raw | ConvertFrom-Json
$taskRuntimePath = $taskRuntime.runtime
if (-not [System.IO.Path]::IsPathRooted($taskRuntimePath)) { $taskRuntimePath = Join-Path $taskRoot $taskRuntimePath }
$taskRuntimePath = [System.IO.Path]::GetFullPath($taskRuntimePath)
$taskShell = New-Object -ComObject WScript.Shell
$taskPowershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskProfile = Get-Content -LiteralPath (Join-Path $taskRoot 'data\launch-profile.json') -Raw | ConvertFrom-Json
$taskMode = $taskProfile.defaultMode
if ($taskMode -notin @('original','isolated')) { throw 'Unknown profile mode' }
$taskEntries = @(
    @{Name='小爱 Codex（日常）.lnk'; Args=("-LaunchMode " + $taskMode); Description="小爱主题，使用配置中选定的资料"},
    @{Name='Codex（原生外观）.lnk'; Args=("-LaunchMode " + $taskMode + " -Native"); Description="使用选定资料，完全跳过主题加载"},
    @{Name='小爱 Codex（试验）.lnk'; Args='-LaunchMode isolated'; Description='小爱主题，使用项目内独立试验资料'}
)
foreach ($taskEntry in $taskEntries) {
    $taskShortcut = $taskShell.CreateShortcut((Join-Path $taskRoot $taskEntry.Name))
    $taskShortcut.TargetPath = $taskPowershell
    $taskShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'launch-window.ps1') + '" ' + $taskEntry.Args
    $taskShortcut.WorkingDirectory = $taskRoot
    $taskShortcut.Description = $taskEntry.Description
    $taskShortcut.IconLocation = (Join-Path $taskRuntimePath 'ChatGPT.exe') + ',0'
    $taskShortcut.WindowStyle = 7
    $taskShortcut.Save()
    Write-Output (Join-Path $taskRoot $taskEntry.Name)
}
