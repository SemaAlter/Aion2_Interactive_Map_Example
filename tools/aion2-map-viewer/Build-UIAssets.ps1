[CmdletBinding()]
param([switch]$Export)

$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$source = Join-Path $repository 'artifacts\AION2_Server_Data\structured-current\AION2\Content\UI\Resource\Sprite'
$destination = Join-Path $PSScriptRoot 'assets\ui'
if ($Export) {
    $uex = Join-Path $repository 'artifacts\tooling\uex\src\Uex\bin\Release\net10.0\Uex.dll'
    $profile = Join-Path $repository 'artifacts\tooling\uex\profiles.json'
    foreach ($group in @('Common', 'Common_Deco', 'FWindow_WorldMap')) {
        & dotnet $uex export --profile aion2 --only "AION2/Content/UI/Resource/Sprite/$group" --config $profile
        if ($LASTEXITCODE -ne 0) { throw "UI atlas export failed: $group" }
    }
}

# Exact crops of cooked PaperSprite atlas rectangles. No generated artwork.
$sprites = [ordered]@{
    'map' = @('FWindow_WorldMap', 'UT_FWindow_WorldMap_Btn_Map_Sprite')
    'gathering' = @('FWindow_WorldMap', 'UT_FWindow_WorldMap_Gather_Sprite')
    'monster' = @('FWindow_WorldMap', 'UT_FWindow_WorldMap_Monster_Sprite')
    'npc' = @('FWindow_WorldMap', 'UT_FWindow_WorldMap_NPC_Sprite')
    'filters' = @('FWindow_WorldMap', 'UT_FWindow_WorldMap_Btn_Filter_Sprite')
    'position' = @('FWindow_WorldMap', 'UT_FWindow_WorldMap_Btn_MyPos_Sprite')
    'save' = @('FWindow_WorldMap', 'UT_FWindow_Worldmap_Icon_Save_Sprite')
    'marker-bg' = @('FWindow_WorldMap', 'UT_FWindow_WorldMap_Icon_BG_Sprite')
    'button' = @('Common', 'UT_Common_Btn_02_Sprite')
    'checkbox-on' = @('Common', 'UT_Common_Btn_ChkBox_On_Sprite')
    'checkbox-off' = @('Common', 'UT_Common_Btn_ChkBox_Off_Sprite')
    'arrow-down' = @('Common', 'UT_Common_ComboBox_ArrowDown_Sprite')
    'close' = @('Common', 'UT_Common_Icon_Close_Popup_Sprite')
    'home' = @('Common', 'UT_Common_SystemButton_Icon_Home_Sprite')
    'share' = @('Common', 'UT_Common_ItemTooltip_Btn_Share_Sprite')
    'search' = @('Common', 'UT_Common_List_Icon_DetailView_Sprite')
    'zoom-in' = @('Common', 'UT_Common_Icon_View_Max_Sprite')
    'zoom-out' = @('Common', 'UT_Common_Icon_View_Min_Sprite')
    'info' = @('Common', 'UT_Common_Icon_Info_Sprite')
    'elyos' = @('Common', 'UT_Common_ItemTooltip_Light_Sprite')
    'asmodians' = @('Common', 'UT_Common_ItemTooltip_Dark_Sprite')
    'panel-top' = @('Common_Deco', 'UT_Common_Deco_Popup_Top_L_Sprite')
    'panel-bottom' = @('Common_Deco', 'UT_Common_Deco_Popup_Bottom_L_Sprite')
    'divider' = @('Common_Deco', 'UT_Common_Deco_Popup_TitleDeco_Line_Sprite')
    'title' = @('Common_Deco', 'UT_Common_Deco_TitleBullet_Sprite')
}
Add-Type -AssemblyName System.Drawing
[IO.Directory]::CreateDirectory($destination) | Out-Null
$provenance = [ordered]@{ description = 'Original AION2 cooked UI sprites, cropped using PaperSprite atlas metadata.'; sprites = [ordered]@{}; fonts = @() }
foreach ($name in $sprites.Keys) {
    $group, $sprite = $sprites[$name]
    $metadataPath = Join-Path $source "$group\$sprite.json"
    $exports = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
    $metadata = ($exports | Where-Object { $_.Type -eq 'PaperSprite' }).Properties
    if (-not $metadata.BakedSourceTexture) { throw "Missing atlas reference: $sprite" }
    $textureName = $metadata.BakedSourceTexture.ObjectName
    if ($textureName -notmatch "Texture2D'([^:]+):Texture2D_(\d+)'") { throw "Unexpected texture reference: $textureName" }
    $atlasName = $Matches[1]
    $index = [int]$Matches[2]
    $atlasFile = if ($index -eq 0) { "$atlasName.png" } else { "$atlasName.Texture2D_$index.png" }
    $atlas = [Drawing.Bitmap]::new((Join-Path $source "$group\$atlasFile"))
    try {
        $rectangle = [Drawing.Rectangle]::new([int][Math]::Round($metadata.BakedSourceUV.X), [int][Math]::Round($metadata.BakedSourceUV.Y),
            [int][Math]::Round($metadata.BakedSourceDimension.X), [int][Math]::Round($metadata.BakedSourceDimension.Y))
        $crop = $atlas.Clone($rectangle, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try { $crop.Save((Join-Path $destination "$name.png"), [Drawing.Imaging.ImageFormat]::Png) }
        finally { $crop.Dispose() }
        $provenance.sprites[$name] = @{ package = "AION2/Content/UI/Resource/Sprite/$group/$sprite.uasset"; atlas = $atlasFile;
            rectangle = @($rectangle.X, $rectangle.Y, $rectangle.Width, $rectangle.Height) }
    }
    finally { $atlas.Dispose() }
}
foreach ($font in @('Aion2Yoon_EN_B', 'Aion2Atreia_EN_Bold')) {
    $fontFile = Join-Path $repository "artifacts\AION2_Data\UFS\AION2\Content\UI\Font\$font.ufont"
    # These .ufont payloads have the standard TrueType sfnt signature.
    $signature = [IO.File]::ReadAllBytes($fontFile)[0..3]
    if (($signature -join ',') -ne '0,1,0,0') { throw "Not a TrueType payload: $fontFile" }
    Copy-Item -LiteralPath $fontFile -Destination (Join-Path $destination "$font.ttf") -Force
    $provenance.fonts += "AION2/Content/UI/Font/$font.ufont"
}
[IO.File]::WriteAllText((Join-Path $destination 'sources.json'), ($provenance | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Host "Exported $($sprites.Count) original UI sprites and 2 client fonts."
