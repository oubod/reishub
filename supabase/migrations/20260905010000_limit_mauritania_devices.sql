create table if not exists public.mauritania_active_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (char_length(device_id) between 16 and 128),
  device_label text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create index if not exists mauritania_active_sessions_user_seen_idx
  on public.mauritania_active_sessions (user_id, last_seen_at desc);

alter table public.mauritania_active_sessions enable row level security;
revoke all on table public.mauritania_active_sessions from anon, authenticated;

create or replace function public.mauritania_register_session(
  p_device_id text,
  p_device_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  device_exists boolean;
  active_count integer;
begin
  if current_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_device_id is null or char_length(p_device_id) < 16 or char_length(p_device_id) > 128 then
    raise exception 'Invalid device' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  delete from public.mauritania_active_sessions
  where user_id = current_user_id
    and last_seen_at < now() - interval '10 minutes';

  select exists(
    select 1 from public.mauritania_active_sessions
    where user_id = current_user_id and device_id = p_device_id
  ) into device_exists;

  if device_exists then
    update public.mauritania_active_sessions
    set last_seen_at = now(),
        device_label = coalesce(nullif(left(p_device_label, 80), ''), device_label)
    where user_id = current_user_id and device_id = p_device_id;
  else
    select count(*) into active_count
    from public.mauritania_active_sessions
    where user_id = current_user_id;

    if active_count >= 2 then
      return jsonb_build_object(
        'allowed', false,
        'active_count', active_count,
        'max_devices', 2
      );
    end if;

    insert into public.mauritania_active_sessions (user_id, device_id, device_label)
    values (current_user_id, p_device_id, nullif(left(p_device_label, 80), ''));
  end if;

  select count(*) into active_count
  from public.mauritania_active_sessions
  where user_id = current_user_id;

  return jsonb_build_object(
    'allowed', true,
    'active_count', active_count,
    'max_devices', 2
  );
end;
$$;

create or replace function public.mauritania_release_session(p_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  delete from public.mauritania_active_sessions
  where user_id = auth.uid() and device_id = p_device_id;
end;
$$;

revoke execute on function public.mauritania_register_session(text, text) from public, anon;
grant execute on function public.mauritania_register_session(text, text) to authenticated;
revoke execute on function public.mauritania_release_session(text) from public, anon;
grant execute on function public.mauritania_release_session(text) to authenticated;
