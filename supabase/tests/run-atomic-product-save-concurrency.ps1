param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 55433,
  [string]$Database = "postgres",
  [string]$User = "postgres"
)

$ErrorActionPreference = "Stop"
$sqlFile = (Resolve-Path (Join-Path $PSScriptRoot "atomic-product-save-concurrency.sql")).Path
$tempFiles = @(
  (New-TemporaryFile).FullName,
  (New-TemporaryFile).FullName,
  (New-TemporaryFile).FullName,
  (New-TemporaryFile).FullName,
  (New-TemporaryFile).FullName,
  (New-TemporaryFile).FullName
)

try {
  $lockSql = "begin; select pg_advisory_xact_lock(hashtextextended('33333333-3333-4333-8333-333333333333',0)); select pg_sleep(3); commit;"
  $common = @("-h", $HostName, "-p", "$Port", "-U", $User, "-d", $Database, "-v", "ON_ERROR_STOP=1")
  $lock = Start-Process -FilePath "psql" -ArgumentList ($common + @("-c", ('"' + $lockSql + '"'))) -RedirectStandardOutput $tempFiles[0] -RedirectStandardError $tempFiles[1] -WindowStyle Hidden -PassThru

  Start-Sleep -Milliseconds 700
  $workerA = Start-Process -FilePath "psql" -ArgumentList ($common + @("-v", "suffix=concurrent-a", "-f", $sqlFile)) -RedirectStandardOutput $tempFiles[2] -RedirectStandardError $tempFiles[3] -WindowStyle Hidden -PassThru
  $workerB = Start-Process -FilePath "psql" -ArgumentList ($common + @("-v", "suffix=concurrent-b", "-f", $sqlFile)) -RedirectStandardOutput $tempFiles[4] -RedirectStandardError $tempFiles[5] -WindowStyle Hidden -PassThru

  $lock.WaitForExit()
  $workerA.WaitForExit()
  $workerB.WaitForExit()

  "worker-a exit=$($workerA.ExitCode)"
  Get-Content $tempFiles[2]
  Get-Content $tempFiles[3]
  "worker-b exit=$($workerB.ExitCode)"
  Get-Content $tempFiles[4]
  Get-Content $tempFiles[5]
  "lock-holder exit=$($lock.ExitCode)"
  Get-Content $tempFiles[0]
  Get-Content $tempFiles[1]

  if ($workerA.ExitCode -ne 0 -or $workerB.ExitCode -ne 0 -or $lock.ExitCode -ne 0) {
    throw "Atomic product-save concurrency regression failed."
  }

  $postSql = @"
with product_title as (
  select title from public.product_translations
  where product_id = '33333333-3333-4333-8333-333333333333' and locale = 'en'
), active_assets as (
  select count(*) as total, count(distinct id) as distinct_count
  from public.product_assets
  where product_id = '33333333-3333-4333-8333-333333333333' and is_active
), codes as (
  select count(*) as total, count(distinct id) as distinct_count
  from public.premium_codes
  where product_id = '33333333-3333-4333-8333-333333333333'
)
select case
  when (select title like '%concurrent-a%' or title like '%concurrent-b%' from product_title)
   and (select total = distinct_count from active_assets)
   and (select total = distinct_count from codes)
  then 'PASS concurrent saves leave one coherent child state'
  else 'FAIL concurrent save postcondition'
end;
"@
  $postcondition = & psql @common -Atqc $postSql
  $postcondition
  if ($LASTEXITCODE -ne 0) {
    throw "Atomic product-save concurrency postcondition query failed."
  }
  if ($postcondition -notcontains "PASS concurrent saves leave one coherent child state") {
    throw "Atomic product-save concurrency postcondition failed."
  }
} finally {
  Remove-Item -LiteralPath $tempFiles -Force -ErrorAction SilentlyContinue
}
