$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
Write-Host 'Create a NEW private NTS-MGR password (at least 16 characters). Do not use the exposed legacy password.'
$first = Read-Host 'New manager password' -AsSecureString
$second = Read-Host 'Confirm new manager password' -AsSecureString
$firstPtr = [IntPtr]::Zero
$secondPtr = [IntPtr]::Zero
try {
    $firstPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
    $secondPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
    $privateValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPtr)
    if ($privateValue -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPtr)) { throw 'Password confirmation does not match.' }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = (Get-Command node).Source
    $startInfo.Arguments = 'scripts/configure-manager-local.cjs'
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.WorkingDirectory = (Get-Location).Path
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $process.StandardInput.WriteLine((@{password=$privateValue} | ConvertTo-Json -Compress))
    $process.StandardInput.Close()
    $privateValue = $null
    $process.WaitForExit()
    Write-Host ('Setup exit status: ' + $process.ExitCode)
} catch {
    $safeReason = if ($_.Exception.Message -eq 'Password confirmation does not match.') { 'Password confirmation does not match.' } else { 'Secure terminal setup failed before completion.' }
    @{credentialConfigured=$false;authenticationReady=$false;failure=$safeReason} | ConvertTo-Json | Set-Content -LiteralPath 'security-audit/manager-local-activation-result.json'
    Write-Host $safeReason
}
finally {
    if ($firstPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPtr) }
    if ($secondPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPtr) }
    $first.Dispose(); $second.Dispose(); $privateValue = $null
}
Read-Host 'Press Enter to close this terminal'
