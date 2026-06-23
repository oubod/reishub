# How to Approve Users in Supabase

## Quick Guide

### Step 1: Access Supabase Dashboard
1. Go to [supabase.com](https://supabase.com)
2. Sign in to your account
3. Select your project

### Step 2: Navigate to Profiles Table
1. Click on **"Table Editor"** in the left sidebar
2. Click on **"profiles"** table
3. You'll see all registered users

### Step 3: Approve Users
1. Look for the **"approved"** column
2. Users with `FALSE` are pending approval
3. Users with `TRUE` are already approved
4. Click on `FALSE` to change it to `TRUE`
5. The user can now log in with full access

## User Information Available

In the profiles table, you can see:
- **id**: Unique user identifier
- **username**: User's display name
- **email**: User's email address
- **approved**: Approval status (TRUE/FALSE)
- **created_at**: When they registered
- **updated_at**: Last profile update
- **progress**: Their learning progress (JSON)

## Example

If you see a user:
- Email: `newuser@example.com`
- Approved: `FALSE`

Click on the `FALSE` value in the approved column to change it to `TRUE`. The user will then be able to log in and access the full application.

## Security

- Only users with `approved: TRUE` can log in to the full application
- Users with `approved: FALSE` will see an error message when trying to log in
- Guest users can access limited content without needing approval
