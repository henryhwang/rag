# Setup Guide

Follow these steps to configure your environment.

## Step 1: Create Project

Initialize a new project in your desired directory.

## Step 2: Configure Environment Variables

Create a `.env` file with the following variables:

- `API_KEY` - Your application's API key
- `DB_HOST` - Database host address
- `LOG_LEVEL` - Debugging verbosity level

## Step 3: Run Migrations

Execute database migrations before first use:

```bash
npx migrate up
```

## Verification

Check that everything is working by running health check:

```bash
curl http://localhost:3000/health
```
