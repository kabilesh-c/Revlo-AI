# Screenshot Feature Setup Guide

This guide explains how to set up the screenshot capture and storage feature for high/medium severity incidents.

## Overview

When an incident is detected with **high** or **medium** severity, the system will:
1. Automatically capture a screenshot of the current screen
2. Upload it to Supabase Storage
3. Store the screenshot URL in the database
4. Display the screenshot in the parent dashboard

## Setup Steps

### 1. Run Database Migration

Run the migration to add the `screenshot_url` column to the incidents table:

```sql
-- This is in backend/supabase/migrations/004_add_screenshot_url.sql
ALTER TABLE incidents 
ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
```

You can run this in the Supabase SQL Editor.

### 2. Create Supabase Storage Bucket

1. Go to your Supabase project dashboard
2. Navigate to **Storage** in the left sidebar
3. Click **New bucket**
4. Create a bucket named: `incident-screenshots`
5. Set it as **Public bucket** (so screenshots can be viewed in the parent dashboard)
6. Click **Create bucket**

### 3. Set Storage Policies

**IMPORTANT**: You must set up Row Level Security (RLS) policies for the storage bucket, otherwise uploads will fail with a 403 error.

**Quick Setup (Recommended)**
1. Go to Supabase SQL Editor
2. Run the migration file: `backend/supabase/migrations/005_setup_screenshot_storage.sql`
3. This creates simple permissive policies that allow all authenticated uploads and public reads

**Manual Setup (Alternative)**
1. Go to **Storage** → **Policies** → `incident-screenshots`
2. Click **New Policy** and add these two simple policies:

#### Policy 1: Allow all authenticated uploads (no restrictions)
```sql
CREATE POLICY "Allow all authenticated uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'incident-screenshots');
```

#### Policy 2: Allow public read access
```sql
CREATE POLICY "Allow public read access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'incident-screenshots');
```

### 4. Verify Setup

1. Start the Electron app
2. Trigger a high or medium severity incident
3. Check the console logs for screenshot capture messages
4. Verify the screenshot appears in Supabase Storage under `incident-screenshots/{user_id}/`
5. Check the parent dashboard to see if the screenshot displays

## How It Works

1. **Detection**: When the agent sends text to the ingest endpoint
2. **Classification**: The text is classified for cyberbullying
3. **Screenshot**: If severity is `high` or `medium`, a screenshot is captured
4. **Upload**: Screenshot is uploaded to Supabase Storage in the format: `{user_id}/{incident_id}-{timestamp}.png`
5. **Storage**: The public URL is stored in the `screenshot_url` column
6. **Display**: The parent dashboard displays the screenshot when viewing incidents

## Troubleshooting

### Screenshot not being captured
- Check console logs for error messages
- Verify the user is logged in (screenshots require authentication)
- Check that Supabase Storage bucket exists and is accessible

### Screenshot not displaying in dashboard
- Verify the storage bucket is set to **Public**
- Check that the `screenshot_url` column exists in the incidents table
- Verify the URL is accessible (try opening it directly in a browser)

### Upload errors
- Check Supabase Storage policies are correctly set
- Verify the user has the correct permissions
- Check network connectivity

## Privacy Considerations

- Screenshots are stored per user in separate folders (`{user_id}/`)
- Only high/medium severity incidents trigger screenshots
- Screenshots are stored in Supabase Storage and can be managed there
- Parents can only see screenshots for incidents from their linked children

