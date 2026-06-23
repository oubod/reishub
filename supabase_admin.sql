-- Supabase admin dashboard setup for both apps.
-- Run after supabase_tunis.sql and supabase_mauritania.sql.
-- Before running, replace the email below with your admin login email.

create table if not exists public.app_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.app_admins (email)
values (lower('test@oub.com'))
on conflict (email) do nothing;

alter table public.tunis_profiles
  add column if not exists rejected boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;

alter table public.mauritania_profiles
  add column if not exists rejected boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;

create or replace function public.create_tunis_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'portal' = 'tunisia' then
    insert into public.tunis_profiles (id, email, username, avatar_url, approved, progress)
    values (
      new.id,
      new.email,
      coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)),
      new.raw_user_meta_data ->> 'avatar_url',
      false,
      '{}'::jsonb
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_tunis_profile on auth.users;
create trigger on_auth_user_created_tunis_profile
after insert on auth.users
for each row execute function public.create_tunis_profile_for_new_user();

create or replace function public.create_mauritania_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'portal' = 'mauritania' then
    insert into public.mauritania_profiles (id, email, username, avatar_url, approved, progress)
    values (
      new.id,
      new.email,
      coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)),
      new.raw_user_meta_data ->> 'avatar_url',
      false,
      '{}'::jsonb
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_mauritania_profile on auth.users;
create trigger on_auth_user_created_mauritania_profile
after insert on auth.users
for each row execute function public.create_mauritania_profile_for_new_user();

insert into public.tunis_profiles (id, email, username, avatar_url, approved, progress)
select
  id,
  email,
  coalesce(nullif(raw_user_meta_data ->> 'username', ''), split_part(email, '@', 1)),
  raw_user_meta_data ->> 'avatar_url',
  false,
  '{}'::jsonb
from auth.users
where raw_user_meta_data ->> 'portal' = 'tunisia'
on conflict (id) do nothing;

insert into public.mauritania_profiles (id, email, username, avatar_url, approved, progress)
select
  id,
  email,
  coalesce(nullif(raw_user_meta_data ->> 'username', ''), split_part(email, '@', 1)),
  raw_user_meta_data ->> 'avatar_url',
  false,
  '{}'::jsonb
from auth.users
where raw_user_meta_data ->> 'portal' = 'mauritania'
on conflict (id) do nothing;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function public.is_app_admin() to authenticated;

alter table public.app_admins enable row level security;

drop policy if exists "app_admins_select_self" on public.app_admins;
create policy "app_admins_select_self"
on public.app_admins
for select
to authenticated
using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

grant select on public.app_admins to authenticated;

drop policy if exists "tunis_profiles_admin_select" on public.tunis_profiles;
drop policy if exists "tunis_profiles_admin_update" on public.tunis_profiles;

create policy "tunis_profiles_admin_select"
on public.tunis_profiles
for select
to authenticated
using (public.is_app_admin());

drop policy if exists "mauritania_profiles_admin_select" on public.mauritania_profiles;
drop policy if exists "mauritania_profiles_admin_update" on public.mauritania_profiles;

create policy "mauritania_profiles_admin_select"
on public.mauritania_profiles
for select
to authenticated
using (public.is_app_admin());

grant select on public.tunis_profiles to authenticated;
grant select on public.mauritania_profiles to authenticated;

revoke update (approved, rejected, reviewed_at, reviewed_by, updated_at)
on public.tunis_profiles from authenticated;

revoke update (approved, rejected, reviewed_at, reviewed_by, updated_at)
on public.mauritania_profiles from authenticated;

grant update (username, avatar_url, progress, updated_at)
on public.tunis_profiles to authenticated;

grant update (username, avatar_url, progress, updated_at)
on public.mauritania_profiles to authenticated;

create or replace function public.admin_review_profile(
  app_key text,
  profile_id uuid,
  next_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reviewer text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.is_app_admin() then
    raise exception 'Not an app admin' using errcode = '42501';
  end if;

  if next_status not in ('accepted', 'rejected', 'pending') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;

  if app_key = 'tunisia' then
    update public.tunis_profiles
    set approved = next_status = 'accepted',
        rejected = next_status = 'rejected',
        reviewed_at = now(),
        reviewed_by = reviewer,
        updated_at = now()
    where id = profile_id;
  elsif app_key = 'mauritania' then
    update public.mauritania_profiles
    set approved = next_status = 'accepted',
        rejected = next_status = 'rejected',
        reviewed_at = now(),
        reviewed_by = reviewer,
        updated_at = now()
    where id = profile_id;
  else
    raise exception 'Invalid app_key' using errcode = '22023';
  end if;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.admin_review_profile(text, uuid, text) to authenticated;

-- Optional: add more admins later.
-- insert into public.app_admins (email) values (lower('second-admin@example.com')) on conflict do nothing;
