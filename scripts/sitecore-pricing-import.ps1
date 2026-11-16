<#
Paste this ENTIRE script into Sitecore PowerShell ISE on DEV and run it.
Default input: upload CSV UTF-8 using an existing SPE-approved upload location.
Paste mode is optional. Results stay inside Sitecore; no automatic downloads.
Dry run is the default. Set $ApplyChanges = $true ONLY to save supplied prices/dates.
No item/version creation, publishing, unlocking, or security/workflow disabling.
#>
& {
    Set-StrictMode -Version 2.0
    $ErrorActionPreference = 'Stop'
    Write-Host '[Pricing 1/5] Script execution started.'

    # CONFIGURATION ------------------------------------------------------------
    $ApplyChanges = $false
    $InputMode = 'Upload'                       # Upload CSV, or Paste Excel/CSV text.
    $ExpectedDevHost = 'xmc-chartwellmaa139-chartwellsxa-dev.sitecorecloud.io'
    $ContentRoot = '/sitecore/content/sxastarter/sxastarter/home'
    $PropertyTemplateId = '{8A4FBFEA-94DC-41CF-B6B8-CECA339490B1}'
    $SuiteTemplateId = '{CB593602-63B9-4ACF-B9C7-3E2A56AEFCC1}'
    $PropertyIdField = 'PropertyID'
    $Languages = @('en', 'fr')
    $CsvDelimiter = ','                         # Change to ';' for semicolon CSV.
    $TimeZoneId = 'Eastern Standard Time'       # Windows equivalent of Toronto.
    $MaxSourceRows = 1000
    $MaxTargets = 5000
    $MaxCatalogItems = 1500
    $MaxRunSeconds = 180                        # Test-sized bounded execution.
    $FieldNames = [ordered]@{
        Regular = 'Regular SuitePrice'
        Promotion = 'Promotion Price'
        Start = 'Start Date'
        End = 'End Date'
    }
    $Headers = [ordered]@{
        PropertyId = 'Web Property ID - Yardi Number'
        Residence = 'Residence'
        Care = 'Marketing Care Level'
        Suite = 'Web SuiteTitle'
        Regular = 'Regular SuitePrice'
        Promotion = 'PromotionPrice'
        Start = 'Start Date'
        End = 'End Date'
    }
    # END CONFIGURATION --------------------------------------------------------

    $reports = New-Object 'System.Collections.Generic.List[object]'
    $targets = New-Object 'System.Collections.Generic.List[object]'
    $fatalMessage = $null
    $uploadBase = $null
    $uploadFolder = $null
    $uploadedPath = $null
    $clock = [Diagnostics.Stopwatch]::new()
    $invariant = [Globalization.CultureInfo]::InvariantCulture

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

    function Remove-PricingUpload([string]$Folder, [string]$FilePath, [string]$AllowedBase) {
        if (-not $Folder) { return }
        try {
            # Only the exact upload and its script-owned direct-child directory.
            # Never recurse, change permissions/attributes, or remove other files.
            $rootPath = [IO.Path]::GetFullPath($AllowedBase).TrimEnd([IO.Path]::DirectorySeparatorChar)
            $folderPath = [IO.Path]::GetFullPath($Folder).TrimEnd([IO.Path]::DirectorySeparatorChar)
            if ([IO.Path]::GetDirectoryName($folderPath) -ine $rootPath -or [IO.Path]::GetFileName($folderPath) -notmatch '^pricing-import-[a-f0-9]{32}$') { throw 'Refusing cleanup outside the script-owned upload directory.' }
            $fileToRemove = $null
            if ($FilePath) {
                $fileToRemove = [IO.Path]::GetFullPath($FilePath)
                if ([IO.Path]::GetDirectoryName($fileToRemove) -ine $folderPath) { throw 'Refusing cleanup of an unexpected uploaded file.' }
            }
            for ($attempt = 1; $attempt -le 3; $attempt++) {
                try {
                    if ($fileToRemove -and [IO.File]::Exists($fileToRemove)) { [IO.File]::Delete($fileToRemove) }
                    if ([IO.Directory]::Exists($folderPath)) { [IO.Directory]::Delete($folderPath, $false) }
                    return
                } catch {
                    $cleanupFailure = $_.Exception.GetBaseException()
                    if ($cleanupFailure -is [IO.IOException] -and $attempt -lt 3) { Start-Sleep -Milliseconds 250; continue }
                    throw
                }
            }
        } catch {
            Write-Warning ("Temporary upload cleanup did not complete. Price results are reported separately. Folder: $Folder. Reason: " + $_.Exception.GetBaseException().Message)
        }
    }
    function Normalize-PricingHeader([string]$Value) {
        return (($Value.Trim() -replace '\s+', ' ').ToLowerInvariant())
    }
    function Get-PricingSuite([string]$Value) {
        switch ($Value.Trim().ToLowerInvariant()) {
            'studios' { return 'studio' }
            '1 bed' { return '1bed' }
            '2 beds' { return '2bed' }
            '2beds' { return '2bed' }
            '2bedroom' { return '2bed' }
            default { return $Value.Trim().ToLowerInvariant() }
        }
    }
    function Get-PricingAmount([string]$Value, [string]$Label) {
        $valueText = $Value.Trim() -replace '^\$\s*', ''
        if (-not $valueText) { return $null }
        if ($valueText -notmatch '^(?:\d+|\d{1,3}(?:,\d{3})+)(\.\d{1,2})?$') {
            throw "$Label must be a positive price with at most two decimals."
        }
        $number = [decimal]::Parse(($valueText -replace ',', ''), $invariant)
        if ($number -le 0 -or $number -gt 1000000) { throw "$Label must be greater than zero and at most 1000000." }
        return $number.ToString('0.##', $invariant)
    }
    function Get-PricingDate([string]$Value, [bool]$EndOfDay) {
        if (-not $Value.Trim()) { return $null }
        $day = [datetime]::MinValue
        if (-not [datetime]::TryParseExact($Value.Trim(), 'yyyy-MM-dd', $invariant, [Globalization.DateTimeStyles]::None, [ref]$day)) {
            throw 'CSV dates must use YYYY-MM-DD. Format date columns in Excel before exporting.'
        }
        if ($day.Year -lt 2000 -or $day.Year -gt 2099) { throw 'Promotion dates must be between 2000 and 2099.' }
        if ($EndOfDay) { $day = $day.Date.AddDays(1).AddSeconds(-1) }
        $day = [datetime]::SpecifyKind($day, [DateTimeKind]::Unspecified)
        if ($pricingZone.IsInvalidTime($day) -or $pricingZone.IsAmbiguousTime($day)) { throw 'The supplied local date is invalid or ambiguous in the configured timezone.' }
        return [TimeZoneInfo]::ConvertTimeToUtc($day, $pricingZone).ToString("yyyyMMdd'T'HHmmss'Z'", $invariant)
    }
    function Read-PricingCsv([string]$Path, [string]$Text, [string]$Delimiter = $CsvDelimiter) {
        Add-Type -AssemblyName Microsoft.VisualBasic
        $textReader = $null
        if ($PSBoundParameters.ContainsKey('Text')) {
            $textReader = [IO.StringReader]::new($Text)
            $parser = [Microsoft.VisualBasic.FileIO.TextFieldParser]::new($textReader)
        } else {
            $parser = [Microsoft.VisualBasic.FileIO.TextFieldParser]::new($Path, [Text.Encoding]::UTF8, $true)
        }
        $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
        $parser.SetDelimiters(@($Delimiter))
        $parser.HasFieldsEnclosedInQuotes = $true
        $parser.TrimWhiteSpace = $false
        $columns = $null
        $sources = New-Object 'System.Collections.Generic.List[object]'
        try {
            while (-not $parser.EndOfData) {
                $line = $parser.LineNumber
                $cells = @($parser.ReadFields())
                if ($null -eq $columns) {
                    if ($line -gt 30) { throw 'Required column headers were not found in the first 30 lines. Include all pricing headers and choose the correct Excel/CSV format.' }
                    $candidate = @{}
                    foreach ($key in $Headers.Keys) {
                        $positions = @(for ($i = 0; $i -lt $cells.Count; $i++) {
                            if ((Normalize-PricingHeader $cells[$i]) -eq (Normalize-PricingHeader $Headers[$key])) { $i }
                        })
                        if ($positions.Count -eq 1) { $candidate[$key] = $positions[0] }
                    }
                    if ($candidate.Count -eq $Headers.Count) { $columns = $candidate }
                    continue
                }
                $raw = @{}
                foreach ($key in $Headers.Keys) {
                    $raw[$key] = if ($columns[$key] -lt $cells.Count) { $cells[$columns[$key]].Trim() } else { '' }
                }
                if (-not (@($raw.Values | Where-Object { $_ }).Count)) { continue }
                if ($sources.Count -ge $MaxSourceRows) { throw "CSV exceeds $MaxSourceRows data rows. Split the file before running." }
                $problems = New-Object 'System.Collections.Generic.List[string]'
                $values = @{}
                $empty = -not ($raw.Regular -or $raw.Promotion -or $raw.Start -or $raw.End)
                if (-not $empty) {
                    if ($raw.PropertyId -notmatch '^\d{1,12}$') { $problems.Add('Missing or invalid Web Property ID.') }
                    if ($raw.Care.ToLowerInvariant() -notin @('il','al','mc','sa','ltc')) { $problems.Add('Missing or unsupported Marketing Care Level.') }
                    $suite = Get-PricingSuite $raw.Suite
                    if ($suite -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') { $problems.Add('Missing or invalid Web SuiteTitle.') }
                    foreach ($key in $FieldNames.Keys) {
                        try {
                            $parsed = if ($key -in @('Start','End')) { Get-PricingDate $raw[$key] ($key -eq 'End') } else { Get-PricingAmount $raw[$key] $Headers[$key] }
                            if ($null -ne $parsed) { $values[$key] = [string]$parsed }
                        } catch { $problems.Add($_.Exception.Message) }
                    }
                }
                $sources.Add([pscustomobject]@{
                    Line = $line; PropertyId = $raw.PropertyId; Residence = $raw.Residence
                    Care = $raw.Care.ToLowerInvariant(); Suite = (Get-PricingSuite $raw.Suite)
                    Values = $values; Problems = $problems; Empty = $empty
                })
            }
        } finally {
            $parser.Close(); $parser.Dispose()
            if ($null -ne $textReader) { $textReader.Dispose() }
        }
        if ($null -eq $columns -or $sources.Count -eq 0) { throw 'No pricing data found. Include the Market Rates and Business Cases column headers and at least one data row.' }
        # Invalidate EVERY nonempty copy of a duplicate key before any writes.
        $groups = @{}
        foreach ($row in $sources) {
            if ($row.Empty) { continue }
            $key = '{0}|{1}|{2}' -f $row.PropertyId, $row.Care, $row.Suite
            if (-not $groups.ContainsKey($key)) { $groups[$key] = New-Object 'System.Collections.Generic.List[object]' }
            $groups[$key].Add($row)
        }
        foreach ($group in $groups.Values) {
            if ($group.Count -gt 1) { foreach ($row in $group) { $row.Problems.Add('Duplicate Property ID / care level / suite in CSV. Correct all duplicate rows.') } }
        }
        return $sources.ToArray()
    }
    function Assert-PricingTime {
        if ($clock.Elapsed.TotalSeconds -ge $MaxRunSeconds) { throw "Execution stopped at the $MaxRunSeconds-second limit. No further targets were processed. Review the results and use a smaller input batch." }
    }
    function Read-PricingValues($Item) {
        $values = @{}
        foreach ($key in $FieldNames.Keys) {
            $field = $Item.Fields[$FieldNames[$key]]
            if ($null -eq $field) { throw "Missing Sitecore field: $($FieldNames[$key]). Verify its internal name or replace the mapping with its field GUID." }
            # Preserve explicit/current/standard values, never copy language fallback.
            $values[$key] = [string]$field.GetValue($true, $true, $false)
        }
        return $values
    }
    function Assert-PricingUnlocked($Item) {
        $field = $Item.Fields['__Lock']
        if ($null -eq $field) { throw 'Lock metadata is unavailable.' }
        $text = [string]$field.GetValue($false, $false, $false)
        if (-not $text.Trim()) { return }
        $settings = [Xml.XmlReaderSettings]::new()
        $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
        $settings.XmlResolver = $null
        $reader = [Xml.XmlReader]::Create([IO.StringReader]::new($text), $settings)
        try {
            $document = [Xml.XmlDocument]::new(); $document.XmlResolver = $null
            $document.Load($reader)
            if ($document.DocumentElement.Name -cne 'r' -or $document.DocumentElement.ChildNodes.Count -gt 0) { throw 'Unexpected lock XML.' }
            $owner = $document.DocumentElement.GetAttribute('owner')
            if ($owner.Trim()) { throw "SuitePlan is locked by $owner. Save/unlock it in Sitecore before importing." }
        } finally { $reader.Dispose() }
    }
    function New-PricingReport($Row, [string]$Language, [string]$ResidencePath) {
        return [pscustomobject][ordered]@{
            SourceLine = $Row.Line; Residence = $Row.Residence; PropertyId = $Row.PropertyId
            CareLevel = $Row.Care; Suite = $Row.Suite; Language = $Language
            ResidencePath = $ResidencePath; ItemPath = ''; ItemId = ''; Version = ''
            Mode = $(if ($ApplyChanges) { 'APPLY' } else { 'DRY RUN' })
            Status = ''; Message = ''; Warnings = ''
            PreviousRegular = ''; ProposedRegular = ''; PreviousPromotion = ''; ProposedPromotion = ''
            PreviousStart = ''; ProposedStart = ''; PreviousEnd = ''; ProposedEnd = ''
        }
    }

    try {
        if (-not (Get-Command Read-Variable -ErrorAction SilentlyContinue)) { throw 'Run this in Sitecore PowerShell ISE, not local Windows PowerShell.' }
        if ($InputMode -notin @('Upload','Paste')) { throw 'Set InputMode to Upload or Paste.' }
        # Read SPE's captured session authority, not the current worker thread.
        $authorityVariable = Get-Variable -Name SitecoreAuthority -ErrorAction SilentlyContinue
        $authorityUri = $null
        if ($null -eq $authorityVariable -or -not [uri]::TryCreate([string]$authorityVariable.Value, [UriKind]::Absolute, [ref]$authorityUri) -or $authorityUri.Scheme -notin @('http','https')) {
            throw 'SPE SitecoreAuthority is unavailable or invalid. Open a new PowerShell ISE session in DEV and run again.'
        }
        $actualHost = $authorityUri.Host
        if ($actualHost -ine $ExpectedDevHost) { throw "DEV-only script. Expected $ExpectedDevHost; detected $actualHost. No content changes were made." }
        $database = [Sitecore.Configuration.Factory]::GetDatabase('master')
        if ($null -eq $database) { throw 'The master authoring database is unavailable.' }
        $pricingZone = [TimeZoneInfo]::FindSystemTimeZoneById($TimeZoneId)
        $propertyId = [Sitecore.Data.ID]::Parse($PropertyTemplateId)
        $suiteId = [Sitecore.Data.ID]::Parse($SuiteTemplateId)
        foreach ($definition in @(@($propertyId,'PropertyPage'), @($suiteId,'SuitePlan'))) {
            $templateItem = $database.GetItem($definition[0])
            if ($null -eq $templateItem -or $templateItem.Name -ine $definition[1] -or -not $templateItem.Paths.FullPath.StartsWith('/sitecore/templates/', [StringComparison]::OrdinalIgnoreCase)) {
                throw "Verify the $($definition[1]) template GUID in the configuration before running."
            }
        }
        $root = $database.GetItem($ContentRoot)
        if ($null -eq $root -or -not $root.Paths.FullPath.StartsWith('/sitecore/content/', [StringComparison]::OrdinalIgnoreCase)) { throw 'The configured content root was not found beneath /sitecore/content/.' }
        if ($InputMode -eq 'Upload') {
            if (-not (Get-Command Receive-File -ErrorAction SilentlyContinue)) { throw 'The SPE file-upload dialog is unavailable.' }
            Write-Host '[Pricing 2/5] DEV verified. Opening CSV upload.'
            $uploadBase = Get-PricingUploadBase
            $uploadFolder = [IO.Path]::Combine($uploadBase, ('pricing-import-' + [guid]::NewGuid().ToString('N')))
            [void][IO.Directory]::CreateDirectory($uploadFolder)
            $received = Receive-File -Path $uploadFolder -Title 'Upload pricing CSV' -Description 'CSV UTF-8. Include the pricing headers; use YYYY-MM-DD dates. Start with 5-10 rows.'
            if (-not $received -or [string]$received -in @('cancelled','canceled','undetermined')) { Write-Host 'Import cancelled.'; return }
            $candidatePath = [IO.Path]::GetFullPath([string]$received)
            $folderPrefix = [IO.Path]::GetFullPath($uploadFolder).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
            if (-not $candidatePath.StartsWith($folderPrefix, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetDirectoryName($candidatePath) -ine [IO.Path]::GetFullPath($uploadFolder)) { throw 'The upload returned an unexpected file path.' }
            $uploadedPath = $candidatePath
            if ([IO.Path]::GetExtension($uploadedPath) -ine '.csv') { throw 'Select a CSV file, not an Excel workbook.' }
            if ([IO.FileInfo]::new($uploadedPath).Length -gt 10MB) { throw 'CSV exceeds 10 MB.' }
            $sources = @(Read-PricingCsv -Path $uploadedPath -Delimiter $CsvDelimiter)
        } else {
            Write-Host '[Pricing 2/5] DEV verified. Opening the paste-data dialog.'
            $pricingPasteFormat = 'Excel'
            $pricingPasteText = ''
            $pasteParameters = @(
                @{ Name = 'pricingPasteFormat'; Title = 'Input format'; Value = 'Excel'; Options = [ordered]@{ 'Cells copied from Excel (tabs)' = 'Excel'; 'CSV text (configured delimiter)' = 'CSV' } },
                @{ Name = 'pricingPasteText'; Title = 'Paste headers and pricing rows here'; Value = ''; Editor = 'multitext'; Lines = 18 }
            )
            $pasteChoice = Read-Variable -Parameters $pasteParameters -Title 'Paste pricing data' -Description 'Copy a rectangular block from Excel, including all required headers. Use YYYY-MM-DD dates. Start with 5-10 data rows.' -Width 850 -Height 620 -OkButtonName 'Process data' -CancelButtonName 'Cancel'
            if ($pasteChoice -ne 'ok') { Write-Host 'Import cancelled.'; return }
            if ([string]::IsNullOrWhiteSpace($pricingPasteText)) { throw 'Paste the column headers and at least one data row.' }
            if ([Text.Encoding]::UTF8.GetByteCount($pricingPasteText) -gt 10MB) { throw 'Pasted data exceeds 10 MB. Use a smaller batch.' }
            if ($pricingPasteFormat -notin @('Excel','CSV')) { throw 'Choose Excel cells or CSV text as the input format.' }
            $pasteDelimiter = if ($pricingPasteFormat -eq 'Excel') { "`t" } else { $CsvDelimiter }
            $sources = @(Read-PricingCsv -Text $pricingPasteText -Delimiter $pasteDelimiter)
            $pricingPasteText = ''
        }
        Write-Host ('[Pricing 3/5] Input parsed: {0} source rows.' -f $sources.Count)
        $clock.Start()
        $wanted = @{}
        foreach ($row in $sources) { if (-not $row.Empty -and $row.Problems.Count -eq 0) { $wanted[$row.PropertyId] = $true } }
        $residences = @{}
        if ($wanted.Count -gt 0) {
            Write-Progress -Activity 'Pricing import' -Status 'Finding residence items' -PercentComplete 0
            $queue = [Collections.Generic.Queue[object]]::new()
            $queue.Enqueue([pscustomobject]@{ Id = $root.ID; Depth = 0 })
            $visited = 0
            while ($queue.Count -gt 0) {
                Assert-PricingTime
                $entry = $queue.Dequeue(); $node = $database.GetItem($entry.Id)
                if ($null -eq $node) { throw 'Content moved during residence discovery. Run again.' }
                $visited++
                if ($visited -gt $MaxCatalogItems) { throw "Discovery exceeds $MaxCatalogItems items. Use a narrower content root." }
                if ($node.TemplateID -eq $propertyId) {
                    $idField = $node.Fields[$PropertyIdField]
                    if ($null -eq $idField) { throw "PropertyPage is missing field $PropertyIdField. Verify the field mapping." }
                    $yardi = ([string]$idField.GetValue($true, $true, $false)).Trim()
                    if ($wanted.ContainsKey($yardi)) {
                        if (-not $residences.ContainsKey($yardi)) { $residences[$yardi] = [Collections.Generic.List[object]]::new() }
                        $residences[$yardi].Add([pscustomobject]@{ Id = $node.ID; Path = $node.Paths.FullPath })
                    }
                } elseif ($entry.Depth -lt 4) {
                    foreach ($child in $node.GetChildren()) {
                        if ($child.Name -ine 'Data') { $queue.Enqueue([pscustomobject]@{ Id = $child.ID; Depth = $entry.Depth + 1 }) }
                    }
                }
            }
        }
        # Expand every source row into independent residence/language targets.
        foreach ($row in $sources) {
            $properties = @(if ($residences.ContainsKey($row.PropertyId)) { $residences[$row.PropertyId].ToArray() })
            if ($row.Empty -or $row.Problems.Count -gt 0 -or $properties.Count -eq 0) { $properties = @($null) }
            foreach ($property in $properties) { foreach ($languageName in $Languages) {
                $targets.Add([pscustomobject]@{ Source = $row; Property = $property; Language = $languageName })
                if ($targets.Count -gt $MaxTargets) { throw "Import exceeds $MaxTargets language targets. Split the CSV. No price updates have started." }
            } }
        }
        Write-Host ('[Pricing 4/5] Mode: {0}. Source rows: {1}. Targets: {2}.' -f $(if ($ApplyChanges) { 'APPLY' } else { 'DRY RUN' }), $sources.Count, $targets.Count)
        $index = 0
        foreach ($target in $targets) {
            Assert-PricingTime
            $index++
            $row = $target.Source
            $report = New-PricingReport $row $target.Language $(if ($target.Property) { $target.Property.Path } else { '' })
            $reports.Add($report)
            Write-Progress -Activity 'Pricing import' -Status ("$index / $($targets.Count): $($row.Residence) $($target.Language)") -PercentComplete ([int](100 * ($index - 1) / [math]::Max(1,$targets.Count)))
            $editing = $false; $commitAttempted = $false; $item = $null
            try {
                if ($row.Empty) { $report.Status = 'Skipped'; $report.Message = 'No price/date inputs.'; continue }
                if ($row.Problems.Count -gt 0) { throw ($row.Problems -join ' ') }
                if ($null -eq $target.Property) { throw "No residence has Web Property ID $($row.PropertyId) under $ContentRoot." }
                $property = $database.GetItem($target.Property.Id)
                if ($null -eq $property -or $property.TemplateID -ne $propertyId -or $property.Paths.FullPath -ine $target.Property.Path -or ([string]$property.Fields[$PropertyIdField].GetValue($true,$true,$false)).Trim() -ne $row.PropertyId) { throw 'Residence changed during discovery. Run again.' }
                $folderPath = $target.Property.Path + '/Data/SuitePlans/' + $row.Care
                $folder = $database.GetItem($folderPath)
                if ($null -eq $folder) { $report.Status = 'Skipped'; $report.Message = 'Missing SuitePlans care-level folder.'; continue }
                $suiteMatches = @($folder.GetChildren() | Where-Object { $_.TemplateID -eq $suiteId -and (Get-PricingSuite $_.Name) -eq $row.Suite })
                if ($suiteMatches.Count -ne 1) {
                    if ($suiteMatches.Count -gt 1) { throw 'More than one equivalent SuitePlan matches this suite.' }
                    $available = @($folder.GetChildren() | Where-Object { $_.TemplateID -eq $suiteId } | ForEach-Object { $_.Name }) -join ', '
                    throw "No SuitePlan matches $($row.Suite) in $folderPath. Available: $available"
                }
                $language = [Sitecore.Globalization.Language]::Parse($target.Language)
                $item = $database.GetItem($suiteMatches[0].ID, $language, [Sitecore.Data.Version]::Latest)
                if ($null -eq $item -or $item.IsFallback -or $item.Language.Name -ne $target.Language -or $item.Version.Number -lt 1 -or $item.Versions.Count -lt 1) { $report.Status = 'Skipped'; $report.Message = 'No existing language version; fallback is not updated.'; continue }
                if ($item.TemplateID -ne $suiteId -or -not $item.Paths.FullPath.StartsWith($folder.Paths.FullPath + '/', [StringComparison]::OrdinalIgnoreCase)) { throw 'SuitePlan is outside the expected folder/template.' }
                $report.ItemId = $item.ID.ToString(); $report.ItemPath = $item.Paths.FullPath; $report.Version = $item.Version.Number
                Assert-PricingUnlocked $item
                if (-not $item.Access.CanWrite()) { throw 'Your Sitecore account cannot write this SuitePlan.' }
                $originalRevision = [string]$item['__Revision']
                if (-not $originalRevision) { throw 'Revision metadata is unavailable.' }
                $before = Read-PricingValues $item; $after = @{}; $changes = @{}
                $warnings = [Collections.Generic.List[string]]::new()
                foreach ($key in $FieldNames.Keys) {
                    $after[$key] = if ($row.Values.ContainsKey($key)) { $row.Values[$key] } else { $before[$key] }
                    $report.PSObject.Properties['Previous' + $key].Value = $before[$key]
                    $report.PSObject.Properties['Proposed' + $key].Value = $after[$key]
                    if ($after[$key] -cne $before[$key]) {
                        $changes[$key] = $after[$key]
                        $definition = $database.GetItem($item.Fields[$FieldNames[$key]].ID)
                        if ($null -eq $definition) { throw 'A pricing field definition could not be read.' }
                        if ($definition['Shared'] -eq '1') { $warnings.Add("$($FieldNames[$key]) is shared: this update applies across languages.") }
                        elseif ($definition['Unversioned'] -eq '1') { $warnings.Add("$($FieldNames[$key]) is unversioned: this update applies to all versions in this language.") }
                    }
                }
                if ($after.Promotion -and (-not $after.Start -or -not $after.End)) { throw 'The resulting promotion requires start and end dates. Blank CSV cells preserve existing dates.' }
                if ($after.Start -and $after.End -and [string]::CompareOrdinal($after.End,$after.Start) -lt 0) { throw 'The resulting promotion ends before it starts.' }
                if ($after.Promotion -and $after.Regular) {
                    $regularNumber = 0.0; $promoNumber = 0.0
                    if ([double]::TryParse($after.Regular, [Globalization.NumberStyles]::Number, $invariant, [ref]$regularNumber) -and [double]::TryParse($after.Promotion, [Globalization.NumberStyles]::Number, $invariant, [ref]$promoNumber) -and $promoNumber -gt $regularNumber) { $warnings.Add('Promotion price exceeds regular price.') }
                }
                $report.Warnings = $warnings -join ' '
                if ($changes.Count -eq 0) { $report.Status = 'Unchanged'; continue }
                if (-not $ApplyChanges) { $report.Status = 'Would update'; continue }
                Assert-PricingTime
                $fresh = $database.GetItem($item.ID, $language, [Sitecore.Data.Version]::Latest)
                if ($null -eq $fresh -or $fresh.IsFallback -or $fresh.Version.Number -ne $item.Version.Number -or $fresh.Paths.FullPath -ine $item.Paths.FullPath -or $fresh['__Revision'] -ne $originalRevision) { throw 'Item/version/revision changed before writing. Run again.' }
                Assert-PricingUnlocked $fresh
                $current = Read-PricingValues $fresh
                foreach ($key in $FieldNames.Keys) { if ($current[$key] -cne $before[$key]) { throw 'A price/date changed before writing. Run again.' } }
                $item = $fresh
                [void]$item.Editing.BeginEdit(); $editing = $true
                foreach ($key in $changes.Keys) { $item.Fields[$FieldNames[$key]].Value = $changes[$key] }
                $commitAttempted = $true
                if (-not $item.Editing.EndEdit()) { throw 'Sitecore did not confirm the save.' }
                $editing = $false
                $verified = $database.GetItem($item.ID, $language, [Sitecore.Data.Version]::Latest)
                if ($null -eq $verified -or $verified.IsFallback -or $verified.Version.Number -ne $report.Version -or $verified.Paths.FullPath -ine $report.ItemPath) { throw 'Saved item/version could not be verified.' }
                $savedValues = Read-PricingValues $verified
                foreach ($key in $FieldNames.Keys) { if ($savedValues[$key] -cne $after[$key]) { throw 'Saved price/date values could not be verified.' } }
                $report.Status = 'Updated'; $report.Message = 'Saved and verified in DEV authoring content.'
            } catch {
                $targetFailure = $_.Exception.Message
                if ($editing -and $null -ne $item) { try { $item.Editing.CancelEdit() } catch {} }
                $report.Status = 'Issue'; $report.Message = $targetFailure
                if ($commitAttempted) {
                    $report.Message += ' A save was attempted; check the item before rerunning.'
                    throw 'Stopped after an unverified save. Review the results before continuing.'
                }
            }
        }
        Write-Progress -Activity 'Pricing import' -Status 'Finished' -PercentComplete 100
    } catch {
        $fatalMessage = $_.Exception.Message
        Write-Warning $fatalMessage
    } finally {
        Write-Progress -Activity 'Pricing import' -Completed
        Remove-PricingUpload -Folder $uploadFolder -FilePath $uploadedPath -AllowedBase $uploadBase
    }
    $processedCount = $reports.Count
    if ($fatalMessage -and $targets.Count -gt $processedCount) {
        for ($unprocessed = $processedCount; $unprocessed -lt $targets.Count; $unprocessed++) {
            $target = $targets[$unprocessed]
            $record = New-PricingReport $target.Source $target.Language $(if ($target.Property) { $target.Property.Path } else { '' })
            $record.Status = 'Not processed'; $record.Message = $fatalMessage
            $reports.Add($record)
        }
    }
    if ($reports.Count -gt 0) {
        foreach ($summary in ($reports | Group-Object Status)) { Write-Host ('{0}: {1}' -f $summary.Name,$summary.Count) }
        if ($fatalMessage -or $processedCount -lt $targets.Count) { Write-Warning ("Processed $processedCount of $($targets.Count) targets. The rest were NOT processed.") }
        Write-Host '[Pricing 5/5] Opening the Sitecore results window.'
        Show-ListView -Data ($reports.ToArray()) -Title 'DEV pricing results' -Property Status,Residence,PropertyId,Suite,Language,PreviousRegular,ProposedRegular,PreviousPromotion,ProposedPromotion,PreviousStart,ProposedStart,PreviousEnd,ProposedEnd,Message,Warnings,ItemPath
        $issues = @($reports | Where-Object { $_.Status -eq 'Issue' -or ($_.Status -ne 'Skipped' -and $_.Warnings) })
        if (-not $fatalMessage -and $issues.Count -eq 0) { Write-Host 'No issues or warnings.' }
    }
    if ($fatalMessage) { throw $fatalMessage }
}
