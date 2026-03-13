-- Fix RLS for parent_kid_links so kids can see pending requests
-- Run this in Supabase SQL Editor

-- Drop existing policy
DROP POLICY IF EXISTS "kids_see_their_links" ON parent_kid_links;

-- Create policy: Kids can see their own link requests (pending or active)
CREATE POLICY "kids_see_their_links" ON parent_kid_links
  FOR SELECT
  USING (auth.uid() = kid_id);

-- Also allow kids to update their own links (to accept/reject)
CREATE POLICY "kids_update_their_links" ON parent_kid_links
  FOR UPDATE
  USING (auth.uid() = kid_id)
  WITH CHECK (auth.uid() = kid_id);

-- Allow kids to delete their own links (to reject)
CREATE POLICY "kids_delete_their_links" ON parent_kid_links
  FOR DELETE
  USING (auth.uid() = kid_id AND status = 'pending');




