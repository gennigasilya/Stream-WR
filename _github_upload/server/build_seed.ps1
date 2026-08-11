$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)

$sheetId = "1WmWYWnrkjyxzAbUoGU9sv7FYonnWlWwswtBufposvXQ"
$listStreamerGid = 1783567342

# Time-slot / day labels are Thai text. Instead of typing them literally in this .ps1 file
# (which previously caused a codepage-misread corruption bug), extract them at runtime from
# js/util.js, the same way build_standalone.ps1 extracts body markup instead of retyping it.
$utilJsPath = "C:\Users\User\Desktop\gen\streamer-manager\js\util.js"
$utilJsText = [System.IO.File]::ReadAllText($utilJsPath, $utf8)
function Extract-Pairs($blockName, $text) {
  if ($text -notmatch "(?s)const $blockName = \[(.*?)\];") { throw "Could not find $blockName in util.js" }
  $block = $Matches[1]
  $pairs = New-Object System.Collections.ArrayList
  foreach ($m in [regex]::Matches($block, '\{\s*key:\s*"(\w+)",\s*label:\s*"([^"]+)"\s*\}')) {
    [void]$pairs.Add([ordered]@{ key = $m.Groups[1].Value; label = $m.Groups[2].Value })
  }
  return $pairs
}
$timeSlotPairs = Extract-Pairs "TIME_SLOTS" $utilJsText
$dayPairs = Extract-Pairs "AVAIL_DAYS" $utilJsText
if ($utilJsText -notmatch 'const EVERY_DAY_LABEL = "([^"]+)";') { throw "Could not find EVERY_DAY_LABEL in util.js" }
$everyDayLabel = $Matches[1]
if ($utilJsText -notmatch 'const NEEDS_CHECK_LABEL = "([^"]+)";') { throw "Could not find NEEDS_CHECK_LABEL in util.js" }
$needsCheckLabel = $Matches[1]
if ($utilJsText -notmatch 'const EMERGENCY_LABEL = "([^"]+)";') { throw "Could not find EMERGENCY_LABEL in util.js" }
$emergencyLabel = $Matches[1]
Write-Output "Time slot labels: $($timeSlotPairs.Count), Day labels: $($dayPairs.Count)"
# Keep this list in sync with SHEET_MONTH_TABS in js/db.js. Tab names are intentionally
# left out here (only gids matter for fetching) to avoid a PowerShell -File script-encoding
# issue where literal Thai text typed directly in a .ps1 file gets misread as the wrong codepage.
$monthTabs = @(
  [ordered]@{ gid = 1290161276 },
  [ordered]@{ gid = 825844125 },
  [ordered]@{ gid = 395929126 },
  [ordered]@{ gid = 132773539 },
  [ordered]@{ gid = 1398685991 },
  [ordered]@{ gid = 2081502206 },
  [ordered]@{ gid = 1965405291 },
  [ordered]@{ gid = 929378145 },
  [ordered]@{ gid = 1192033499 },
  [ordered]@{ gid = 1508262743 }
)
$outPath = "C:\Users\User\Desktop\gen\streamer-manager\data\seed.json"

$games = @(
  [ordered]@{ id = "tosm";  name = "TOSM";        fullName = "Tree of Savior M"; color = "#8b5cf6"; youtubeUrl = "https://www.youtube.com/@TOSMExtreme/streams";        channelId = "UC_29y-RkL_02-1AW4z8juTA" },
  [ordered]@{ id = "zone4"; name = "Zone4";        fullName = "Zone4";            color = "#f59e0b"; youtubeUrl = "https://www.youtube.com/@ElectronicsExtreme/streams"; channelId = "UCgPbj4WVkRhxBpS9DrPl8tw" },
  [ordered]@{ id = "cabal"; name = "Cabal";        fullName = "Cabal";            color = "#10b981"; youtubeUrl = "https://www.youtube.com/@ComboInterActive/streams";   channelId = "UCpN921HQ4Qn1l_EF_YffZjg" },
  [ordered]@{ id = "tr";    name = "TalesRunner";  fullName = "Tales Runner";     color = "#3b82f6"; youtubeUrl = "https://www.youtube.com/@thehof.talesrunner/streams"; channelId = "UCwFU6etOhUn_L-gEoPVH85Q" },
  [ordered]@{ id = "warz";  name = "WarZ";         fullName = "WarZ";             color = "#ec4899"; youtubeUrl = "https://www.youtube.com/@thehof.warzth/streams";       channelId = "UC4HiLYp5Ebk79NTqmaNaeNQ" }
)

