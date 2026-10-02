param(
  [string]$RunId = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [int]$TimeoutSeconds = 240,
  [string]$CaseIds = ''
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$contractPath = Join-Path $repo 'docs/validation/v3/acceptance.json'
# PS 5.1 reads BOM-less files as ANSI without an explicit UTF-8 decode (case
# names contain non-ASCII, e.g. obj_1_Körper.stl)
$contract = Get-Content -LiteralPath $contractPath -Raw -Encoding UTF8 | ConvertFrom-Json
$root = Join-Path $repo (Join-Path 'OUTPUT/v3' $RunId)
New-Item -ItemType Directory -Path $root -Force | Out-Null
$engineCommit = (git -C $repo rev-parse HEAD).Trim()
$contractSha256 = (Get-FileHash -LiteralPath $contractPath -Algorithm SHA256).Hash.ToLowerInvariant()
$lockfileSha256 = (Get-FileHash -LiteralPath (Join-Path $repo 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$sourcePaths = @('src/engine', 'src/workers', 'src/state', 'src/ui', 'scripts/generate_mold.ts')
$sourceFiles = foreach ($item in $sourcePaths) {
  $path = Join-Path $repo $item
  if (Test-Path -LiteralPath $path -PathType Container) { Get-ChildItem -LiteralPath $path -File -Recurse }
  else { Get-Item -LiteralPath $path }
}
$sourceManifest = ($sourceFiles | Sort-Object FullName | ForEach-Object {
  ($_.FullName.Substring($repo.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)
}) -join "`n"
$sha = [System.Security.Cryptography.SHA256]::Create()
# PowerShell 5.1 / .NET Framework compatibility: [Convert]::ToHexString is .NET 5+
function ConvertTo-LowerHex([byte[]] $bytes) {
  return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
$sourceTreeSha256 = ConvertTo-LowerHex $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($sourceManifest))
$node = (Get-Command node.exe).Source
$tsx = Join-Path $repo 'node_modules/tsx/dist/cli.mjs'
$summary = @()
$selectedIds = @($CaseIds.Split(',') | Where-Object { $_ -ne '' })

foreach ($case in $contract.requiredSuccessCases) {
  if ($selectedIds.Count -gt 0 -and $case.id -notin $selectedIds) { continue }
  $caseRoot = Join-Path $root $case.id
  $attemptNumber = 1
  while (Test-Path -LiteralPath (Join-Path $caseRoot ('attempt-{0:d3}' -f $attemptNumber))) { $attemptNumber++ }
  $attemptDir = Join-Path $caseRoot ('attempt-{0:d3}' -f $attemptNumber)
  New-Item -ItemType Directory -Path $attemptDir -Force | Out-Null
  $inputPath = Join-Path $contract.inputRoot $case.sourceFile
  $argsList = @($tsx, 'scripts/generate_mold.ts', '--input', $inputPath,
    '--size', [string]$case.sizeMm, '--role', [string]$case.inputRole,
    '--cast', [string]$case.requiredSurfaces, '--method', [string]$case.requestedFamily,
    '--out', $attemptDir)
  if ($case.backingNormalSource) { $argsList += @('--backing-normal', ($case.backingNormalSource -join ',')) }
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $node
  $psi.WorkingDirectory = $repo
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  # .NET Framework compatibility: ArgumentList and Kill(entireProcessTree) are
  # .NET Core+; quote an Arguments string instead (paths contain spaces).
  $psi.Arguments = ($argsList | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $psi
  $started = Get-Date
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
  if ($timedOut) {
    try { $process.Kill() } catch { }
    $process.WaitForExit()
  }
  $elapsedSeconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 2)
  $logPath = Join-Path $attemptDir 'command.log'
  [IO.File]::WriteAllText($logPath, ($stdout.Result + "`n" + $stderr.Result))
  $exitCode = if ($timedOut) { 124 } else { $process.ExitCode }
  $projectPath = Get-ChildItem -LiteralPath $attemptDir -Filter project.json -Recurse -File | Select-Object -First 1 -ExpandProperty FullName
  $project = if ($projectPath) { Get-Content -LiteralPath $projectPath -Raw | ConvertFrom-Json } else { $null }
  $familyMatches = $project -and $project.method.family -eq $case.expectedFamily
  $validFiles = $project -and @(($project.finalFileAudit.PSObject.Properties | Where-Object { $_.Value.verdict -ne 'valid' })).Count -eq 0
  $releasePass = $project -and @(($project.releaseResult.rigid | Where-Object { -not $_.pass })).Count -eq 0
  $status = if ($timedOut) { 'timeout' }
    elseif ($exitCode -ne 0) { 'generation_failed' }
    elseif (-not $familyMatches -or -not $validFiles -or -not $releasePass) { 'basic_contract_failed' }
    else { 'generated_pending_independent_audit' }
  $stlFiles = @(Get-ChildItem -LiteralPath $attemptDir -Filter '*.stl' -File -Recurse | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($attemptDir.Length + 1); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  $record = [ordered]@{
    schemaVersion = 1; runId = $RunId; caseId = $case.id; attempt = $attemptNumber; status = $status
    engineCommit = $engineCommit; sourceTreeSha256 = $sourceTreeSha256
    lockfileSha256 = $lockfileSha256; inputSha256 = (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    profileSha256 = ConvertTo-LowerHex $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($contract.requiredProfile | ConvertTo-Json -Depth 20 -Compress)))
    contractSha256 = $contractSha256; expectedFamily = $case.expectedFamily; actualFamily = if ($project) { $project.method.family } else { $null }
    commands = @([ordered]@{ argv = @($node) + $argsList; exitCode = $exitCode; durationSeconds = $elapsedSeconds; log = 'command.log' })
    checks = @(
      [ordered]@{ name = 'expected_family'; required = $true; pass = [bool]$familyMatches },
      [ordered]@{ name = 'serialized_mesh_validity'; required = $true; pass = [bool]$validFiles },
      [ordered]@{ name = 'rigid_release'; required = $true; pass = [bool]$releasePass }
    )
    artifacts = $stlFiles
    nextAction = if ($status -eq 'generated_pending_independent_audit') { 'Run independent geometry, fidelity, fit and visual audits; this is not a digital_verified result.' } else { 'Inspect command.log and repair the first failed invariant.' }
  }
  $record | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $attemptDir 'attempt.json') -Encoding utf8
  $summary += [ordered]@{ caseId = $case.id; status = $status; exitCode = $exitCode; seconds = $elapsedSeconds; attemptDir = $attemptDir }
  Write-Output "$($case.id): $status ($elapsedSeconds s, exit $exitCode)"
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'summary.json') -Encoding utf8
