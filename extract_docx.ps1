$ErrorActionPreference = "Stop"
Set-Location "d:\Workspace\BabyMonitor\New"

$docxFile = Get-ChildItem -Filter "*.docx" | Where-Object { $_.Name -like "*AI*" } | Select-Object -First 1
$zipFile = $docxFile.FullName.Replace(".docx", ".zip")
$tempDir = Join-Path $PWD "temp_docx_extract"
$outputFile = Join-Path $PWD "doc_content.txt"

# Copy to zip file
Copy-Item $docxFile.FullName $zipFile

Write-Host "Extracting: $zipFile"
Expand-Archive -Path $zipFile -DestinationPath $tempDir -Force

$xmlPath = Join-Path $tempDir "word\document.xml"
[xml]$xmlDoc = Get-Content $xmlPath -Encoding UTF8

$ns = @{w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
$textNodes = Select-Xml -Xml $xmlDoc -XPath "//w:t" -Namespace $ns

$text = ($textNodes | ForEach-Object { $_.Node.InnerText }) -join ""
$text | Out-File -FilePath $outputFile -Encoding UTF8

Remove-Item -Recurse -Force $tempDir
Remove-Item $zipFile
Write-Host "Extraction complete! Output: $outputFile"
