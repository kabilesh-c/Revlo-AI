-- COMPLETE FIX FOR RLS - Run this in Supabase SQL Editor
-- This fixes the 500 errors by removing circular dependencies

-- Step 1: Drop ALL existing policies on profiles
DROP POLICY IF EXISTS "users_own_profile" ON profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON profiles;
DROP POLICY IF EXISTS "users_insert_own_profile" ON profiles;
DROP POLICY IF EXISTS "parents_read_kid_profiles" ON profiles;
DROP POLICY IF EXISTS "parents_read_all_profiles" ON profiles;
DROP POLICY IF EXISTS "parents_can_read_all_for_linking" ON profiles;
DROP POLICY IF EXISTS "parents_update_own_profile" ON profiles;
DROP POLICY IF EXISTS "parents_insert_own_profile" ON profiles;

-- Step 2: Create simpler, non-circular policies

-- Policy 1: Anyone authenticated can read profiles (for linking)
-- This is permissive but necessary for the linking flow
CREATE POLICY "authenticated_read_profiles" ON profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy 2: Users can update their own profile
CREATE POLICY "users_update_own_profile" ON profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Policy 3: Users can insert their own profile
CREATE POLICY "users_insert_own_profile" ON profiles
  FOR INSERT
  TO authenticated
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
ON CONFLICT (id) DO UPDATE 
SET role = 'parent', 
    email = EXCLUDED.email,
    updated_at = NOW();

-- Kid profile  
INSERT INTO profiles (id, email, role)
SELECT 
  id, 
  email, 
  'kid' as role
FROM auth.users
WHERE email = 'funwithbuddies2@gmail.com'
ON CONFLICT (id) DO UPDATE 
SET role = 'kid', 
    email = EXCLUDED.email,
    updated_at = NOW();

-- Step 4: Verify
SELECT 
  'Parent' as type, 
  email, 
  role,
  id
FROM profiles 
WHERE email = 'craftsio1980@gmail.com'
UNION ALL
SELECT 
  'Kid' as type, 
  email, 
  role,
  id
FROM profiles 
WHERE email = 'funwithbuddies2@gmail.com';




