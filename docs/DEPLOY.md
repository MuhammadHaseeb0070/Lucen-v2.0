# Deploying Lucen -- Complete Guide

This guide takes you from zero to a fully deployed Lucen app with automatic deployments.
Once set up, every time you push code to GitHub, the frontend redeploys on Vercel and the
backend (database + edge functions) redeploys on Supabase -- automatically.

---

## How the pieces fit together

```
You (write code)
  |
  v
GitHub Repository  (stores your code)
  |                \
  |                 \
  v                  v
Vercel              GitHub Actions
(builds & hosts     (runs a workflow that
 the frontend)       deploys Supabase)
                        |
                        v
                    Supabase
                    (database, auth,
                     edge functions)
```

| Piece | What it does | Why you need it |
|-------|-------------|-----------------|
| **GitHub** | Hosts your code in a repository | Central place for code; triggers auto-deploys |
| **Supabase** | Provides the database, user authentication, and serverless "Edge Functions" that run your backend logic | Your app needs a database and a secure place to call the AI API |
| **Vercel** | Builds your React app and serves it on a fast global CDN | Users visit your Vercel URL to use the app |
| **OpenRouter** | AI API gateway that routes requests to models like DeepSeek, GPT, Claude | Powers the chat responses |

### Where secrets live (and why)

Secrets are values like API keys and passwords. They must **never** be in your code.

| Secret | Where it's stored | Who uses it |
|--------|--------------------|-------------|
| `VITE_SUPABASE_URL` | Vercel env vars | Frontend (built into the JS bundle -- this is safe because the anon key + Row Level Security protect data) |
| `VITE_SUPABASE_ANON_KEY` | Vercel env vars | Frontend (same as above -- this is a *public* key by design) |
| `VITE_APP_NAME` | Vercel env vars | Frontend (just the app name shown in the UI) |
| `VITE_ADMIN_EMAILS` | Vercel env vars | Frontend (comma-separated emails that see the admin dashboard) |
| `OPENROUTER_API_KEY` | Supabase secrets (set by GitHub Actions) | Edge Functions only -- never reaches the browser |
| `VITE_APP_URL` | Supabase secrets (set by GitHub Actions) | Edge Functions use it for CORS (which domains are allowed to call the API) |
| `SUPABASE_ACCESS_TOKEN` | GitHub Secrets | GitHub Actions uses it to authenticate with the Supabase CLI |
| `SUPABASE_PROJECT_ID` | GitHub Secrets | GitHub Actions uses it to know *which* Supabase project to deploy to |
| `SUPABASE_DB_PASSWORD` | GitHub Secrets | GitHub Actions uses it to link to your project and push migrations |

---

## Prerequisites

You need free accounts on four services. Here is what each one is:

