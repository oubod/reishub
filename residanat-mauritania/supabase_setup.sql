-- =============================================
-- SUPABASE DATABASE SETUP FOR OBJECTIF RESIDANAT
-- =============================================

-- 1. Add the 'approved' column to the profiles table
-- This column determines if a user can access the full app
ALTER TABLE profiles ADD COLUMN approved BOOLEAN DEFAULT false;

-- 2. Add the 'created_at' column if it doesn't exist
-- This helps track when users registered
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. Add the 'email' column if it doesn't exist
-- This stores the user's email for admin purposes
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- 4. Update existing profiles to set default values
-- Set all existing users as approved (since they were created before this system)
UPDATE profiles SET approved = true WHERE approved IS NULL;

-- 5. Create a function to automatically create profiles when users sign up
-- This ensures new users get a profile with approved = false
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url, approved, progress, email, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'User'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', 'https://api.dicebear.com/7.x/initials/svg?seed=User&backgroundColor=007AFF&textColor=FFFFFF&radius=50'),
    false, -- New users are not approved by default
    '{}', -- Empty progress object
    NEW.email,
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create a trigger to automatically create profiles
-- This runs the function above whenever a new user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Set up Row Level Security (RLS) policies
-- Enable RLS on profiles table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 8. Create policy for users to read their own profile
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- 9. Create policy for users to update their own profile
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- 10. Create policy for users to insert their own profile
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 11. Create policy for admins to read all profiles
-- Replace 'your-admin-user-id' with your actual admin user ID from auth.users
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE auth.users.id = auth.uid() 
      AND auth.users.email = 'admin@residanat.com' -- Change this to your admin email
    )
  );

-- 12. Create policy for admins to update all profiles
CREATE POLICY "Admins can update all profiles" ON profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE auth.users.id = auth.uid() 
      AND auth.users.email = 'admin@residanat.com' -- Change this to your admin email
    )
  );

-- 13. Create policy for admins to delete profiles (if needed)
CREATE POLICY "Admins can delete profiles" ON profiles
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE auth.users.id = auth.uid() 
      AND auth.users.email = 'admin@residanat.com' -- Change this to your admin email
    )
  );

-- 14. Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON profiles TO anon, authenticated;

-- 15. Update existing profiles with email addresses from auth.users
-- This syncs email addresses from auth.users to profiles table
UPDATE profiles 
SET email = au.email 
FROM auth.users au 
WHERE profiles.id = au.id 
AND profiles.email IS NULL;

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check if the approved column was added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'profiles' AND column_name = 'approved';

-- Check current profiles and their approval status
SELECT id, username, email, approved, created_at 
FROM profiles 
ORDER BY created_at DESC;

-- Check if the trigger function exists
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_name = 'handle_new_user';

-- =============================================
-- ADMIN SETUP
-- =============================================

-- To make yourself an admin, run this query with your user ID:
-- First, find your user ID:
-- SELECT id, email FROM auth.users WHERE email = 'your-email@domain.com';

-- Then update your profile to be approved:
-- UPDATE profiles SET approved = true WHERE id = 'your-user-id-here';

-- =============================================
-- NOTES
-- =============================================
-- 1. Change 'admin@residanat.com' to your actual admin email in policies
-- 2. The trigger will automatically create profiles for new users
-- 3. All new users will have approved = false by default
-- 4. Existing users will have approved = true (grandfathered in)
-- 5. Use the admin panel at admin.html to manage user approvals
