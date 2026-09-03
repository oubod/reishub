create or replace function public.claim_mauritania_ai_job()
returns setof public.mauritania_ai_jobs
language plpgsql
security definer
set search_path=public
as $$
declare claimed public.mauritania_ai_jobs;
begin
  select * into claimed from public.mauritania_ai_jobs
  where status in ('queued','processing','building_pdf')
    and cancel_requested=false
    and next_attempt_at<=now()
    and (lease_until is null or lease_until<now())
  order by created_at for update skip locked limit 1;
  if claimed.id is null then return; end if;
  update public.mauritania_ai_jobs set status='processing',stage='Génération des questions',
    started_at=coalesce(started_at,now()),lease_until=now()+interval '110 seconds',updated_at=now()
  where id=claimed.id returning * into claimed;
  return next claimed;
end $$;
