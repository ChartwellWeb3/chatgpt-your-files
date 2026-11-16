# Standalone DEV Sitecore pricing script

Open `sitecore-pricing-import.ps1`, copy the entire script into **Sitecore Desktop → Start → Development Tools → PowerShell ISE** in your DEV environment, and click Run. This is a Sitecore-hosted script; do not run it in the PowerShell terminal on your own computer.

Use a new blank ISE tab when replacing an earlier version. SPE executes scripts in a background runspace, where `HttpContext.Current` can be null. The current script uses SPE's captured `SitecoreAuthority` variable for the DEV hostname check and `AppPath`/ASP.NET hosting metadata for relative upload locations. If an older copy reports **A Sitecore browser session is required**, replace it with this version; that message came from the obsolete HTTP-context check and does not mean your Sitecore login is missing. The DEV-only hostname guard still applies. [SPE session variables](https://doc.sitecorepowershell.com/working-with-items/variables)

## First dry-run test

1. In Excel, select the **Market Rates and Business Cases** worksheet. Make a copy containing 5–10 actual pricing rows and the required headers. Recalculate and save the workbook first. The source workbook is not modified by this script.
2. Format nonempty **Start Date** and **End Date** cells as `yyyy-mm-dd`, then export the pricing worksheet as **CSV UTF-8 (Comma delimited)**. Start with a small file containing 5–10 data rows. Headers may appear within the first 30 lines; extra columns are ignored. Set `$CsvDelimiter` to `';'` if the export uses semicolons.
3. Open the script and verify the configuration at the top. The PropertyPage/SuitePlan GUIDs are the references from your screenshots; the script checks that both definitions exist with the expected names. Its default content root is the full home tree. For a Calgary-only test, you may set the root to `/sitecore/content/sxastarter/sxastarter/home/ab/calgary` and use only Calgary rows in the CSV.
4. Leave **`$ApplyChanges = $false`** and **`$InputMode = 'Upload'`**. Run the entire script in a new blank DEV Sitecore PowerShell ISE tab. The **Upload pricing CSV** dialog opens. Choose your CSV, upload it, and complete the dialog. The script uses an existing SPE-approved upload location, not an assumed data-folder path.
5. The results window inside Sitecore shows **Would update**, **Unchanged**, **Skipped**, or **Issue** with previous/proposed prices. No prices are changed in dry-run mode. It also includes promotion dates, issues/warnings and item paths; stored dates are Sitecore UTC strings. Shared/unversioned scopes are identified in warnings. A temporary CSV copy is created in a unique directory under an approved upload location. Cleanup is attempted after parsing/processing. Results stay inside Sitecore; no automatic browser download is requested.

If Chrome's native **Open** dialog freezes while loading Downloads, `$ApplyChanges` cannot affect that local file picker. Close the frozen dialog and retry with a locally available file, or set `$InputMode = 'Paste'` to use the Sitecore text dialog. In Paste mode choose Excel cells for a rectangular block copied from Excel (tabs), or CSV text for raw CSV using the configured delimiter. Include all required headers and use YYYY-MM-DD dates. Paste mode does not create temporary CSV files.

The upload resolver reads `powershell/uploadFile/allowedLocations/path` and resolves the actual SPE folder variables. It does not enable services or broaden the allowed locations. It uses SPE's `AppPath`/hosting metadata, without requiring `HttpContext.Current`. A location named `$SitecoreMediaFolder` is a physical staging folder; no Media Library items are created. The returned file path must remain inside this run's unique upload directory, and inputs are limited to CSV files up to 10 MB.

Temporary cleanup targets only the exact received file and its script-owned directory. It never recursively deletes, removes unrelated files, changes attributes, or grants permissions. Transient IO failures are retried briefly. If cleanup still fails, the warning includes the directory and actual exception reason, separately from the pricing results.

The results window's standard export action remains available if you choose to export; a browser Save dialog may appear then.

An empty input template, `sitecore-pricing-input-template.csv`, contains the required headers if you prefer making a small file manually. Fill it with your actual approved prices; it deliberately contains no invented test prices. Supported care-level values: `il`, `al`, `mc`, `sa`, `ltc`. Use the Web SuiteTitle values from the tracker.

## Save prices after checking the dry run

Set **`$ApplyChanges = $true`**, rerun the script, and upload the same verified CSV (or paste it in Paste mode). Eligible rows are saved automatically without an extra application confirmation. The script still checks templates, paths, item/language versions, permissions, locks, current values and revision before each edit. It uses the current Sitecore session and no external automation credentials.

