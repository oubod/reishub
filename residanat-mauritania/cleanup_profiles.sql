-- =============================================
-- CLEANUP PROFILES TABLE
-- =============================================

-- 1. Check current profiles and their status
SELECT id, username, email, approved, created_at 
FROM profiles 
ORDER BY created_at DESC;

-- 2. If you want to delete a specific profile (replace with actual user ID):
-- DELETE FROM profiles WHERE id = 'user-id-here';

-- 3. If you want to reset all profiles to not approved:
-- UPDATE profiles SET approved = false;

-- 4. If you want to delete all profiles (be careful!):
-- DELETE FROM profiles;

-- 5. Check if there are any orphaned profiles (profiles without corresponding auth.users):
-- SELECT p.id, p.username, p.email 
-- FROM profiles p 
-- LEFT JOIN auth.users u ON p.id = u.id 
-- WHERE u.id IS NULL;

-- 6. Delete orphaned profiles:
-- DELETE FROM profiles 
-- WHERE id NOT IN (SELECT id FROM auth.users);

-- =============================================
-- SAFE CLEANUP FOR YOUR SPECIFIC CASE
-- =============================================

-- If you're having issues with the user oubaryan@gmail.com, you can:
-- 1. Find their user ID:
SELECT id, email FROM auth.users WHERE email = 'oubaryan@gmail.com';

-- 2. Delete their profile (replace 'user-id' with the actual ID from step 1):
-- DELETE FROM profiles WHERE id = 'user-id-here';

-- 3. They can then sign up again and a new profile will be created
