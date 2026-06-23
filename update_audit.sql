-- Table for user login & session auditing
create table if not exists public.user_session_audit (
  id uuid default gen_random_uuid() primary key,
  profile_id uuid not null,
  app_key text not null, -- 'tunisia' or 'mauritania'
  email text not null,
  ip_address text not null,
  latitude double precision,
  longitude double precision,
  user_agent text,
  created_at timestamptz default now() not null
);

-- Index audit logs for performance
create index if not exists user_session_audit_profile_idx on public.user_session_audit(profile_id);
create index if not exists user_session_audit_created_idx on public.user_session_audit(created_at desc);

-- Add suspension columns to profile tables
alter table public.tunis_profiles add column if not exists suspended_until timestamptz;
alter table public.mauritania_profiles add column if not exists suspended_until timestamptz;

-- Function for admins to fetch login audits
create or replace function public.get_login_audit_logs()
returns table (
  id uuid,
  profile_id uuid,
  app_key text,
  email text,
  ip_address text,
  latitude double precision,
  longitude double precision,
  user_agent text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Not an app admin' using errcode = '42501';
  end if;

  return query
  select a.id, a.profile_id, a.app_key, a.email, a.ip_address, a.latitude, a.longitude, a.user_agent, a.created_at
  from public.user_session_audit a
  order by a.created_at desc
  limit 1000;
end;
$$;

-- Function for admins to suspend / unsuspend accounts
create or replace function public.admin_set_suspension(
  app_key text,
  profile_id uuid,
  suspended_until timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Not an app admin' using errcode = '42501';
  end if;

  if app_key = 'tunisia' then
    update public.tunis_profiles
    set suspended_until = admin_set_suspension.suspended_until,
        updated_at = now()
    where id = profile_id;
  elsif app_key = 'mauritania' then
    update public.mauritania_profiles
    set suspended_until = admin_set_suspension.suspended_until,
        updated_at = now()
    where id = profile_id;
  else
    raise exception 'Invalid app_key' using errcode = '22023';
  end if;
end;
$$;

-- Function to record a login event
create or replace function public.log_user_login(
  app_key text,
  ip_address text,
  latitude double precision,
  longitude double precision,
  user_agent text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  curr_user_id uuid := auth.uid();
  curr_email text := auth.jwt() ->> 'email';
begin
  if curr_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.user_session_audit (profile_id, app_key, email, ip_address, latitude, longitude, user_agent)
  values (curr_user_id, app_key, curr_email, ip_address, latitude, longitude, user_agent);
end;
$$;

grant execute on function public.get_login_audit_logs() to authenticated;
grant execute on function public.admin_set_suspension(text, uuid, timestamptz) to authenticated;
grant execute on function public.log_user_login(text, text, double precision, double precision, text) to authenticated;

-- Settings table for global app configs (like contact numbers)
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

-- Default setting
insert into public.app_settings (key, value)
values ('whatsapp_number', '27265400')
on conflict (key) do nothing;

-- Enable public read, admin write/update
alter table public.app_settings enable row level security;

drop policy if exists "Allow public read access to app_settings" on public.app_settings;
create policy "Allow public read access to app_settings"
  on public.app_settings for select using (true);

drop policy if exists "Allow admins to modify app_settings" on public.app_settings;
create policy "Allow admins to modify app_settings"
  on public.app_settings for all using (public.is_app_admin());

-- RPC to update settings for ease of use
create or replace function public.admin_update_setting(
  setting_key text,
  setting_val text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Not an app admin' using errcode = '42501';
  end if;

  insert into public.app_settings (key, value)
  values (setting_key, setting_val)
  on conflict (key) do update set value = setting_val;
end;
$$;

grant execute on function public.admin_update_setting(text, text) to authenticated;
