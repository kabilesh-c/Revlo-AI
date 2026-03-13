-- Simplified fix: Allow parents to read kid profiles
-- This is a simpler approach that should work better

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "parents_read_kid_profiles" ON profiles;

-- Create a simpler policy: Allow reading profiles with role 'kid' if the requester is a parent
-- We check if the current user's profile has role 'parent'
CREATE POLICY "parents_read_kid_profiles" ON profiles
  FOR SELECT 
  USING (
    -- Allow if the profile being read is a kid
    role = 'kid'
    AND
    -- And the current user is authenticated and has a parent role
    (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.role = 'parent'
      )
      OR
      -- Also allow if user is reading their own profile
      id = auth.uid()
    )
  );

-- Also ensure parents can read all profiles for linking purposes
-- This is more permissive but necessary for the linking flow
CREATE POLICY "parents_can_read_all_for_linking" ON profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role = 'parent'
    )
  );




