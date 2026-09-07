# Windows PowerShell 5.1 and PowerShell 7+. Never change execution policy.
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]] $CliArguments
)

$ErrorActionPreference = 'Stop'
$isHook = $CliArguments.Count -gt 0 -and $CliArguments[0] -eq 'hook'

function Stop-Launcher([string] $Message) {
    [Console]::Error.WriteLine("auto-thread-title: $Message")
    if ($isHook) { exit 0 }
    exit 1
}

# UTF-8 for diagnostics and native output; event bytes are inherited, not piped
# through PowerShell's string/line conversion (especially important on PS 5.1).
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$cliPath = Join-Path $PSScriptRoot '../src/cli.mjs'
if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
    Stop-Launcher 'Missing src/cli.mjs. Reinstall the complete plugin from its trusted source.'
}

# ProcessStartInfo.ArgumentList is unavailable on Windows PowerShell 5.1.
# Encode each Windows argv element using the native double-quote/backslash rule.
function ConvertTo-NativeArgument([AllowEmptyString()][string] $Value) {
    return '"' + [regex]::Replace(
        [regex]::Replace($Value, '(\\*)"', '$1$1\"'),
        '(\\+)$', '$1$1'
    ) + '"'
}

function Start-NativeProcess([string] $Executable, [string[]] $Arguments, [bool] $CaptureVersion) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Executable
    $startInfo.UseShellExecute = $false
    $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    $startInfo.RedirectStandardOutput = $CaptureVersion
    $startInfo.RedirectStandardError = $CaptureVersion
    $startInfo.RedirectStandardInput = $CaptureVersion
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        [void] $process.Start()
        if ($CaptureVersion) {
            # Detection must never consume the hook's stdin. Drain both output
            # pipes concurrently so a broken override cannot deadlock on stderr.
            $process.StandardInput.Close()
            $stdoutTask = $process.StandardOutput.ReadToEndAsync()
            $stderrTask = $process.StandardError.ReadToEndAsync()
            if (-not $process.WaitForExit(3000)) {
                $process.Kill()
                $process.WaitForExit()
                return $null
            }
            $stdout = $stdoutTask.GetAwaiter().GetResult()
            [void] $stderrTask.GetAwaiter().GetResult()
            if ($process.ExitCode -ne 0) { return $null }
            return $stdout.Trim()
        }
        # With all redirections disabled, the CLI inherits the original native
        # stdin/stdout/stderr handles: JSON bytes and exit code are unmodified.
        $process.WaitForExit()
        $global:LASTEXITCODE = $process.ExitCode
        return $process.ExitCode
    } finally {
        $process.Dispose()
    }
}

function Test-Node([string] $Candidate) {
    if ([string]::IsNullOrWhiteSpace($Candidate) -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { return $false }
    try {
        $version = Start-NativeProcess $Candidate @('-p', 'process.versions.node') $true
        return $null -ne $version -and $version -match '^(\d+)\.' -and [int] $Matches[1] -ge 22
    } catch {
        return $false
    }
}

$nodePath = $null
if (-not [string]::IsNullOrWhiteSpace($env:AUTO_THREAD_TITLE_NODE)) {
    if (-not (Test-Node $env:AUTO_THREAD_TITLE_NODE)) {
        Stop-Launcher 'AUTO_THREAD_TITLE_NODE must name an executable Node.js 22+ binary. Correct or unset the override, then run doctor in the same Codex environment.'
    }
    $nodePath = $env:AUTO_THREAD_TITLE_NODE
} else {
    $candidates = @($env:CODEX_PRIMARY_RUNTIME_NODE)
    $pathNode = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $pathNode) { $candidates += $pathNode.Source }
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates += Join-Path $env:ProgramFiles 'nodejs/node.exe'
    }
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $candidates += Join-Path ${env:ProgramFiles(x86)} 'nodejs/node.exe'
    }
    # These also permit PowerShell 7 verification on macOS/Linux.
    if ([System.IO.Path]::DirectorySeparatorChar -eq '/') {
        $candidates += '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'
    }
    foreach ($candidate in $candidates) {
        if (Test-Node $candidate) { $nodePath = $candidate; break }
    }
}

if ($null -eq $nodePath) {
    Stop-Launcher 'Node.js 22+ was not found. Install a supported Node.js runtime or set AUTO_THREAD_TITLE_NODE to its absolute executable path, restart Codex, then run doctor. Nothing was installed automatically.'
}

try {
    [void] (Start-NativeProcess $nodePath (@($cliPath) + $CliArguments) $false)
    exit $LASTEXITCODE
} catch {
    Stop-Launcher 'Cannot start Node.js. Check AUTO_THREAD_TITLE_NODE and file execution permissions, then run doctor. If enterprise PowerShell policy blocks this launcher, ask your administrator for the approved signing or runtime setup; do not bypass that policy.'
}
