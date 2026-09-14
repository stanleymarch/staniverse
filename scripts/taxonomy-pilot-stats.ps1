param(
  [string]$Root = (Join-Path (Split-Path $PSScriptRoot -Parent) 'src/content/publications/telegram'),
  [int]$Target = 30
)

function Get-ArrayField([string]$Text, [string]$Name) {
  $m = [regex]::Match($Text, '(?m)^' + [regex]::Escape($Name) + ':\s*\[(.*?)\]\s*$')
  if (-not $m.Success) { return @() }
  return [regex]::Matches($m.Groups[1].Value, '"((?:\\.|[^"\\])*)"') | ForEach-Object { $_.Groups[1].Value }
}
function Get-Scalar([string]$Text, [string]$Name) {
  $m = [regex]::Match($Text, '(?m)^' + [regex]::Escape($Name) + ':\s*"([^"]*)"\s*$')
  if ($m.Success) { return $m.Groups[1].Value }
  return ''
}

$rows = foreach ($file in Get-ChildItem -LiteralPath $Root -Filter '*.md' -File) {
  $raw = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
  $parts = $raw -split '(?m)^---\s*$', 3
  if ($parts.Count -lt 3) { continue }
  $fm = $parts[1]; $body = $parts[2]
  $id = Get-Scalar $fm 'sourceId'
  if (-not $id) { $id = [regex]::Match($file.BaseName, '(\d+)$').Groups[1].Value }
  $date = Get-Scalar $fm 'date'
  $tags = @(Get-ArrayField $fm 'tags')
  $sourceTags = @(Get-ArrayField $fm 'sourceTags')
  $topics = @(Get-ArrayField $fm 'topics')
  $entities = @(Get-ArrayField $fm 'entities')
  $projectMention = ($body -match "(?i)albina|metavyatka")
  $negative = $false
  [pscustomobject]@{
    id = [int]$id; title = Get-Scalar $fm 'title'; date = $date
    year = if ($date) { ([datetime]$date).Year } else { 0 }
    tags = $tags; sourceTags = $sourceTags; topics = $topics; entities = $entities
    bodyChars = ($body.Trim()).Length; bodyWords = ([regex]::Matches($body, "\S+")).Count
    hasProjectMention = $projectMention
    hasNegative = $negative
    hasMixed = ($topics.Count -ge 3 -or $tags.Count -ge 2)
    path = $file.FullName
    body = $body.Trim()
  }
}
$rows = @($rows | Sort-Object id)

$allTags = @($rows | ForEach-Object { @($_.tags + $_.sourceTags | Sort-Object -Unique) } | Where-Object { $_ })
$allTopics = @($rows | ForEach-Object { $_.topics } | Where-Object { $_ })
$tagFreq = $allTags | Group-Object | Sort-Object Count -Descending | ForEach-Object { [pscustomobject]@{ value=$_.Name; count=$_.Count } }
$topicFreq = $allTopics | Group-Object | Sort-Object Count -Descending | ForEach-Object { [pscustomobject]@{ value=$_.Name; count=$_.Count } }

# Deterministic stratified pilot: fixed IDs reviewed from their full bodies.
$pilotIds = 3,4,5,7,8,11,24,76,91,367,382,414,416,423,425,451,518,593,690,710,743,957,974,979,985,1000,1001,1008,1031,1115
$chosen = @($rows | Where-Object { $pilotIds -contains $_.id } | Sort-Object id)

[pscustomobject]@{
  corpus = [pscustomobject]@{ posts=$rows.Count; years=($rows | Group-Object year | Sort-Object Name | ForEach-Object { [pscustomobject]@{year=[int]$_.Name; count=$_.Count} }); noTags=(@($rows | Where-Object { $_.tags.Count -eq 0 }).Count); noTopics=(@($rows | Where-Object { $_.topics.Count -eq 0 }).Count) }
  tagFrequency = @($tagFreq)
  topicFrequency = @($topicFreq)
  selection = @($chosen | Select-Object id,title,date,year,tags,sourceTags,topics,entities,bodyChars,bodyWords,hasProjectMention,hasNegative,hasMixed,path,body)
} | ConvertTo-Json -Depth 6
