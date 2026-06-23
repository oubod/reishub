-- Supabase setup for the Mauritania portal
-- Run this in the Supabase SQL editor before using residanat-mauritania/login.html.

create table if not exists public.mauritania_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null,
  avatar_url text,
  approved boolean not null default false,
  progress jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mauritania_profiles_email_idx on public.mauritania_profiles (lower(email));
create index if not exists mauritania_profiles_approved_idx on public.mauritania_profiles (approved);

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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mauritania_profiles_set_updated_at on public.mauritania_profiles;
create trigger mauritania_profiles_set_updated_at
before update on public.mauritania_profiles
for each row execute function public.set_updated_at();

alter table public.mauritania_profiles enable row level security;

drop policy if exists "mauritania_profiles_select_own" on public.mauritania_profiles;
drop policy if exists "mauritania_profiles_insert_own" on public.mauritania_profiles;
drop policy if exists "mauritania_profiles_update_own_progress" on public.mauritania_profiles;

create policy "mauritania_profiles_select_own"
on public.mauritania_profiles
for select
to authenticated
using (auth.uid() = id);

create policy "mauritania_profiles_insert_own"
on public.mauritania_profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "mauritania_profiles_update_own_progress"
on public.mauritania_profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

grant usage on schema public to anon, authenticated;
revoke update on public.mauritania_profiles from authenticated;
grant select, insert on public.mauritania_profiles to authenticated;
grant update (username, avatar_url, progress, updated_at) on public.mauritania_profiles to authenticated;

-- After a user signs up, approve them with:
-- update public.mauritania_profiles set approved = true where email = 'student@example.com';

-- Check pending accounts:
-- select id, email, username, approved, created_at from public.mauritania_profiles order by created_at desc;