1. **GitHub** (https://github.com) -- where developers store and share code. You'll create a
   "repository" (like a folder on the internet) for your Lucen code.

2. **Supabase** (https://supabase.com) -- an open-source backend. It gives you a PostgreSQL
   database (stores your conversations, users, credits), user authentication (sign-up/login),
   and Edge Functions (small server programs that run your backend logic).

3. **Vercel** (https://vercel.com) -- a hosting platform for frontend apps. It takes your React
   code, builds it into static files, and puts them on fast servers worldwide.

4. **OpenRouter** (https://openrouter.ai) -- an AI API gateway. Instead of signing up with each
   AI company separately, OpenRouter lets you use many models through one API key.

You also need **Node.js 20+** installed on your computer (https://nodejs.org).

---

## Step 1: Create a GitHub repository

A repository ("repo") is like a project folder that Git tracks. Pushing code to it
triggers automatic deployments.

1. Go to https://github.com/new
2. Name it whatever you like (e.g. `lucen`)
3. Set it to **Private** (your code stays private)
4. Do **not** add a README or .gitignore (we already have them)
5. Click **Create repository**

Now push your local code to it. Open a terminal in your project folder and run:

```bash
git remote add origin https://github.com/YOUR_USERNAME/lucen.git
git branch -M main
git add -A
git commit -m "Initial commit"
git push -u origin main
```

**What just happened:** Your code is now on GitHub. Every future `git push` to the
`main` branch will trigger deployments.

---

## Step 2: Create a Supabase project

Supabase is your entire backend -- database, authentication, and server functions.

1. Go to https://supabase.com and sign in
2. Click **New Project**
3. Choose your organization (or create one)
4. Fill in:
   - **Name**: `lucen` (or whatever you want)
   - **Database Password**: generate a strong one and **save it somewhere safe** -- you'll
     need this later as `SUPABASE_DB_PASSWORD`
   - **Region**: pick the one closest to your users
5. Click **Create new project** and wait ~2 minutes for it to provision

### Get your keys

After the project is ready:

1. Go to **Settings** (gear icon) -> **API**
2. Copy these two values (you'll need them later):
   - **Project URL** -- looks like `https://abcdefgh.supabase.co`
     (this becomes `VITE_SUPABASE_URL`)
   - **anon / public key** -- a long string starting with `eyJ...`
     (this becomes `VITE_SUPABASE_ANON_KEY`)
3. Also note your **Project Reference ID** -- it's the `abcdefgh` part of the URL
   (this becomes `SUPABASE_PROJECT_ID`)

### Get your access token

The access token lets the Supabase CLI (and GitHub Actions) manage your project.

1. Go to https://supabase.com/dashboard/account/tokens
2. Click **Generate new token**, give it a name like `lucen-deploy`
3. Copy the token and save it (this becomes `SUPABASE_ACCESS_TOKEN`)

---

## Step 3: Configure Supabase Auth

Authentication needs to know which URLs are allowed to redirect users after login/signup.

1. In the Supabase dashboard, go to **Authentication** -> **URL Configuration**
2. Set **Site URL** to your Vercel URL (you'll get this in Step 5 -- come back and set it after)
3. Under **Redirect URLs**, add:
   - `https://your-app.vercel.app/**` (your production URL -- fill in after Step 5)
   - `http://localhost:5173/**` (for local development)

**Why:** When a user clicks "confirm email" or "reset password", Supabase needs to know
which URLs are safe to redirect them back to. Without this, auth flows will break.

---

## Step 4: Get an OpenRouter API key

OpenRouter is the AI service your app calls. The API key stays **server-side only** (in
Supabase Edge Functions). It never reaches the browser.

1. Go to https://openrouter.ai and sign in
2. Go to **Keys** (https://openrouter.ai/keys)
3. Click **Create Key**, name it `lucen-production`
4. Copy the key (starts with `sk-or-...`) and save it (this becomes `OPENROUTER_API_KEY`)
5. Add some credits to your OpenRouter account (even $5 is enough to start)

**Why server-side only:** If this key were in the frontend, anyone could open browser
DevTools, copy it, and use your OpenRouter credits. By keeping it in Supabase Edge Functions,
only your server code can use it.

---

## Step 5: Deploy to Vercel

Vercel auto-deploys your frontend every time you push to GitHub.

1. Go to https://vercel.com and sign in with your GitHub account
2. Click **Add New** -> **Project**
3. Find and import your `lucen` repository
4. Vercel auto-detects Vite. Verify these settings:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Expand **Environment Variables** and add:

   | Key | Value |
   |-----|-------|
   | `VITE_SUPABASE_URL` | `https://abcdefgh.supabase.co` (from Step 2) |
   | `VITE_SUPABASE_ANON_KEY` | Your anon key from Step 2 |
   | `VITE_APP_NAME` | `Lucen` |
   | `VITE_ADMIN_EMAILS` | Your email address (comma-separated if multiple) |

6. Click **Deploy**

After deployment finishes, you'll get a URL like `https://lucen.vercel.app`. This is your live app.

**Now go back to Step 3** and add this URL to Supabase Auth redirect URLs.

**What just happened:** Vercel cloned your repo, ran `npm run build` (which compiles TypeScript
and bundles React into static HTML/JS/CSS), and put the result on its global CDN. Every
future push to `main` triggers a new build automatically.

---

## Step 6: Set GitHub Secrets

GitHub Secrets are encrypted values that GitHub Actions can read during the workflow.
They never appear in logs.

1. Go to your GitHub repo -> **Settings** -> **Secrets and variables** -> **Actions**
2. Click **New repository secret** for each of these:

   | Secret name | Value | What it does |
   |-------------|-------|-------------|
   | `SUPABASE_ACCESS_TOKEN` | The token from Step 2 | Authenticates the CLI with Supabase |
   | `SUPABASE_PROJECT_ID` | The project ref ID (e.g. `abcdefgh`) | Tells the CLI which project to deploy to |
   | `SUPABASE_DB_PASSWORD` | The database password from Step 2 | Needed to link the project and push migrations |
   | `OPENROUTER_API_KEY` | The `sk-or-...` key from Step 4 | Set as a Supabase secret for the Edge Functions |
   | `VITE_APP_URL` | Your Vercel URL (e.g. `https://lucen.vercel.app`) | Set as a Supabase secret; Edge Functions use it for CORS |

**Why GitHub Secrets:** The GitHub Actions workflow runs `supabase db push` and
`supabase functions deploy`. It needs credentials to do that. Storing them as GitHub
Secrets means they are encrypted at rest and masked in logs.

---

## Step 7: Trigger the first Supabase deploy

The GitHub Actions workflow runs when files in the `supabase/` folder change on the `main`
branch. You can also trigger it manually.

1. Go to your GitHub repo -> **Actions** tab
2. Click **Deploy Supabase** in the left sidebar
3. Click **Run workflow** -> **Run workflow**

This will:
- Push all database migrations (creates your tables, policies, functions)
- Set the `OPENROUTER_API_KEY` and `VITE_APP_URL` secrets in Supabase
- Deploy the `chat-proxy` and `deduct-credits` Edge Functions

Watch the workflow run. Green checkmark = success.

**What is a migration?** A migration is a SQL file that describes a change to the database
(e.g. "create a table called conversations"). Supabase tracks which migrations have already
run, so it only applies new ones. This means your database evolves safely over time.

**What is an Edge Function?** A small server program that runs on Supabase's infrastructure.
`chat-proxy` receives chat requests from the browser, adds the OpenRouter API key (which
the browser doesn't have), calls OpenRouter, and streams the response back. `deduct-credits`
handles reading and updating the user's credit balance.

---

## Step 8: Verify everything works

Open your Vercel URL in a browser and run through this checklist:

- [ ] The app loads without errors
- [ ] You can create an account (check your email for confirmation)
- [ ] After confirming, you can sign in
- [ ] You can send a chat message and get a streamed AI response
- [ ] Your credit balance decreases after a message
- [ ] If you set yourself as admin (via `VITE_ADMIN_EMAILS`), you see the admin dashboard

If something isn't working, see the Troubleshooting section below.

---

## Making changes (the day-to-day workflow)

Once everything is set up, your workflow is simple:

```
1. Edit code locally
2. Test with `npm run dev`
3. git add -A && git commit -m "describe change" && git push
4. Done -- Vercel and Supabase auto-deploy
```

**Frontend changes** (anything in `src/`): Vercel picks them up automatically on every push.
No action needed.

**Backend changes** (anything in `supabase/`): The GitHub Actions workflow picks them up
automatically. This includes:
- New migration files in `supabase/migrations/`
- Changes to Edge Functions in `supabase/functions/`

**Adding a new database table:**

1. Create a new migration file: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
   (the timestamp prefix ensures correct ordering)
2. Write your SQL (CREATE TABLE, ALTER TABLE, etc.)
3. Push to GitHub -- the workflow applies it automatically

---

## How the CI/CD pipeline works

"CI/CD" stands for Continuous Integration / Continuous Deployment. It means your code is
automatically tested and deployed whenever you push changes.

### Vercel (frontend)

Vercel watches your GitHub repo. On every push to `main`:

1. Vercel clones the repo
2. Runs `npm install` to install dependencies
3. Runs `npm run build` to compile TypeScript and bundle React
4. Deploys the `dist/` folder to its global CDN
5. Your users see the new version within ~60 seconds

### GitHub Actions (Supabase backend)

The workflow at `.github/workflows/deploy-supabase.yml` runs on every push to `main` that
changes files in the `supabase/` folder:

1. Checks out your code
2. Installs the Supabase CLI
3. Links to your Supabase project (using `SUPABASE_PROJECT_ID` + `SUPABASE_DB_PASSWORD`)
4. Runs `supabase db push` -- applies any new migration files to your database
5. Sets Edge Function secrets (`OPENROUTER_API_KEY`, `VITE_APP_URL`)
6. Deploys the `chat-proxy` and `deduct-credits` Edge Functions

You can also trigger it manually from the Actions tab using "Run workflow".

---

## Project structure reference

```
lucen/
├── src/                        # Frontend (React + TypeScript)
│   ├── components/             # UI components
│   ├── config/                 # App config (models, credits, admin)
│   ├── lib/supabase.ts         # Supabase client setup
│   ├── services/               # API calls, auth, database
│   ├── store/                  # Zustand state stores
│   └── types/                  # TypeScript types
├── supabase/
│   ├── config.toml             # Supabase local dev config
│   ├── migrations/             # SQL files that define/evolve the database
│   └── functions/              # Edge Functions (server-side code)
│       ├── _shared/cors.ts     # Shared CORS logic
│       ├── chat-proxy/         # Proxies AI requests (keeps API key server-side)
│       └── deduct-credits/     # Manages credit balance
├── .github/workflows/          # GitHub Actions CI/CD
├── vercel.json                 # Vercel routing config (SPA rewrites)
├── .env.example                # Template for local dev environment variables
└── package.json                # Dependencies and scripts
```

---

## Environment variables reference

### Vercel (frontend build)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Your Supabase anon/public key |
| `VITE_APP_NAME` | No | App name shown in UI (default: `Lucen`) |
| `VITE_ADMIN_EMAILS` | No | Comma-separated admin emails |
| `VITE_OPENROUTER_MODEL` | No | Default model ID (default: `deepseek/deepseek-v3.2`) |

### GitHub Secrets (for the Actions workflow)

| Secret | Required | Description |
|--------|----------|-------------|
| `SUPABASE_ACCESS_TOKEN` | Yes | CLI authentication token |
| `SUPABASE_PROJECT_ID` | Yes | Project reference ID |
| `SUPABASE_DB_PASSWORD` | Yes | Database password |
| `OPENROUTER_API_KEY` | Yes | AI API key (set as Supabase secret) |
| `VITE_APP_URL` | Yes | Production URL for CORS (e.g. `https://lucen.vercel.app`) |

---

## Troubleshooting

### "Missing Authorization header" or 401 errors

Your browser session may have expired. Sign out and sign back in.
Also verify that `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are correctly set in Vercel.

### Chat messages fail with "OpenRouter API key not configured"

The `OPENROUTER_API_KEY` secret is not set in Supabase. Either:
- Re-run the GitHub Actions workflow (it sets secrets every time), or
- Set it manually: install the Supabase CLI, run `supabase link`, then
  `supabase secrets set OPENROUTER_API_KEY=sk-or-your-key`

### Auth emails not arriving

Check your Supabase dashboard -> Authentication -> Email Templates. Supabase's built-in
email service has rate limits. For production, consider configuring a custom SMTP provider
in Settings -> Authentication -> SMTP Settings.

### CORS errors in the browser console

The `VITE_APP_URL` Supabase secret must match your actual Vercel URL exactly
(e.g. `https://lucen.vercel.app`). Re-run the GitHub Actions workflow after correcting
the `VITE_APP_URL` GitHub Secret.

### GitHub Actions workflow not running

The workflow only triggers when files in `supabase/` change. To force a run:
go to Actions -> Deploy Supabase -> Run workflow.

### Database migration failed

Check the GitHub Actions log for the specific SQL error. Common causes:
- A table or column already exists (use `IF NOT EXISTS` in your SQL)
- A migration was edited after it was already applied (never edit applied migrations --
  create a new one instead)

### Admin dashboard not showing

Make sure `VITE_ADMIN_EMAILS` is set in Vercel env vars and includes your account email.
Redeploy after changing env vars (Vercel -> Deployments -> Redeploy).
