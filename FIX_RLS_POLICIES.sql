-- COMPLETE FIX FOR RLS POLICIES
-- Run this in Supabase SQL Editor to fix all RLS issues

-- Step 1: Drop all existing policies on profiles
DROP POLICY IF EXISTS "users_own_profile" ON profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON profiles;
DROP POLICY IF EXISTS "parents_read_kid_profiles" ON profiles;
DROP POLICY IF EXISTS "parents_can_read_all_for_linking" ON profiles;

-- Step 2: Recreate policies with correct logic

-- Policy 1: Users can read their own profile
CREATE POLICY "users_own_profile" ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Policy 2: Users can update their own profile
CREATE POLICY "users_update_own_profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- Policy 3: Users can insert their own profile (for signup)
CREATE POLICY "users_insert_own_profile" ON profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Policy 4: Parents can read all profiles (for linking)
-- This allows parents to find kid profiles by email
CREATE POLICY "parents_read_all_profiles" ON profiles
  FOR SELECT
  USING (
    -- Check if current user is a parent
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.role = 'parent'
    )
  );

-- Policy 5: Parents can update their own profile
CREATE POLICY "parents_update_own_profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Policy 6: Parents can insert their own profile
CREATE POLICY "parents_insert_own_profile" ON profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Step 3: Ensure both profiles exist with correct roles
-- Parent profile
INSERT INTO profiles (id, email, role)
SELECT 
  id, 
  email, 
  'parent' as role
FROM auth.users
WHERE email = 'craftsio1980@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'parent', email = EXCLUDED.email;

-- Kid profile
INSERT INTO profiles (id, email, role)
SELECT 
  id, 
  email, 
  'kid' as role
FROM auth.users
WHERE email = 'funwithbuddies2@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'kid', email = EXCLUDED.email;

-- Step 4: Verify policies are active
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;