function Map-GameId($raw) {
  switch -Regex ($raw.Trim()) {
    '^TOSM$'          { return "tosm" }
    '^Zone4'          { return "zone4" }
    '^Cabal'          { return "cabal" }
    '^TR$'            { return "tr" }
    '^WARZ$'          { return "warz" }
    default           { return $null }
  }
}

function Map-ListStreamerGameId($raw) {
  $t = ($raw.Trim().ToLowerInvariant() -replace '\s+', '')
  switch ($t) {
    "tosm"  { return "tosm" }
    "zone4" { return "zone4" }
    "cabal" { return "cabal" }
    "tr"    { return "tr" }
    "warz"  { return "warz" }
    default {
      if ($t.StartsWith("tales")) { return "tr" }
      return $null
    }
  }
}

$streamerMap = [ordered]@{}
$schedule = New-Object System.Collections.ArrayList
$idCounter = 0

foreach ($tab in $monthTabs) {
  $csvUrl = "https://docs.google.com/spreadsheets/d/$sheetId/export?format=csv&gid=$($tab.gid)"
  $tmpCsv = [System.IO.Path]::GetTempFileName()
  Invoke-WebRequest -Uri $csvUrl -OutFile $tmpCsv -UseBasicParsing
  $rows = Import-Csv -Path $tmpCsv -Header "Date","Time","Game","Program","KOL" | Select-Object -Skip 2
  Remove-Item $tmpCsv -Force

  $currentDate = $null
  foreach ($row in $rows) {
    $dateRaw = ("" + $row.Date).Trim()
    if ($dateRaw -ne "") {
      $parts = $dateRaw -split '/'
      if ($parts.Count -eq 3) {
        $currentDate = "{0}-{1}-{2}" -f $parts[2], $parts[1], $parts[0]
      }
    }
    if (-not $currentDate) { continue }

    $kol = ("" + $row.KOL).Trim()
    if ($kol -eq "") { continue }

    $gameId = Map-GameId ("" + $row.Game)
    if (-not $gameId) { continue }

    if (-not $streamerMap.Contains($kol)) {
      $idCounter++
      $streamerMap[$kol] = [ordered]@{
        id     = "s" + $idCounter
        name   = $kol
        prices = [ordered]@{}
      }
    }
    $streamerEntry = $streamerMap[$kol]
    if (-not $streamerEntry.prices.Contains($gameId)) {
      $streamerEntry.prices[$gameId] = [ordered]@{ normalPrice = 0; discountPrice = $null }
    }

    $timeRaw = ("" + $row.Time).Trim()

    [void]$schedule.Add([ordered]@{
      id         = "e" + ($schedule.Count + 1)
      date       = $currentDate
      time       = $timeRaw
      gameId     = $gameId
      streamerId = $streamerEntry.id
      program    = ("" + $row.Program).Trim()
    })
  }
  Write-Output "gid=$($tab.gid): $($rows.Count) rows read"
}

# Merge normal/discount price + availability from the "List Streamer" tab (one row per
# streamer per game). This is the source of truth for those fields, so it overwrites the
# zero-price placeholders created above; streamers absent from the schedule tabs but present
# here are added too. Availability is unioned across a streamer's rows since it's stored
# per-streamer, not per-game.
$availMap = [ordered]@{}
$csvUrl = "https://docs.google.com/spreadsheets/d/$sheetId/export?format=csv&gid=$listStreamerGid"
$tmpCsv = [System.IO.Path]::GetTempFileName()
Invoke-WebRequest -Uri $csvUrl -OutFile $tmpCsv -UseBasicParsing
$lsRows = Import-Csv -Path $tmpCsv -Header "Name","Game","NormalPrice","DiscountPrice","Slot1","Slot2","Slot3","Days","Col9","Col10","Col11","Col12","Col13","Col14","Col15","Emergency" | Select-Object -Skip 1
Remove-Item $tmpCsv -Force

