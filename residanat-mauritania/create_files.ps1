for ($i=1; $i -le 35; $i++) {
    $filePath = "data\training\pc-$i.json"
    if (-not (Test-Path $filePath)) {
        $null > $filePath
    }
}
