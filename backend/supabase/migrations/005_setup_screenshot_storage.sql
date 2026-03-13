-- Setup Storage Bucket and Policies for Screenshots
-- Simple permissive policies - allows all authenticated uploads and public reads

-- Drop existing policies if they exist (to allow re-running this migration)
DROP POLICY IF EXISTS "Allow all authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;

-- Policy 1: Allow ANY authenticated user to upload ANY file to incident-screenshots bucket
-- No folder restrictions - just allow all uploads
CREATE POLICY "Allow all authenticated uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'incident-screenshots');

-- Policy 2: Allow public read access to all files in incident-screenshots bucket
-- Anyone can view screenshots (needed for parent dashboard)
CREATE POLICY "Allow public read access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'incident-screenshots');