$lsMatched = 0
$currentLsName = $null
foreach ($row in $lsRows) {
  $nameRaw = ("" + $row.Name).Trim()
  if ($nameRaw -ne "") { $currentLsName = $nameRaw }
  $name = $currentLsName
  if (-not $name) { continue }
  $gameId = Map-ListStreamerGameId ("" + $row.Game)
  if (-not $gameId) { continue }

  if (-not $streamerMap.Contains($name)) {
    $idCounter++
    $streamerMap[$name] = [ordered]@{
      id     = "s" + $idCounter
      name   = $name
      prices = [ordered]@{}
    }
  }
  $entry = $streamerMap[$name]

  $normalRaw = ("" + $row.NormalPrice).Trim()
  $normalPrice = 0
  if ($normalRaw -ne "") { [void][int]::TryParse($normalRaw, [ref]$normalPrice) }
  $discRaw = ("" + $row.DiscountPrice).Trim()
  $discountPrice = $null
  if ($discRaw -ne "") {
    $discVal = 0
    if ([int]::TryParse($discRaw, [ref]$discVal)) { $discountPrice = $discVal }
  }
  $entry.prices[$gameId] = [ordered]@{ normalPrice = $normalPrice; discountPrice = $discountPrice }

  if (-not $availMap.Contains($entry.id)) {
    $availMap[$entry.id] = [ordered]@{ timeSlots = New-Object System.Collections.ArrayList; days = New-Object System.Collections.ArrayList; needsCheck = $false; emergencyAvailable = $false }
  }
  $slotLabels = @($row.Slot1, $row.Slot2, $row.Slot3) | ForEach-Object { ("" + $_).Trim() } | Where-Object { $_ -ne "" }
  foreach ($pair in $timeSlotPairs) {
    if ($slotLabels -contains $pair.label -and -not $availMap[$entry.id].timeSlots.Contains($pair.key)) {
      [void]$availMap[$entry.id].timeSlots.Add($pair.key)
    }
  }
  $daysRaw = ("" + $row.Days).Trim()
  if ($daysRaw -eq $everyDayLabel) {
    foreach ($pair in $dayPairs) {
      if (-not $availMap[$entry.id].days.Contains($pair.key)) { [void]$availMap[$entry.id].days.Add($pair.key) }
    }
  } elseif ($daysRaw -eq $needsCheckLabel) {
    $availMap[$entry.id].needsCheck = $true
  } else {
    $dayLabels = $daysRaw -split '[,/\s]+' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
    foreach ($pair in $dayPairs) {
      if ($dayLabels -contains $pair.label -and -not $availMap[$entry.id].days.Contains($pair.key)) {
        [void]$availMap[$entry.id].days.Add($pair.key)
      }
    }
  }
  if ((("" + $row.Emergency).Trim()) -eq $emergencyLabel) { $availMap[$entry.id].emergencyAvailable = $true }
  $lsMatched++
}
Write-Output "List Streamer tab (gid=$listStreamerGid): $lsMatched / $($lsRows.Count) rows merged"

# Merge promo-text briefs from the "Brief" tab (one column per game, header row = game names).
# Only the text is baked in from the sheet; startDate/endDate stay blank here since Admin sets
# those manually (the sheet has no usable date data as of this writing).
$briefGid = 2087813979
$briefCsvUrl = "https://docs.google.com/spreadsheets/d/$sheetId/export?format=csv&gid=$briefGid"
$tmpCsv = [System.IO.Path]::GetTempFileName()
Invoke-WebRequest -Uri $briefCsvUrl -OutFile $tmpCsv -UseBasicParsing
$briefRows = Import-Csv -Path $tmpCsv
Remove-Item $tmpCsv -Force

$briefColumnToGameId = [ordered]@{ TalesRunner = "tr"; WarZ = "warz"; TOSM = "tosm"; Zone4 = "zone4"; Cabal = "cabal" }
$briefByGameId = @{}
foreach ($col in $briefColumnToGameId.Keys) {
  $gameId = $briefColumnToGameId[$col]
  $blocks = New-Object System.Collections.ArrayList
  foreach ($row in $briefRows) {
    $val = ("" + $row.$col).Trim()
    if ($val -eq "" -or $val -eq "Timeline :") { continue }
    [void]$blocks.Add($val)
  }
  if ($blocks.Count -gt 0) { $briefByGameId[$gameId] = [string]::Join("`n`n", $blocks.ToArray()) }
}
foreach ($g in $games) {
  $text = ""
  if ($briefByGameId.Contains($g.id)) { $text = $briefByGameId[$g.id] }
  $g["brief"] = [ordered]@{ text = $text; startDate = $null; endDate = $null }
}
Write-Output "Brief tab (gid=$briefGid): $($briefByGameId.Keys.Count) games with content"

