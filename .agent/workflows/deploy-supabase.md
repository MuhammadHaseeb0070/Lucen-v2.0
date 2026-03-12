---
description: Deploy database migrations and Edge Functions to Supabase
---

# Deploy to Supabase

This workflow pushes your local migrations and Edge Functions to your Supabase project. No manual dashboard changes needed.

> **Note:** We use `npx -y supabase` since the CLI cannot be installed globally via npm on Windows. Each command auto-downloads the CLI binary if needed.

## Prerequisites

1. Log in to Supabase (one-time):
```
npx -y supabase login
```

// turbo
2. Link to your project (one-time — get your project ref from the Supabase dashboard URL):
```
cd d:\Lucenv1.0
npx -y supabase link --project-ref <your-project-ref>
```

## Deploy Database

// turbo
3. Push all migrations to your Supabase database:
```
cd d:\Lucenv1.0
npx -y supabase db push
```

## Deploy Edge Functions

4. Set the OpenRouter API key as a secret (one-time):
```
cd d:\Lucenv1.0
npx -y supabase secrets set OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

// turbo
5. Deploy all Edge Functions:
```
cd d:\Lucenv1.0
npx -y supabase functions deploy chat-proxy --no-verify-jwt
npx -y supabase functions deploy deduct-credits --no-verify-jwt
```

## Verify

// turbo
6. Check that functions are deployed:
```
npx -y supabase functions list
```

## Update .env

7. Copy your Supabase project URL and anon key from the dashboard → Settings → API, then update `.env`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

// turbo
8. Restart the dev server:
```
cd d:\Lucenv1.0
npm run dev
```
