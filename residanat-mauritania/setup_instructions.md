# Setup Instructions for Guest Login and Account Approval

## New Features Implemented

### 1. Guest Login
- Users can now access the app as guests without creating an account
- Guest users have limited access to only the first 2 lectures of each section
- Guests cannot save progress or access full content
- Guest users see a green avatar and "Mode Invité" in their profile

### 2. Account Approval System
- New user registrations require admin approval before full access
- New users are created with `approved: false` by default
- Users cannot log in until their account is approved
- Admin interface provided to manage user approvals

## Database Setup Required

You need to update your Supabase `profiles` table to include the `approved` field:

```sql
ALTER TABLE profiles ADD COLUMN approved BOOLEAN DEFAULT false;
```

## Admin Configuration

### Admin Access
1. Go to your Supabase dashboard
2. Navigate to **Table Editor** → **profiles** table
3. You'll see all users with their `approved` status

### Admin Features
- View all registered users directly in Supabase
- See approval status (pending/approved) in the `approved` column
- Click to toggle approval status (FALSE → TRUE)
- View user details including email, username, and registration date

## How It Works

### Guest Users
1. Click "Continuer en tant qu'invité" on login page
2. Access limited to first 2 lectures per section
3. Cannot save progress
4. See lock icons indicating restricted content

### Regular Users
1. Register with email/password
2. Account created with `approved: false`
3. Cannot log in until admin approves
4. After approval, full access to all content

### Admin Management
1. Go to your Supabase dashboard → Table Editor → `profiles` table
2. View all users and their `approved` status
3. Click on `FALSE` in the `approved` column to change it to `TRUE`
4. Users can then log in with full access

## Security Notes

- Account approval is managed directly in Supabase dashboard (secure)
- The approval system prevents unauthorized access to full content
- Guest users have read-only access to limited content
- No client-side admin credentials needed

## Files Modified

- `login.html` - Added guest login button
- `js/auth.js` - Added guest login and approval checking
- `js/app.js` - Added guest user handling and content restrictions

## Testing

1. Test guest login by clicking the guest button
2. Test registration flow - user should not be able to log in immediately
3. Test approval in Supabase - change `approved` from `FALSE` to `TRUE` and verify user can log in
4. Verify guest users see limited content
5. Verify approved users see all content
