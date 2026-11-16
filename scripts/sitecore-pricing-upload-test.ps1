# Run in Sitecore PowerShell ISE. Uses existing allowed upload locations.
# Creates and removes only its temporary CSV copy; never edits Sitecore items.
& {
    $ErrorActionPreference = 'Stop'
    function Get-PricingUploadBase {
        # Match SPE's configured allowlist; never widen it or enable a service.
        $configured = @([Sitecore.Configuration.Factory]::GetStringSet('powershell/uploadFile/allowedLocations/path'))
        # SPE runs on a background thread; HttpContext.Current may be absent.
        $appPathVariable = Get-Variable -Name AppPath -ErrorAction SilentlyContinue
        $webRoot = if ($null -ne $appPathVariable -and $appPathVariable.Value) {
            [string]$appPathVariable.Value
        } else {
            [System.Web.Hosting.HostingEnvironment]::ApplicationPhysicalPath
        }
        $resolved = [Collections.Generic.List[object]]::new()
        foreach ($location in $configured) {
            $configuredText = ([string]$location).Trim()
            if (-not $configuredText) { continue }
            $candidate = $configuredText
            if ($candidate.StartsWith('$')) {
                $variableName = $candidate.Substring(1)
                if ($variableName -in @('tempPath','tmpPath')) { $variableName = 'tmpPath' }
                elseif (-not ($variableName.StartsWith('Sitecore', [StringComparison]::OrdinalIgnoreCase) -and $variableName.EndsWith('Folder', [StringComparison]::OrdinalIgnoreCase))) { continue }
                $variable = Get-Variable -Name $variableName -ErrorAction SilentlyContinue
                if ($null -eq $variable -or -not ($variable.Value -is [string]) -or -not $variable.Value) { continue }
                $candidate = $variable.Value
            }
            if (-not [IO.Path]::IsPathRooted($candidate)) {
                if (-not $webRoot) { continue }
                $candidate = [IO.Path]::Combine($webRoot, $candidate)
            }
            $candidate = [IO.Path]::GetFullPath($candidate)
            # Prefer an already configured non-web-root staging directory.
            $priority = if ($configuredText -in @('$SitecoreTempFolder','$tempPath','$tmpPath')) { 0 }
                elseif ($configuredText -in @('$SitecoreDataFolder','$SitecorePackageFolder')) { 1 }
                else { 2 }
            $resolved.Add([pscustomobject]@{ Path = $candidate; Priority = $priority })
        }
        if ($resolved.Count -eq 0) {
            throw 'No supported SPE upload directory is configured. Ask the Sitecore administrator to check powershell/uploadFile/allowedLocations/path. No security settings were changed.'
        }
        return ($resolved | Sort-Object Priority,Path | Select-Object -First 1).Path
    }

    $folder = $null
    try {
        $uploadBase = Get-PricingUploadBase
        Write-Host ('Using an approved upload directory: ' + $uploadBase)
        $folder = [IO.Path]::Combine($uploadBase, 'pricing-upload-test-' + [guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($folder)
        $received = Receive-File -Path $folder -Title 'Test pricing CSV upload'
        if (-not $received -or [string]$received -in @('cancelled','canceled','undetermined')) { Write-Host 'Upload cancelled.'; return }
        $path = [IO.Path]::GetFullPath([string]$received)
        $prefix = [IO.Path]::GetFullPath($folder).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected upload path.' }
        if ([IO.Path]::GetExtension($path) -ine '.csv') { throw 'Select a CSV file.' }
        if ([IO.FileInfo]::new($path).Length -gt 10MB) { throw 'CSV exceeds 10 MB.' }
        Write-Host 'CSV upload succeeded. First 12 lines:'
        Get-Content -LiteralPath $path -Encoding UTF8 -TotalCount 12
        Write-Host 'No Sitecore items or prices were changed.'
    } finally {
        if ($folder -and [IO.Directory]::Exists($folder)) {
            try {
                foreach ($file in [IO.Directory]::GetFiles($folder)) { [IO.File]::Delete($file) }
                [IO.Directory]::Delete($folder, $false)
            } catch { Write-Warning 'Temporary CSV cleanup did not complete.' }
        }
    }
}
