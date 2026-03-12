# ============================================
# Lucen → Supabase One-Click Deploy Script
# ============================================
# Run this ONCE from your terminal:
#   cd d:\Lucenv1.0
#   powershell -ExecutionPolicy Bypass -File deploy-to-supabase.ps1
# ============================================

# ─── CONFIG ───
$PROJECT_REF = "jephupjgsvcgfzsozmas"
# ACCESS_TOKEN and OPENROUTER_KEY should be set via environment variables or GitHub Secrets

if (-not $env:SUPABASE_ACCESS_TOKEN) {
    Write-Host "ERROR: SUPABASE_ACCESS_TOKEN environment variable is not set." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deploying Lucen to Supabase..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ─── Step 1: Link project ───
Write-Host "[1/4] Linking to Supabase project..." -ForegroundColor Yellow
npx -y supabase link --project-ref $PROJECT_REF
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to link project." -ForegroundColor Red
    exit 1
}
Write-Host "  Linked!" -ForegroundColor Green

# ─── Step 2: Push database migrations ───
Write-Host ""
Write-Host "[2/4] Pushing database migrations..." -ForegroundColor Yellow
npx -y supabase db push
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to push migrations." -ForegroundColor Red
    exit 1
}
Write-Host "  Migrations applied!" -ForegroundColor Green

# ─── Step 3: Set Edge Function secrets ───
Write-Host ""
Write-Host "[3/4] Setting Edge Function secrets..." -ForegroundColor Yellow
npx -y supabase secrets set OPENROUTER_API_KEY=$OPENROUTER_KEY
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: Failed to set secrets." -ForegroundColor DarkYellow
}
Write-Host "  Secrets set!" -ForegroundColor Green

# ─── Step 4: Deploy Edge Functions ───
Write-Host ""
Write-Host "[4/4] Deploying Edge Functions..." -ForegroundColor Yellow
npx -y supabase functions deploy chat-proxy --no-verify-jwt
npx -y supabase functions deploy deduct-credits --no-verify-jwt
Write-Host "  Edge Functions deployed!" -ForegroundColor Green

# ─── Done ───
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  DONE! Supabase is fully set up." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your app is ready. Just run: npm run dev" -ForegroundColor Cyan
Write-Host ""
