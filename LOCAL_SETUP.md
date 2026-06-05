# 🚀 Local Development Setup Guide

## Quick Start - Choose Your Method

### Option 1: Docker Compose (Recommended - Full Stack)
Best for development. Includes Next.js, Worker, and Redis in containers.

### Option 2: Local Node.js Development
Run apps directly on your machine without Docker.

---

## Prerequisites

- **Node.js** v18+ (install via [nvm](https://github.com/nvm-sh/nvm#installing-and-updating))
- **npm** or **bun**
- **Git**
- **Docker & Docker Compose** (only for Option 1)

---

## Required External Services

You need accounts and credentials from:

### 1. **Supabase** (Database & Auth)
- Create account at https://supabase.com
- Create a new project
- Get these credentials from **Project Settings > API**:
  - `NEXT_PUBLIC_SUPABASE_URL` (public URL)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon/public key)
  - `SUPABASE_SERVICE_ROLE_KEY` (service role key - keep secret!)

### 2. **OpenRouter API** (Required for Worker)
- Sign up at https://openrouter.ai
- Get your API key from settings
- Get `OPENROUTER_API_KEY`

### 3. **Redis** (Message Queue)
- For Docker: Included automatically
- For local: Install Redis locally or use a managed service
  - Cloud option: Use Railway/Upstash Redis URL

### 4. **Railway** (Optional - Cloud Services)
If using Railway:
- Create accounts for services you want to host
- Get the connection URLs/credentials from Railway dashboard
- Use these URLs in your `.env` files

---

## Setup Instructions

### Step 1: Clone & Install Dependencies

```bash
# Clone the repository
git clone <YOUR_GIT_URL>
cd solospiderv1-main

# Install monorepo dependencies
npm install
# OR with bun
bun install
```

### Step 2: Create Environment Files

#### For Next.js App (`apps/web-next/.env`)

```env
# Supabase - Get from https://app.supabase.com/project/[id]/settings/api
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Supabase Service Role (keep secret!)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Redis - Local or Remote
REDIS_URL=redis://localhost:6379
# OR for Railway Redis: REDIS_URL=redis://user:password@redis-host:6379

# Worker Communication
WORKER_SECRET=dev-secret

# Social Login (Optional)
LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret
LINKEDIN_REDIRECT_URI=http://localhost:3000/api/auth/callback/linkedin

TWITTER_CLIENT_ID=your-twitter-client-id
TWITTER_CLIENT_SECRET=your-twitter-client-secret
TWITTER_REDIRECT_URI=http://localhost:3000/api/auth/callback/twitter
```

#### For Worker (`apps/worker/.env`)

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Redis
REDIS_URL=redis://localhost:6379

# OpenRouter API - Get from https://openrouter.ai/keys
OPENROUTER_API_KEY=sk-or-v1-...

# Worker Communication
WORKER_SECRET=dev-secret

# Social Login (Optional)
LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret
LINKEDIN_REDIRECT_URI=http://localhost:3000/api/auth/callback/linkedin

TWITTER_CLIENT_ID=your-twitter-client-id
TWITTER_CLIENT_SECRET=your-twitter-client-secret
TWITTER_REDIRECT_URI=http://localhost:3000/api/auth/callback/twitter
```

---

## Running the Project

### Option 1: Docker Compose (Full Stack) 🐳

```bash
# Build and start all services (Redis, Worker, Frontend)
docker compose up --build

# Or run in background
docker compose up -d --build

# View logs
docker compose logs -f

# Stop services
docker compose down
```

**Access:**
- Frontend: http://localhost:3000
- API Health: http://localhost:3000/api/health
- Redis: localhost:6379

### Option 2: Local Development (No Docker)

#### Step 1: Start Redis

```bash
# Install Redis locally (macOS)
brew install redis

# Start Redis
redis-server

# OR use Docker just for Redis
docker run -p 6379:6379 redis:7-alpine
```

#### Step 2: Start Worker

```bash
npm run dev:worker
# or
npm --prefix apps/worker run dev
```

#### Step 3: Start Frontend (New Terminal)

```bash
npm run dev:next
# or
npm run dev
```

**Access:**
- Frontend: http://localhost:3000
- Worker runs on background process queue

---

## Using Supabase Locally (Alternative)

If you want a **completely local** Supabase instance:

### Install Supabase CLI

```bash
brew install supabase/tap/supabase
# OR
npm install -g supabase
```

### Start Local Supabase

```bash
cd solospiderv1-main
supabase start
```

This will output:
```
API URL: http://127.0.0.1:54321
Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Service Role Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Update .env for Local Supabase

**For `apps/web-next/.env`:**
```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
# Keep the anon key from supabase start output
```

**For `apps/worker/.env`:** (Docker)
```env
SUPABASE_URL=http://host.docker.internal:54321
# Keep the service role key from supabase start output
```

**Then reset database:**
```bash
supabase db reset
```

---

## Using Railway Services with Local Dev

If your services are on **Railway**, get connection strings:

1. Go to **Railway Dashboard** > Your Project
2. Click on each service (PostgreSQL, Redis, etc.)
3. Click **Variables** to find connection URLs

Example Railway values:

```env
# PostgreSQL (Supabase would handle this)
# Use Railway PostgreSQL if not using Supabase

# Redis from Railway
REDIS_URL=redis://user:password@railway-redis-host.up.railway.app:6379
```

---

## Troubleshooting

### Redis Connection Error
```
Error: getaddrinfo ENOTFOUND localhost
```
**Fix:** Make sure Redis is running (check `redis-cli ping`)

### Supabase Connection Error
```
TypeError: Cannot read property 'from' of undefined
```
**Fix:** Check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are correct

### Worker Not Processing Jobs
**Fix:** Ensure `WORKER_SECRET` is the same in both `.env` files

### NEXT.js Won't Start
```bash
# Clear cache
rm -rf .next node_modules
npm install
npm run dev:next
```

### Docker Build Fails
```bash
# Clean up Docker
docker compose down --volumes
docker compose up --build
```

---

## Environment Variables Summary

| Variable | Required | Where to Get | Used In |
|----------|----------|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase Settings | web-next |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase Settings | web-next |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase Settings | web-next, worker |
| `OPENROUTER_API_KEY` | ✅ | openrouter.ai | worker |
| `REDIS_URL` | ✅ | Local Redis or Railway | web-next, worker |
| `WORKER_SECRET` | ✅ | Generate any string | web-next, worker |
| Social credentials | ❌ | Provider dashboards | web-next, worker |

---

## Next Steps

1. ✅ Create Supabase project
2. ✅ Get OpenRouter API key
3. ✅ Set up Redis (local or Railway)
4. ✅ Create `.env` files
5. ✅ Run `npm install`
6. ✅ Choose Option 1 (Docker) or Option 2 (Local)
7. ✅ Visit http://localhost:3000

---

## Need Help?

- **Supabase Docs:** https://supabase.com/docs
- **OpenRouter Docs:** https://openrouter.ai/docs
- **Next.js Docs:** https://nextjs.org/docs
- **Redis Docs:** https://redis.io/docs
