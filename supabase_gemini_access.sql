-- Run once in the Supabase SQL editor after supabase_admin.sql.
-- Gemini access is Mauritania-only and locked for every account by default.

alter table public.mauritania_profiles
  add column if not exists gemini_enabled boolean not null default false;

revoke update (gemini_enabled) on public.mauritania_profiles from authenticated;

create or replace function public.admin_set_gemini_access(
  profile_id uuid,
  enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_rows integer;
begin
  if not public.is_app_admin() then
    raise exception 'Not an app admin' using errcode = '42501';
  end if;

  update public.mauritania_profiles
  set gemini_enabled = enabled,
      updated_at = now()
  where id = profile_id;

  get diagnostics changed_rows = row_count;
  if changed_rows = 0 then
    raise exception 'Mauritania profile not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_set_gemini_access(uuid, boolean) from public;
grant execute on function public.admin_set_gemini_access(uuid, boolean) to authenticated;