# Streamer photos bulk-imported from a Google Drive folder tree (a one-off manual import, not
# itself sheet-syncable — see data/photo_map.json). Read from a UTF8 data file at runtime,
# never typed literally in this .ps1, to avoid the Thai-in-.ps1 codepage corruption bug (see
# comments elsewhere in this file). Applying it here means regenerating seed.json never loses
# the photos again. Rendered as lh3.googleusercontent.com (reliable under concurrent load),
# not the drive.google.com/thumbnail endpoint (found to fail intermittently under load).
$photoMapPath = "C:\Users\User\Desktop\gen\streamer-manager\data\photo_map.json"
$photoFileIdByName = @{}
if (Test-Path $photoMapPath) {
  $photoMapJson = [System.IO.File]::ReadAllText($photoMapPath, $utf8) | ConvertFrom-Json
  $photoMapJson.PSObject.Properties | ForEach-Object { $photoFileIdByName[$_.Name] = $_.Value }
}

$streamers = @()
$photoAppliedCount = 0
foreach ($key in $streamerMap.Keys) {
  $s = $streamerMap[$key]
  $priceList = New-Object System.Collections.ArrayList
  foreach ($gid in $s.prices.Keys) {
    [void]$priceList.Add([ordered]@{
      gameId        = $gid
      normalPrice   = $s.prices[$gid].normalPrice
      discountPrice = $s.prices[$gid].discountPrice
    })
  }
  $avail = if ($availMap.Contains($s.id)) {
    [ordered]@{ timeSlots = @($availMap[$s.id].timeSlots); days = @($availMap[$s.id].days); needsCheck = $availMap[$s.id].needsCheck }
  } else {
    [ordered]@{ timeSlots = @(); days = @(); needsCheck = $false }
  }
  $emergencyAvailable = if ($availMap.Contains($s.id)) { $availMap[$s.id].emergencyAvailable } else { $false }
  $photo = $null
  if ($photoFileIdByName.Contains($s.name)) {
    $photo = "https://lh3.googleusercontent.com/d/$($photoFileIdByName[$s.name])=w1000"
    $photoAppliedCount++
  }
  $streamers += [ordered]@{
    id                 = $s.id
    name               = $s.name
    photo              = $photo
    prices             = $priceList
    availability       = $avail
    emergencyAvailable = $emergencyAvailable
  }
}
Write-Output "Photo map: $photoAppliedCount / $($photoFileIdByName.Count) applied"

# Setup Queue log from "ตาราง Set Up" tab (row1 = title "SET UP OBS", row2 = header).
# Columns: Streamer, GAME, วันที่ (set date), เวลา, วันไลฟ์ (live date — staff-filled, "FALSE" or
# blank means not filled in yet), status. Game names and dates are free text as staff typed
# them (not our 5-game enum, not a consistent date format) — kept as raw strings.
$setupGid = 1774117405
$setupCsvUrl = "https://docs.google.com/spreadsheets/d/$sheetId/export?format=csv&gid=$setupGid"
$tmpCsv = [System.IO.Path]::GetTempFileName()
Invoke-WebRequest -Uri $setupCsvUrl -OutFile $tmpCsv -UseBasicParsing
$setupRows = Import-Csv -Path $tmpCsv -Header "Streamer","Game","DateRaw","Time","LiveDateRaw","Status" | Select-Object -Skip 2
Remove-Item $tmpCsv -Force

$setupRecords = New-Object System.Collections.ArrayList
foreach ($row in $setupRows) {
  $name = ("" + $row.Streamer).Trim()
  if ($name -eq "") { continue }
  $liveDateRaw = ("" + $row.LiveDateRaw).Trim()
  if ($liveDateRaw.ToUpperInvariant() -eq "FALSE") { $liveDateRaw = "" }
  [void]$setupRecords.Add([ordered]@{
    streamerName = $name
    game         = ("" + $row.Game).Trim()
    dateRaw      = ("" + $row.DateRaw).Trim()
    time         = ("" + $row.Time).Trim()
    liveDateRaw  = $liveDateRaw
    done         = (("" + $row.Status).Trim().ToLowerInvariant() -eq "done")
  })
}
Write-Output "Setup Queue tab (gid=$setupGid): $($setupRecords.Count) records"

$seed = [ordered]@{
  games        = $games
  streamers    = $streamers
  schedule     = $schedule
  dayStatus    = [ordered]@{}
  setupRecords = $setupRecords
}

$json = $seed | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($outPath, $json, [System.Text.Encoding]::UTF8)

Write-Output "Streamers: $($streamers.Count)"
Write-Output "Schedule entries: $($schedule.Count)"
Write-Output "Written to $outPath"
