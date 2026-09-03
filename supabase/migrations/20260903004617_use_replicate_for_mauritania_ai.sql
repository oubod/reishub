-- Additive migration: keep every existing job and all Auth/profile data intact.
alter table public.mauritania_ai_jobs
  add column if not exists provider text not null default 'gemini',
  add column if not exists provider_job_id text,
  add column if not exists result_localized_at timestamptz;

do $$ begin
  alter table public.mauritania_ai_jobs
    add constraint mauritania_ai_jobs_provider_check
    check (provider in ('gemini', 'replicate', 'local'));
exception when duplicate_object then null;
end $$;

create unique index if not exists mauritania_ai_jobs_provider_job_idx
  on public.mauritania_ai_jobs(provider, provider_job_id)
  where provider_job_id is not null;

-- The legacy worker may finish older Gemini jobs, but must never claim Replicate jobs.
create or replace function public.claim_mauritania_ai_job()
returns setof public.mauritania_ai_jobs
language plpgsql
security definer
set search_path=public
as $$
declare claimed public.mauritania_ai_jobs;
begin
  select * into claimed
  from public.mauritania_ai_jobs
  where provider='gemini'
    and status in ('queued','processing','building_pdf')
    and cancel_requested=false
    and next_attempt_at<=now()
    and (lease_until is null or lease_until<now())
  order by created_at
  for update skip locked
  limit 1;

  if claimed.id is null then return; end if;

  update public.mauritania_ai_jobs
  set status='processing', stage='Génération des questions',
      started_at=coalesce(started_at,now()),
      lease_until=now()+interval '110 seconds', updated_at=now()
  where id=claimed.id
  returning * into claimed;

  return next claimed;
end $$;

revoke all on function public.claim_mauritania_ai_job() from public, anon, authenticated;
grant execute on function public.claim_mauritania_ai_job() to service_role;
