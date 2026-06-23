-- =============================================
-- FIX RLS POLICIES FOR OBJECTIF RESIDANAT
-- =============================================

-- 1. First, let's see what policies currently exist
-- (This is just for reference, you can run this to see current policies)
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
-- FROM pg_policies WHERE tablename = 'profiles';

-- 2. Drop all existing policies on profiles table to start fresh
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON profiles;
DROP POLICY IF EXISTS "Enable update for users based on email" ON profiles;

-- 3. Create simple policies that allow users to read their own profile
CREATE POLICY "Users can read own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- 4. Allow users to update their own profile
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- 5. Allow users to insert their own profile
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 6. Grant necessary permissions
GRANT ALL ON profiles TO anon, authenticated;

-- 7. Make sure RLS is enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check if RLS is enabled
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'profiles';

-- Check current policies
SELECT policyname, cmd, permissive, roles, qual 
FROM pg_policies 
WHERE tablename = 'profiles';

-- Test if you can read your own profile (replace with your user ID)
-- SELECT * FROM profiles WHERE id = auth.uid();
