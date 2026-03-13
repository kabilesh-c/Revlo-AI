-- Fix RLS policies for parent_kid_links so kids can accept/reject links
-- Run this in Supabase SQL Editor

-- Drop existing policies
DROP POLICY IF EXISTS "kids_see_their_links" ON parent_kid_links;
DROP POLICY IF EXISTS "kids_update_their_links" ON parent_kid_links;
DROP POLICY IF EXISTS "kids_delete_their_links" ON parent_kid_links;

-- Policy 1: Kids can see their own link requests (pending or active)
CREATE POLICY "kids_see_their_links" ON parent_kid_links
  FOR SELECT
  USING (auth.uid() = kid_id);

-- Policy 2: Kids can update their own links (to accept)
-- Allow update if kid owns it, regardless of current status (we check status in code)
CREATE POLICY "kids_update_their_links" ON parent_kid_links
  FOR UPDATE
  USING (auth.uid() = kid_id)
  WITH CHECK (auth.uid() = kid_id);

-- Policy 3: Kids can delete their own pending links (to reject)
CREATE POLICY "kids_delete_their_links" ON parent_kid_links
  FOR DELETE
  USING (auth.uid() = kid_id AND status = 'pending');

-- Verify the link exists and check its status
SELECT 
  id,
  parent_id,
  kid_id,
  status,
  created_at
FROM parent_kid_links
WHERE kid_id = '5d93961f-5058-4177-925f-d3838320f84f'
AND status = 'pending';

