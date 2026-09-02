-- File durable RésiHub Medical AI. À exécuter dans le SQL Editor Supabase.
create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.mauritania_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, source_name text not null, specialty text not null default '',
  question_count int not null check (question_count in (15,30,45)),
  question_type text not null check (question_type in ('qru','qrm','mixed')),
  status text not null default 'uploading' check (status in ('uploading','queued','processing','building_pdf','completed','failed','cancelling','cancelled')),
  stage text not null default 'Téléversement', progress int not null default 0 check (progress between 0 and 100),
  chunks_total int not null, chunks_completed int not null default 0,
  attempt_count int not null default 0, estimated_seconds int not null,
  input_path text not null, output_path text, gemini_file_name text,
  result jsonb, input_tokens bigint not null default 0, output_tokens bigint not null default 0,
  error_message text, cancel_requested boolean not null default false,
  next_attempt_at timestamptz not null default now(), lease_until timestamptz,
  started_at timestamptz, completed_at timestamptz, source_expires_at timestamptz, pdf_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.mauritania_ai_job_chunks (
  job_id uuid not null references public.mauritania_ai_jobs(id) on delete cascade,
  chunk_index int not null, questions jsonb not null,
  input_tokens bigint not null default 0, output_tokens bigint not null default 0,
  created_at timestamptz not null default now(), primary key(job_id,chunk_index)
);
create table if not exists public.mauritania_ai_job_secrets (
  job_id uuid primary key references public.mauritania_ai_jobs(id) on delete cascade,
  ciphertext text not null, iv text not null, created_at timestamptz not null default now()
);
create index if not exists mauritania_ai_jobs_claim_idx on public.mauritania_ai_jobs(status,next_attempt_at,lease_until);
create index if not exists mauritania_ai_jobs_user_idx on public.mauritania_ai_jobs(user_id,created_at desc);

create or replace function public.limit_mauritania_ai_jobs()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('uploading','queued','processing','building_pdf','cancelling')
     and (tg_op='INSERT' or old.status not in ('uploading','queued','processing','building_pdf','cancelling')) then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
    if (select count(*) from public.mauritania_ai_jobs where user_id=new.user_id and id<>new.id and status in ('uploading','queued','processing','building_pdf','cancelling')) >= 3 then
      raise exception 'Trois générations sont déjà en cours.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists limit_mauritania_ai_jobs_trigger on public.mauritania_ai_jobs;
create trigger limit_mauritania_ai_jobs_trigger before insert or update of status on public.mauritania_ai_jobs for each row execute function public.limit_mauritania_ai_jobs();

alter table public.mauritania_ai_jobs enable row level security;
alter table public.mauritania_ai_job_chunks enable row level security;
alter table public.mauritania_ai_job_secrets enable row level security;
drop policy if exists "users read own ai jobs" on public.mauritania_ai_jobs;
create policy "users read own ai jobs" on public.mauritania_ai_jobs for select to authenticated using (auth.uid()=user_id);
revoke all on public.mauritania_ai_job_secrets from anon, authenticated;
revoke all on public.mauritania_ai_job_chunks from anon, authenticated;
grant select on public.mauritania_ai_jobs to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('mauritania-ai-inputs','mauritania-ai-inputs',false,20971520,array['application/pdf']),
 ('mauritania-ai-outputs','mauritania-ai-outputs',false,20971520,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.claim_mauritania_ai_job()
returns setof public.mauritania_ai_jobs language plpgsql security definer set search_path=public as $$
declare claimed public.mauritania_ai_jobs;
begin
  select * into claimed from public.mauritania_ai_jobs
  where status in ('queued','processing','building_pdf') and next_attempt_at<=now()
    and (lease_until is null or lease_until<now())
  order by created_at for update skip locked limit 1;
  if claimed.id is null then return; end if;
  update public.mauritania_ai_jobs set status='processing',stage='Génération des questions',
    started_at=coalesce(started_at,now()),lease_until=now()+interval '110 seconds',updated_at=now()
  where id=claimed.id returning * into claimed;
  return next claimed;
end $$;
revoke all on function public.claim_mauritania_ai_job() from public,anon,authenticated;
grant execute on function public.claim_mauritania_ai_job() to service_role;

do $$ begin
  alter publication supabase_realtime add table public.mauritania_ai_jobs;
exception when duplicate_object then null; end $$;

-- Enregistrer d’abord AI_WORKER_TOKEN dans Vault sous mauritania_ai_worker_token.
select cron.unschedule(jobid) from cron.job where jobname='mauritania-ai-worker';
select cron.schedule('mauritania-ai-worker','* * * * *',$$
select net.http_post(url:='https://rsnbcgrtrjfvnoczildf.supabase.co/functions/v1/mauritania-ai-worker',
headers:=jsonb_build_object('content-type','application/json','x-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='mauritania_ai_worker_token' limit 1)),body:='{}')$$);
