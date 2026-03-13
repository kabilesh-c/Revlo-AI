# Supabase Setup Guide

## Issue: "Anonymous sign-ins are disabled" Error

This error occurs when Supabase email/password authentication is not properly configured. Follow these steps:

## Step 1: Configure Supabase Authentication

1. Go to your Supabase project dashboard: https://supabase.com/dashboard
2. Navigate to **Authentication** → **Providers**
3. Make sure **Email** provider is enabled
4. Click on **Email** to configure it:
   - **Enable Email provider**: ON
   - **Confirm email**: You can set this to OFF for development, or ON for production
   - **Secure email change**: Optional
   - **Double confirm email changes**: Optional

## Step 2: Configure Email Templates (Optional)

1. Go to **Authentication** → **Email Templates**
2. Configure the **Confirm signup** template if email confirmation is enabled
3. For development, you can disable email confirmation in **Authentication** → **Settings**:
   - Set **Enable email confirmations** to OFF

## Step 3: Check Your Environment Variables

Make sure your `.env` files have the correct values:

### For Electron App (`electron-app/.env`):
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

### For Parent Dashboard (`parent-dashboard/.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Step 4: Run Database Migrations

Make sure you've run the database migrations to create the required tables:

1. Go to **SQL Editor** in Supabase dashboard
2. Run the migration from `backend/supabase/migrations/001_initial_schema.sql`

## Step 5: Test Authentication

### For Development (No Email Confirmation):
1. In Supabase dashboard: **Authentication** → **Settings**
2. Turn OFF **Enable email confirmations**
3. Now you can sign up and immediately sign in

### For Production (With Email Confirmation):
1. Keep **Enable email confirmations** ON
2. Users will receive a confirmation email
3. They must click the link before they can sign in

## Troubleshooting

### Error: "Anonymous sign-ins are disabled"
- **Solution**: Enable Email provider in Authentication → Providers

### Error: "User already registered"
- **Solution**: Use sign in instead, or delete the user from Supabase dashboard

### Error: "Email rate limit exceeded"
- **Solution**: Wait a few minutes, or check Supabase rate limits

### Electron App Not Showing Auth UI
- **Check**: Make sure `SUPABASE_URL` and `SUPABASE_ANON_KEY` are in `electron-app/.env`
- **Check**: Restart the Electron app after adding env variables
- **Check**: Look at the console logs for any Supabase initialization errors

### Parent Dashboard Signup Not Working
- **Check**: Make sure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are in `parent-dashboard/.env.local`
- **Check**: Restart the Next.js dev server after adding env variables
- **Check**: Browser console for detailed error messages

## Quick Fix for Development

If you want to quickly test without email confirmation:

1. Supabase Dashboard → **Authentication** → **Settings**
2. Turn OFF **Enable email confirmations**
3. Save changes
4. Try signing up again

This allows immediate sign-in after signup without email verification.

