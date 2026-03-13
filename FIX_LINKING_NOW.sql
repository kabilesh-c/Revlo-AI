-- COMPLETE FIX FOR PARENT-KID LINKING
-- Run this in Supabase SQL Editor

-- Step 1: Ensure parent profile has 'parent' role
-- Update your parent account (craftsio1980@gmail.com)
UPDATE profiles
SET role = 'parent'
WHERE email = 'craftsio1980@gmail.com'
AND (role IS NULL OR role != 'parent');

-- Step 2: Create/update kid profile if missing
-- Update kid account (funwithbuddies2@gmail.com)
INSERT INTO profiles (id, email, role)
SELECT 
  id, 
  email, 
  'kid' as role
FROM auth.users
WHERE email = 'funwithbuddies2@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'kid';

-- Step 3: Fix RLS policies to allow parents to read kid profiles
DROP POLICY IF EXISTS "parents_read_kid_profiles" ON profiles;
DROP POLICY IF EXISTS "parents_can_read_all_for_linking" ON profiles;

-- Simple policy: Parents can read any profile (for linking)
CREATE POLICY "parents_read_kid_profiles" ON profiles
  FOR SELECT
  USING (
    -- If current user is a parent, they can read all profiles
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role = 'parent'
    )
    OR
    -- Users can always read their own profile
    id = auth.uid()
  );

-- Step 4: Verify the setup
SELECT 
  'Parent' as type,
  email,
  role
FROM profiles
WHERE email = 'craftsio1980@gmail.com'
UNION ALL
SELECT 
  'Kid' as type,
  email,
  role
FROM profiles
WHERE email = 'funwithbuddies2@gmail.com';




