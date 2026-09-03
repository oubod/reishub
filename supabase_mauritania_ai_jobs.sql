-- RésiHub Medical AI avec Replicate.
-- Schéma additif : ce fichier ne supprime ni utilisateur, ni profil, ni donnée existante.
create extension if not exists pgcrypto;

create table if not exists public.mauritania_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_name text not null,
  specialty text not null default '',
  question_count int not null check (question_count in (15,30,45)),
  question_type text not null check (question_type in ('qru','qrm','mixed')),
  status text not null default 'queued' check (status in ('uploading','queued','processing','building_pdf','completed','failed','cancelling','cancelled')),
  stage text not null default 'En attente',
  progress int not null default 0 check (progress between 0 and 100),
  chunks_total int not null default 1,
  chunks_completed int not null default 0,
  attempt_count int not null default 0,
  estimated_seconds int not null default 120,
  input_path text not null default 'local',
  output_path text,
  gemini_file_name text,
  result jsonb,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  error_message text,
  cancel_requested boolean not null default false,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  source_expires_at timestamptz,
  pdf_expires_at timestamptz,
  provider text not null default 'replicate',
  provider_job_id text,
  result_localized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mauritania_ai_jobs
  add column if not exists provider text not null default 'gemini',
  add column if not exists provider_job_id text,
  add column if not exists result_localized_at timestamptz;

do $$ begin
  alter table public.mauritania_ai_jobs add constraint mauritania_ai_jobs_provider_check
    check (provider in ('gemini','replicate','local'));
exception when duplicate_object then null;
end $$;

create index if not exists mauritania_ai_jobs_user_idx on public.mauritania_ai_jobs(user_id,created_at desc);
create unique index if not exists mauritania_ai_jobs_provider_job_idx on public.mauritania_ai_jobs(provider,provider_job_id) where provider_job_id is not null;

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
drop policy if exists "users read own ai jobs" on public.mauritania_ai_jobs;
create policy "users read own ai jobs" on public.mauritania_ai_jobs for select to authenticated using ((select auth.uid())=user_id);
grant select on public.mauritania_ai_jobs to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.mauritania_ai_jobs;
exception when duplicate_object then null; end $$;

-- Définir REPLICATE_API_TOKEN dans Edge Functions > Secrets,
-- puis déployer mauritania-ai-jobs avec la vérification JWT désactivée.
