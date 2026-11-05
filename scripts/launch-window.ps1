param(
    [ValidateSet('original','isolated')][string]$LaunchMode = 'original',
    [switch]$Native
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$taskRoot = Split-Path -Parent $PSScriptRoot
try {
    Set-Location -LiteralPath $taskRoot
    $taskNode = (Get-Command node.exe -ErrorAction Stop).Source
    $taskArgs = @((Join-Path $PSScriptRoot 'launch.mjs'), "--$LaunchMode")
    if ($Native) { $taskArgs += '--native' }
    # The shortcut hides this short-lived launcher. The application opens normally.
    $ErrorActionPreference = 'Continue'
    $taskResult = (& $taskNode @taskArgs 2>&1 | Out-String).Trim()
    $taskExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($taskExitCode -ne 0) { throw $taskResult }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '小爱 Codex', 'OK', 'Information') | Out-Null
    exit 1
}
