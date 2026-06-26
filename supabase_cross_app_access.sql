-- RésiHub cross-app account fix.
-- Run this once in the Supabase SQL editor after the main setup files.
-- Purpose:
--   * One Supabase Auth user can request both Tunis and Mauritania access.
--   * Approval is NOT shared. Each national app still needs its own admin/payment approval.

alter table public.tunis_profiles
  add column if not exists rejected boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists suspended_until timestamptz;

alter table public.mauritania_profiles
  add column if not exists rejected boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists suspended_until timestamptz;

drop policy if exists "tunis_profiles_insert_own" on public.tunis_profiles;
create policy "tunis_profiles_insert_own"
on public.tunis_profiles
for insert
to authenticated
with check (
  auth.uid() = id
  and approved = false
  and rejected = false
);

drop policy if exists "mauritania_profiles_insert_own" on public.mauritania_profiles;
create policy "mauritania_profiles_insert_own"
on public.mauritania_profiles
for insert
to authenticated
with check (
  auth.uid() = id
  and approved = false
  and rejected = false
);

create or replace function public.ensure_cross_app_profile(target_app text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  source_username text;
  source_avatar text;
  result_profile jsonb;
begin
  if current_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if target_app not in ('tunisia', 'mauritania') then
    raise exception 'Invalid target_app' using errcode = '22023';
  end if;

  select
    coalesce(
      nullif(tp.username, ''),
      nullif(mp.username, ''),
      split_part(current_email, '@', 1),
      'Utilisateur'
    ),
    coalesce(tp.avatar_url, mp.avatar_url)
  into source_username, source_avatar
  from (select 1) seed
  left join public.tunis_profiles tp on tp.id = current_user_id
  left join public.mauritania_profiles mp on mp.id = current_user_id;

  if target_app = 'tunisia' then
    insert into public.tunis_profiles (id, email, username, avatar_url, approved, rejected, progress)
    values (
      current_user_id,
      current_email,
      source_username,
      source_avatar,
      false,
      false,
      '{}'::jsonb
    )
    on conflict (id) do update
      set username = coalesce(nullif(public.tunis_profiles.username, ''), excluded.username),
          avatar_url = coalesce(public.tunis_profiles.avatar_url, excluded.avatar_url),
          updated_at = now()
    returning jsonb_build_object(
      'id', id,
      'email', email,
      'username', username,
      'avatar_url', avatar_url,
      'approved', approved,
      'rejected', rejected,
      'suspended_until', suspended_until,
      'progress', progress
    ) into result_profile;
  else
    insert into public.mauritania_profiles (id, email, username, avatar_url, approved, rejected, progress)
    values (
      current_user_id,
      current_email,
      source_username,
      source_avatar,
      false,
      false,
      '{}'::jsonb
    )
    on conflict (id) do update
      set username = coalesce(nullif(public.mauritania_profiles.username, ''), excluded.username),
          avatar_url = coalesce(public.mauritania_profiles.avatar_url, excluded.avatar_url),
          updated_at = now()
    returning jsonb_build_object(
      'id', id,
      'email', email,
      'username', username,
      'avatar_url', avatar_url,
      'approved', approved,
      'rejected', rejected,
      'suspended_until', suspended_until,
      'progress', progress
    ) into result_profile;
  end if;

  return result_profile;
end;
$$;

grant execute on function public.ensure_cross_app_profile(text) to authenticated;
