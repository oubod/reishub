-- =============================================
-- SIMPLE SUPABASE SETUP FOR OBJECTIF RESIDANAT
-- =============================================

-- 1. Add the 'approved' column to the profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false;

-- 2. Add the 'created_at' column if it doesn't exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. Add the 'email' column if it doesn't exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- 4. Update existing profiles to set default values
UPDATE profiles SET approved = true WHERE approved IS NULL;

-- 5. Create a function to automatically create profiles when users sign up
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
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Update existing profiles with email addresses from auth.users
UPDATE profiles 
SET email = au.email 
FROM auth.users au 
WHERE profiles.id = au.id 
AND profiles.email IS NULL;

-- 8. Make your existing account an admin (replace with your email)
-- First, find your user ID by running this query:
-- SELECT id, email FROM auth.users WHERE email = 'your-email@domain.com';

-- Then update your profile to be approved (replace 'your-user-id' with actual ID):
-- UPDATE profiles SET approved = true WHERE id = 'your-user-id-here';

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
