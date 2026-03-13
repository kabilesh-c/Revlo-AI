-- Fix: Allow parents to read kid profiles for linking
-- This migration adds a policy so parents can query kid profiles by email

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "parents_read_kid_profiles" ON profiles;

-- Create policy: Parents can read profiles with role 'kid'
CREATE POLICY "parents_read_kid_profiles" ON profiles
  FOR SELECT USING (
    -- Check if current user is a parent
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role = 'parent'
    )
    -- And the profile being read is a kid
    AND role = 'kid'
  );




