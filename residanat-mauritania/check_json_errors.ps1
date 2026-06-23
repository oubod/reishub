# Script to check all JSON training files for medical and type errors
$trainingPath = "c:\Users\oubod\OneDrive\Desktop\MB - Copy - Copy (2)\objectif-residanat\data\training"
$errors = @()
$warnings = @()

# Common medical terms and their correct spellings
$medicalTerms = @{
    "hématie" = @("hematie", "hémathie")
    "anticorps" = @("anti-corps", "anticorp")
    "antigène" = @("antigene", "antigéne")
    "immunoglobuline" = @("immunoglobulin", "immuno-globuline")
    "transfusion" = @("transfucion", "transfuzion")
    "hémolyse" = @("hemolyse", "hémolyze")
    "thrombose" = @("trombose", "thromboz")
    "inflammation" = @("inflamation", "inflammacion")
    "diagnostic" = @("diagnostique")
    "symptôme" = @("symptome", "symptôme")
    "traitement" = @("traittement", "traitment")
}

Write-Host "Checking all JSON files in $trainingPath..." -ForegroundColor Cyan
Write-Host ""

$jsonFiles = Get-ChildItem -Path $trainingPath -Filter "*.json" | Sort-Object Name

foreach ($file in $jsonFiles) {
    Write-Host "Checking $($file.Name)..." -ForegroundColor Yellow
    
    try {
        # Test JSON validity
        $content = Get-Content $file.FullName -Raw -Encoding UTF8
        $jsonData = $content | ConvertFrom-Json
        
        # Check each quiz item
        $quizIndex = 0
        foreach ($item in $jsonData) {
            if ($item.type -eq "quiz") {
                $quizIndex++
                
                # Check if answer exists in options
                if ($item.opts -notcontains $item.a) {
                    $errors += [PSCustomObject]@{
                        File = $file.Name
                        Quiz = $quizIndex
                        Type = "CRITICAL"
                        Issue = "Answer '$($item.a)' not found in options: $($item.opts -join ', ')"
                        Question = $item.q.Substring(0, [Math]::Min(80, $item.q.Length))
                    }
                }
                
                # Check for common typos in question and answer
                foreach ($term in $medicalTerms.Keys) {
                    foreach ($typo in $medicalTerms[$term]) {
                        if ($item.q -match $typo -or $item.a -match $typo) {
                            $warnings += [PSCustomObject]@{
                                File = $file.Name
                                Quiz = $quizIndex
                                Type = "TYPO"
                                Issue = "Possible typo: '$typo' should be '$term'"
                                Question = $item.q.Substring(0, [Math]::Min(80, $item.q.Length))
                            }
                        }
                    }
                }
                
                # Check for empty fields
                if ([string]::IsNullOrWhiteSpace($item.q)) {
                    $errors += [PSCustomObject]@{
                        File = $file.Name
                        Quiz = $quizIndex
                        Type = "CRITICAL"
                        Issue = "Empty question"
                        Question = ""
                    }
                }
                
                if ([string]::IsNullOrWhiteSpace($item.a)) {
                    $errors += [PSCustomObject]@{
                        File = $file.Name
                        Quiz = $quizIndex
                        Type = "CRITICAL"
                        Issue = "Empty answer"
                        Question = $item.q.Substring(0, [Math]::Min(80, $item.q.Length))
                    }
                }
                
                # Check for duplicate options
                $uniqueOpts = $item.opts | Select-Object -Unique
                if ($uniqueOpts.Count -ne $item.opts.Count) {
                    $warnings += [PSCustomObject]@{
                        File = $file.Name
                        Quiz = $quizIndex
                        Type = "WARNING"
                        Issue = "Duplicate options found"
                        Question = $item.q.Substring(0, [Math]::Min(80, $item.q.Length))
                    }
                }
            }
        }
        
    } catch {
        $errors += [PSCustomObject]@{
            File = $file.Name
            Quiz = "N/A"
            Type = "JSON_ERROR"
            Issue = "Invalid JSON: $($_.Exception.Message)"
            Question = ""
        }
    }
}

Write-Host ""
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host ""

if ($errors.Count -eq 0) {
    Write-Host "✓ No critical errors found!" -ForegroundColor Green
} else {
    Write-Host "✗ Found $($errors.Count) critical error(s):" -ForegroundColor Red
    Write-Host ""
    $errors | Format-Table -AutoSize -Wrap
}

Write-Host ""

if ($warnings.Count -eq 0) {
    Write-Host "✓ No warnings!" -ForegroundColor Green
} else {
    Write-Host "⚠ Found $($warnings.Count) warning(s):" -ForegroundColor Yellow
    Write-Host ""
    $warnings | Format-Table -AutoSize -Wrap
}

Write-Host ""
Write-Host "Scan complete. Checked $($jsonFiles.Count) files." -ForegroundColor Cyan

# Export to file
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$reportPath = "c:\Users\oubod\OneDrive\Desktop\MB - Copy - Copy (2)\objectif-residanat\json_check_report_$timestamp.txt"

$report = @"
JSON FILES CHECK REPORT
Generated: $(Get-Date)
Total files checked: $($jsonFiles.Count)

CRITICAL ERRORS: $($errors.Count)
$(if ($errors.Count -gt 0) { $errors | Format-Table -AutoSize | Out-String } else { "None" })

WARNINGS: $($warnings.Count)
$(if ($warnings.Count -gt 0) { $warnings | Format-Table -AutoSize | Out-String } else { "None" })
"@

$report | Out-File -FilePath $reportPath -Encoding UTF8
Write-Host ""
Write-Host "Report saved to: $reportPath" -ForegroundColor Green
