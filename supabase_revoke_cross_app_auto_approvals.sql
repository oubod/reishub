-- Optional cleanup if the older cross-app SQL was already run.
-- It moves likely auto-created second-country profiles back to pending.
-- Admin-reviewed rows are kept because reviewed_at is not null.

update public.tunis_profiles tp
set approved = false,
    rejected = false,
    updated_at = now()
from auth.users u
where tp.id = u.id
  and tp.approved = true
  and tp.reviewed_at is null
  and coalesce(u.raw_user_meta_data ->> 'portal', '') <> 'tunisia';

update public.mauritania_profiles mp
set approved = false,
    rejected = false,
    updated_at = now()
from auth.users u
where mp.id = u.id
  and mp.approved = true
  and mp.reviewed_at is null
  and coalesce(u.raw_user_meta_data ->> 'portal', '') <> 'mauritania';
