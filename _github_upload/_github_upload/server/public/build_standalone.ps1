$ErrorActionPreference = "Stop"
$root = "C:\Users\User\Desktop\gen\streamer-manager"
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8($path) {
  return [System.IO.File]::ReadAllText($path, $utf8)
}

$indexHtml = Read-Utf8 "$root\index.html"
$css = Read-Utf8 "$root\css\style.css"
$seed = Read-Utf8 "$root\data\seed.json"
$firebaseInitJs = Read-Utf8 "$root\js\firebase-init.js"
$dbJs = Read-Utf8 "$root\js\db.js"
$utilJs = Read-Utf8 "$root\js\util.js"
$authJs = Read-Utf8 "$root\js\auth.js"
$calendarJs = Read-Utf8 "$root\js\calendar.js"
$liveStreamJs = Read-Utf8 "$root\js\livestream.js"
$setupJs = Read-Utf8 "$root\js\setup.js"
$streamerJs = Read-Utf8 "$root\js\streamer.js"
$summaryJs = Read-Utf8 "$root\js\summary.js"
$adminJs = Read-Utf8 "$root\js\admin.js"
$appJs = Read-Utf8 "$root\js\app.js"

# Extract the <body>...</body> markup (header/nav/main/modal-root/toast-root) verbatim from index.html,
# stripping only the <script src="..."> tags, so no Thai text is ever retyped in this script file.
if ($indexHtml -notmatch "(?s)<body>(.*?)</body>") {
  throw "Could not extract <body> from index.html"
}
$bodyMarkup = $Matches[1]
$bodyMarkup = [regex]::Replace($bodyMarkup, '(?s)<script src="js/[^"]*"></script>\r?\n?', '')

$titleMatch = [regex]::Match($indexHtml, "(?s)<title>(.*?)</title>")
$title = $titleMatch.Groups[1].Value

$oldLoad = @'
  async function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
      repairStreamers();
      save();
      return state;
    }
    try {
      const res = await fetch("data/seed.json");
      state = await res.json();
    } catch (e) {
      state = defaultState();
    }
    repairStreamers();
    save();
    return state;
  }
'@

$newLoad = @'
  async function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
      repairStreamers();
      save();
      return state;
    }
    state = typeof SEED_DATA !== "undefined" ? JSON.parse(JSON.stringify(SEED_DATA)) : defaultState();
    repairStreamers();
    save();
    return state;
  }
'@

if ($dbJs -notlike "*$oldLoad*") {
  throw "load() pattern not found in db.js - aborting to avoid silent breakage"
}
$dbJs = $dbJs.Replace($oldLoad, $newLoad)

$sb = New-Object System.Text.StringBuilder
[void]$sb.Append("<!DOCTYPE html>`n<html lang=`"th`">`n<head>`n<meta charset=`"UTF-8`">`n<meta name=`"viewport`" content=`"width=device-width, initial-scale=1.0`">`n<title>")
[void]$sb.Append($title)
[void]$sb.Append("</title>`n<style>`n")
[void]$sb.Append($css)
[void]$sb.Append("`n</style>`n</head>`n<body>")
[void]$sb.Append($bodyMarkup)
[void]$sb.Append("`n<script>`nconst SEED_DATA = ")
[void]$sb.Append($seed)
[void]$sb.Append(";`n`n")
[void]$sb.Append($utilJs)
[void]$sb.Append("`n`n")
[void]$sb.Append($firebaseInitJs)
[void]$sb.Append("`n`n")
[void]$sb.Append($dbJs)
[void]$sb.Append("`n`n")
[void]$sb.Append($authJs)
[void]$sb.Append("`n`n")
[void]$sb.Append($calendarJs)
[void]$sb.Append("`n`n")
[void]$sb.Append($liveStreamJs)
[void]$sb.Append("`n`n")
[void]$sb.Append($setupJs)
[void]$sb.Append("`n`n")
[void]$sb.Append($streamerJs)
[void]$sb.Append("`n`n")
[void]$sb.Append($summaryJs)
[void]$sb.Append("`n`n")
[void]$sb.Append($adminJs)
[void]$sb.Append("`n`n")
[void]$sb.Append($appJs)
[void]$sb.Append("`n</script>`n</body>`n</html>`n")

$outPath = "C:\Users\User\Desktop\gen\StreamerManager.html"
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), $utf8)
Write-Output "Written: $outPath"
Write-Output ("Size: {0:N0} bytes" -f (Get-Item $outPath).Length)
