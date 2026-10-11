[CmdletBinding()]
param(
    [string[]]$Maps = @('World_L_A', 'World_L_B', 'World_D_A', 'World_D_B', 'Abyss_Reshanta_A', 'Abyss_Reshanta_C', 'Abyss_Reshanta_D'),
    [ValidateRange(1024, 8192)][int]$OutputSize = 2048,
    [switch]$ForceExport
)
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$uex = Join-Path $repositoryRoot 'artifacts\tooling\uex\src\Uex\bin\Release\net10.0\Uex.dll'
$profile = Join-Path $repositoryRoot 'artifacts\tooling\uex\profiles.json'
$structuredRoot = Join-Path $repositoryRoot 'artifacts\AION2_Server_Data\structured-current'
$worldDataRoot = Join-Path $repositoryRoot 'artifacts\AION2_Server_Data\structured-october\AION2\Content\Data\WorldMap'
$destinationRoot = Join-Path $PSScriptRoot 'assets\maps'
Add-Type -AssemblyName System.Drawing
[IO.Directory]::CreateDirectory($destinationRoot) | Out-Null
foreach ($map in $Maps) {
    if ($map -notmatch '^[A-Za-z0-9_]+$') { throw "Invalid map key: $map" }
    $settings = (Get-Content -Raw -LiteralPath (Join-Path $worldDataRoot "$map.json") | ConvertFrom-Json).Properties.Data
    $columns = [int]$settings.SectorSize.X
    $rows = [int]$settings.SectorSize.Y
    $sourceRoot = Join-Path $structuredRoot "AION2\Content\UI\Map\WorldMap\$map\Res"
    $lastTile = Join-Path $sourceRoot ("{0}_{1:D2}_{2:D2}.png" -f $map, ($columns - 1), ($rows - 1))
    if ($ForceExport -or -not (Test-Path -LiteralPath $lastTile)) {
        & dotnet $uex export --profile aion2 --only "AION2/Content/UI/Map/WorldMap/$map/Res" --config $profile
        if ($LASTEXITCODE -ne 0) { throw "Texture export failed for $map." }
    }
    $overview = [Drawing.Bitmap]::new($OutputSize, $OutputSize, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $overviewGraphics = [Drawing.Graphics]::FromImage($overview)
    $overviewGraphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    $overviewGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    try {
        for ($x = 0; $x -lt $columns; $x++) {
            for ($y = 0; $y -lt $rows; $y++) {
                $tile = Join-Path $sourceRoot ("{0}_{1:D2}_{2:D2}.png" -f $map, $x, $y)
                if (-not (Test-Path -LiteralPath $tile)) { throw "Missing native map tile: $tile" }
                $image = [Drawing.Image]::FromFile($tile)
                try {
                    $overviewGraphics.DrawImage($image, [Drawing.Rectangle]::new($x * $OutputSize / $columns, $y * $OutputSize / $rows, $OutputSize / $columns, $OutputSize / $rows))
                    foreach ($size in (@(256, 512, 1024, 2048) | Where-Object { $_ -le $image.Width })) {
                        $levelRoot = Join-Path $PSScriptRoot "assets\tiles\$map\$size"
                        [IO.Directory]::CreateDirectory($levelRoot) | Out-Null
                        $destination = Join-Path $levelRoot "$x`_$y.png"
                        if ($size -eq $image.Width) {
                            if ($image.Width -ne $image.Height) { throw "Unexpected non-square tile: $tile" }
                            Copy-Item -LiteralPath $tile -Destination $destination -Force
                        }
                        else {
                            $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
                            $graphics = [Drawing.Graphics]::FromImage($bitmap)
                            try {
                                $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
                                $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                                $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                                $graphics.DrawImage($image, [Drawing.Rectangle]::new(0, 0, $size, $size))
                                $bitmap.Save($destination, [Drawing.Imaging.ImageFormat]::Png)
                            }
                            finally { $graphics.Dispose(); $bitmap.Dispose() }
                        }
                    }
                }
                finally { $image.Dispose() }
            }
        }
        $overview.Save((Join-Path $destinationRoot "$map.png"), [Drawing.Imaging.ImageFormat]::Png)
    }
    finally { $overviewGraphics.Dispose(); $overview.Dispose() }
    Write-Host "Built $map with streaming detail levels, preserving the original PNG tiles."
}
