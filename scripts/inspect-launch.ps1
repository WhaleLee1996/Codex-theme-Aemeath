$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$taskPackages = @(Get-AppxPackage -Name OpenAI.Codex | ForEach-Object {
    @{name=$_.Name; version=[string]$_.Version; installLocation=$_.InstallLocation}
})
$taskProcesses = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | ForEach-Object {
    @{pid=$_.Id; path=$_.Path; hasWindow=($_.MainWindowHandle -ne 0)}
})
@{packages=$taskPackages; processes=$taskProcesses} | ConvertTo-Json -Depth 4 -Compress