It changes only regular price, promotion price, start date and end date on existing SuitePlan items. It does not publish, create language versions, unlock content, or disable security/workflow. Normal field saves may invoke your existing Sitecore event handlers; no publishing command is issued by the script. If your instance automatically publishes on save, that configuration still applies.

All residences sharing a Yardi ID inside the root receive independent targets. Existing EN/FR versions are processed separately. Blank price/date cells preserve current values. Missing language versions, missing care-level folders and all-empty updates are neutral skips. Duplicate nonempty CSV keys and duplicate equivalent suite items are blocked. Aliases include studios/studio, 1 bed/1bed and 2 beds/2beds/2bedroom/2bed. Shared fields inherently affect all languages; unversioned fields affect all versions in that language, and these scopes are reported as warnings. Item/field language fallback is not copied into explicit fields.

Prices must be positive, at most 1,000,000, and have at most two decimals. A promotion requires both resulting dates, with end on/after start. Dates use Toronto time, with the end date inclusive through 23:59:59, converted to UTC. CSV cannot retain Excel formula metadata; the script imports the values exported by Excel. Recalculate before exporting and check the CSV prices.

## Execution and recovery

Use one importer against these items at a time. The script has a 180-second execution boundary, 1,000 source-row and 5,000 target limits, and a bounded catalog scan. Start with the small file above. It stops before another target after the time limit; one target already in progress is allowed to finish. It cannot guarantee the duration of Sitecore internals/event handlers. It does not save durable run checkpoints in Supabase. Keep the downloaded reports and split larger jobs into smaller CSVs.

After a normal stop or error, pending targets are labelled **Not processed** in the results. An uncertain save stops further updates and is flagged for review. Reruns re-read current values and leave already-matching targets unchanged. A server/browser interruption can prevent displaying/exporting the results; there is no whole-file transaction or automatic rollback. Previous values in results are a record, not an automatic restoration script.

The script rechecks revision/values immediately before editing but has no atomic compare-and-set with simultaneous human edits. Coordinate edits during a live import. Input is handled only as tabular data and never evaluated as PowerShell. The importer creates no media items and performs no dependency installation, database migration, or security configuration change. CSV upload creates only the temporary copy described above.

## Web-security block diagnostics

A “Sorry, you have been blocked” HTML page is separate from a PowerShell exception, the earlier upload allowlist error, or a Windows Open dialog freeze. The input mode does not establish which security rule blocked earlier script submissions; no rule or request ID has been identified yet. This simplification is not a verified WAF fix and does not hide/encode code or disable protections.

The console emits `[Pricing 1/5] Script execution started`, then DEV/upload-or-paste-dialog, input-parsed, target-processing and results-window stages. If the block occurs before the first message/input window, capture the failed browser request and Ray/request ID and ask the administrator or Sitecore Support to review the blocking rule. Do not keep applying broad permission/elevation changes.

A separate small `sitecore-pricing-input-check.ps1` checks only script execution and SPE's text dialog. Run it alone in a new blank ISE tab, enter `hello`, and note whether both stage messages appear. It does not edit content. Passing this check does not prove the full importer will pass the web-security rule or that pricing writes work.

The earlier `sitecore-pricing-upload-test.ps1` remains a separate upload diagnostic, not a required step for this importer. It does not change the upload allowlist; do not use it to work around a blocked script request.

## Requirements and validation

SPE ISE and a Sitecore account allowed to run scripts/edit target content are required. If elevation is blocked, an environment administrator can configure `SITECORE_SPE_ELEVATION=Confirm` through Sitecore Deploy. Do not enable unrestricted elevation on the hosted environment just for this test.

PowerShell syntax is statically checked. The script has not been executed in your Sitecore environment; no live prices have been changed. Repository tests/builds are not run.

References: [Sitecore SPE and ISE](https://doc.sitecore.com/sai/en/developers/sitecoreai/content-modeling-and-presentation/the-sitecore-powershell-extensions-script-library.html), [SPE elevation](https://doc.sitecore.com/sai/en/developers/sitecoreai/deploying-sitecoreai/deploy-app/manage-an-environment/environment-variables/index.html), [CSV upload](https://doc.sitecorepowershell.com/appendix/common/receive-file), [report download](https://doc.sitecorepowershell.com/appendix/common/out-download), [language fallback APIs](https://doc.sitecore.com/xp/en/developers/102/sitecore-experience-manager/language-fallback---changes-to-apis.html).
