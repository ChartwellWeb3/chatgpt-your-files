# Read-only SPE diagnostic. No files, content edits, credentials or publishing.
Write-Host '[Input check 1/2] The script reached PowerShell.'
$pricingInputProbe = ''
$pricingProbeParameters = @{
    Name = 'pricingInputProbe'
    Value = ''
    Title = 'Type hello'
    Lines = 3
}
$pricingProbeResult = Read-Variable -Parameters $pricingProbeParameters -Title 'Pricing input check'
if ($pricingProbeResult -eq 'ok') {
    Write-Host '[Input check 2/2] The text dialog completed.'
} else {
    Write-Host 'Input check cancelled.'
}