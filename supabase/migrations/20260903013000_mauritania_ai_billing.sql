-- Mauritania AI credits, manual Bankily sales, and admin reporting.
create extension if not exists pgcrypto;

alter table public.mauritania_ai_jobs
  add column if not exists billing_status text not null default 'unbilled',
  add column if not exists credit_grant_id uuid,
  add column if not exists credit_reserved_at timestamptz,
  add column if not exists credit_consumed_at timestamptz,
  add column if not exists credit_released_at timestamptz,
  add column if not exists cost_mru numeric(12,2);

do $$ begin
  alter table public.mauritania_ai_jobs add constraint mauritania_ai_jobs_billing_status_check
    check (billing_status in ('unbilled','reserved','consumed','released'));
exception when duplicate_object then null;
end $$;

create table if not exists public.mauritania_ai_billing_settings (
  id boolean primary key default true check (id),
  bankily_number text not null default '026787',
  whatsapp_number text not null default '22243265506',
  credit_system_enabled boolean not null default true,
  cost_per_pdf_mru numeric(12,2) not null default 20 check (cost_per_pdf_mru >= 0),
  updated_at timestamptz not null default now()
);
insert into public.mauritania_ai_billing_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.mauritania_ai_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pdf_credits integer not null check (pdf_credits > 0),
  price_mru numeric(12,2) not null check (price_mru >= 0),
  validity_days integer not null check (validity_days > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.mauritania_ai_packages (name, pdf_credits, price_mru, validity_days, is_active)
select 'Pack lancement · 30 PDF', 30, 200, 30, true
where not exists (select 1 from public.mauritania_ai_packages);

create table if not exists public.mauritania_ai_payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  package_id uuid references public.mauritania_ai_packages(id) on delete set null,
  package_name text not null,
  pdf_credits integer not null check (pdf_credits > 0),
  validity_days integer not null check (validity_days > 0),
  amount_mru numeric(12,2) not null check (amount_mru >= 0),
  payment_method text not null default 'bankily' check (payment_method = 'bankily'),
  bankily_reference text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mauritania_ai_payment_requests_status_idx on public.mauritania_ai_payment_requests(status, created_at desc);
create index if not exists mauritania_ai_payment_requests_user_idx on public.mauritania_ai_payment_requests(user_id, created_at desc);

create table if not exists public.mauritania_ai_credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_request_id uuid references public.mauritania_ai_payment_requests(id) on delete set null,
  credits_total integer not null check (credits_total > 0),
  credits_reserved integer not null default 0 check (credits_reserved >= 0),
  credits_consumed integer not null default 0 check (credits_consumed >= 0),
  credits_expired integer not null default 0 check (credits_expired >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (credits_reserved + credits_consumed + credits_expired <= credits_total)
);
create index if not exists mauritania_ai_credit_grants_user_idx on public.mauritania_ai_credit_grants(user_id, expires_at);
alter table public.mauritania_ai_jobs
  add constraint mauritania_ai_jobs_credit_grant_fk foreign key (credit_grant_id)
  references public.mauritania_ai_credit_grants(id) on delete set null;

create table if not exists public.mauritania_ai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  grant_id uuid references public.mauritania_ai_credit_grants(id) on delete set null,
  payment_request_id uuid references public.mauritania_ai_payment_requests(id) on delete set null,
  job_id uuid references public.mauritania_ai_jobs(id) on delete set null,
  event text not null check (event in ('purchase','reserve','consume','release','expire','refund','adjustment')),
  credits integer not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists mauritania_ai_credit_ledger_user_idx on public.mauritania_ai_credit_ledger(user_id, created_at desc);

drop trigger if exists mauritania_ai_billing_settings_updated_at on public.mauritania_ai_billing_settings;
create trigger mauritania_ai_billing_settings_updated_at before update on public.mauritania_ai_billing_settings for each row execute function public.set_updated_at();
drop trigger if exists mauritania_ai_packages_updated_at on public.mauritania_ai_packages;
create trigger mauritania_ai_packages_updated_at before update on public.mauritania_ai_packages for each row execute function public.set_updated_at();
drop trigger if exists mauritania_ai_payment_requests_updated_at on public.mauritania_ai_payment_requests;
create trigger mauritania_ai_payment_requests_updated_at before update on public.mauritania_ai_payment_requests for each row execute function public.set_updated_at();

alter table public.mauritania_ai_billing_settings enable row level security;
alter table public.mauritania_ai_packages enable row level security;
alter table public.mauritania_ai_payment_requests enable row level security;
alter table public.mauritania_ai_credit_grants enable row level security;
alter table public.mauritania_ai_credit_ledger enable row level security;

drop policy if exists "ai packages public active read" on public.mauritania_ai_packages;
create policy "ai packages public active read" on public.mauritania_ai_packages for select to authenticated using (is_active or public.is_app_admin());
drop policy if exists "ai billing settings admin read" on public.mauritania_ai_billing_settings;
create policy "ai billing settings admin read" on public.mauritania_ai_billing_settings for select to authenticated using (public.is_app_admin());
drop policy if exists "ai payment requests owner read" on public.mauritania_ai_payment_requests;
create policy "ai payment requests owner read" on public.mauritania_ai_payment_requests for select to authenticated using ((select auth.uid()) = user_id or public.is_app_admin());
drop policy if exists "ai credit grants owner read" on public.mauritania_ai_credit_grants;
create policy "ai credit grants owner read" on public.mauritania_ai_credit_grants for select to authenticated using ((select auth.uid()) = user_id or public.is_app_admin());
drop policy if exists "ai credit ledger owner read" on public.mauritania_ai_credit_ledger;
create policy "ai credit ledger owner read" on public.mauritania_ai_credit_ledger for select to authenticated using ((select auth.uid()) = user_id or public.is_app_admin());

revoke all on public.mauritania_ai_billing_settings from anon, authenticated;
revoke all on public.mauritania_ai_packages from anon, authenticated;
revoke all on public.mauritania_ai_payment_requests from anon, authenticated;
revoke all on public.mauritania_ai_credit_grants from anon, authenticated;
revoke all on public.mauritania_ai_credit_ledger from anon, authenticated;
grant select on public.mauritania_ai_packages to authenticated;
grant select on public.mauritania_ai_payment_requests, public.mauritania_ai_credit_grants, public.mauritania_ai_credit_ledger to authenticated;

create or replace function public.expire_mauritania_ai_credits(p_user_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare g record; available integer;
begin
  for g in
    select * from public.mauritania_ai_credit_grants
    where (p_user_id is null or user_id = p_user_id) and expires_at <= now()
    for update
  loop
    available := greatest(g.credits_total - g.credits_reserved - g.credits_consumed - g.credits_expired, 0);
    if available > 0 then
      update public.mauritania_ai_credit_grants set credits_expired = credits_expired + available where id = g.id;
      insert into public.mauritania_ai_credit_ledger(user_id, grant_id, event, credits, note)
      values (g.user_id, g.id, 'expire', -available, 'Crédits arrivés à expiration');
    end if;
  end loop;
end;
$$;

create or replace function public.reserve_mauritania_ai_credit(p_user_id uuid, p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.mauritania_ai_credit_grants; job_user uuid;
begin
  perform public.expire_mauritania_ai_credits(p_user_id);
  select user_id into job_user from public.mauritania_ai_jobs where id = p_job_id;
  if job_user is distinct from p_user_id then raise exception 'Génération invalide.' using errcode = '42501'; end if;
  select * into g from public.mauritania_ai_credit_grants
  where user_id = p_user_id and expires_at > now()
    and credits_total - credits_reserved - credits_consumed - credits_expired > 0
  order by expires_at, created_at for update skip locked limit 1;
  if not found then raise exception 'Crédits IA insuffisants.' using errcode = 'P0001'; end if;
  update public.mauritania_ai_credit_grants set credits_reserved = credits_reserved + 1 where id = g.id;
  update public.mauritania_ai_jobs set billing_status = 'reserved', credit_grant_id = g.id, credit_reserved_at = now(), updated_at = now()
    where id = p_job_id and user_id = p_user_id and billing_status = 'unbilled';
  if not found then
    update public.mauritania_ai_credit_grants set credits_reserved = credits_reserved - 1 where id = g.id;
    raise exception 'Génération déjà facturée.' using errcode = '23505';
  end if;
  insert into public.mauritania_ai_credit_ledger(user_id, grant_id, job_id, event, credits, note)
    values (p_user_id, g.id, p_job_id, 'reserve', 0, 'Crédit réservé pour une génération');
  return jsonb_build_object('grant_id', g.id, 'expires_at', g.expires_at);
end;
$$;

create or replace function public.consume_mauritania_ai_credit(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare j public.mauritania_ai_jobs; g public.mauritania_ai_credit_grants; cost numeric;
begin
  select * into j from public.mauritania_ai_jobs where id = p_job_id for update;
  if not found then return false; end if;
  if j.billing_status = 'consumed' then return true; end if;
  if j.billing_status <> 'reserved' or j.credit_grant_id is null then return false; end if;
  select * into g from public.mauritania_ai_credit_grants where id = j.credit_grant_id for update;
  if not found or g.credits_reserved < 1 then return false; end if;
  select cost_per_pdf_mru into cost from public.mauritania_ai_billing_settings where id = true;
  update public.mauritania_ai_credit_grants set credits_reserved = credits_reserved - 1, credits_consumed = credits_consumed + 1 where id = g.id;
  insert into public.mauritania_ai_credit_ledger(user_id, grant_id, job_id, event, credits, note)
    values (j.user_id, g.id, j.id, 'consume', -1, 'PDF IA terminé');
  update public.mauritania_ai_jobs set billing_status = 'consumed', credit_consumed_at = now(), cost_mru = coalesce(cost, 0), updated_at = now() where id = j.id;
  return true;
end;
$$;

create or replace function public.release_mauritania_ai_credit(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare j public.mauritania_ai_jobs; g public.mauritania_ai_credit_grants;
begin
  select * into j from public.mauritania_ai_jobs where id = p_job_id for update;
  if not found or j.billing_status = 'released' or j.billing_status = 'unbilled' then return true; end if;
  select * into g from public.mauritania_ai_credit_grants where id = j.credit_grant_id for update;
  if found then
    if g.expires_at <= now() then
      update public.mauritania_ai_credit_grants set credits_reserved = credits_reserved - 1, credits_expired = credits_expired + 1 where id = g.id;
      insert into public.mauritania_ai_credit_ledger(user_id, grant_id, job_id, event, credits, note) values (j.user_id, g.id, j.id, 'expire', -1, 'Réservation expirée');
    else
      update public.mauritania_ai_credit_grants set credits_reserved = credits_reserved - 1 where id = g.id;
      insert into public.mauritania_ai_credit_ledger(user_id, grant_id, job_id, event, credits, note) values (j.user_id, g.id, j.id, 'release', 1, 'Génération annulée ou échouée');
    end if;
  end if;
  update public.mauritania_ai_jobs set billing_status = 'released', credit_released_at = now(), updated_at = now() where id = j.id;
  return true;
end;
$$;

create or replace function public.admin_review_mauritania_ai_payment(p_payment_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.mauritania_ai_payment_requests; reviewer text := lower(coalesce(auth.jwt() ->> 'email', ''));
declare grant_id uuid;
begin
  if not public.is_app_admin() then raise exception 'Not an app admin' using errcode = '42501'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Invalid payment status' using errcode = '22023'; end if;
  select * into r from public.mauritania_ai_payment_requests where id = p_payment_id for update;
  if not found then raise exception 'Payment request not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then return; end if;
  update public.mauritania_ai_payment_requests set status = p_status, reviewed_by = reviewer, reviewed_at = now(), updated_at = now() where id = r.id;
  if p_status = 'approved' then
    insert into public.mauritania_ai_credit_grants(user_id, payment_request_id, credits_total, expires_at)
      values (r.user_id, r.id, r.pdf_credits, now() + (r.validity_days || ' days')::interval) returning id into grant_id;
    insert into public.mauritania_ai_credit_ledger(user_id, grant_id, payment_request_id, event, credits, note)
      values (r.user_id, grant_id, r.id, 'purchase', r.pdf_credits, 'Pack acheté via Bankily');
  end if;
end;
$$;

create or replace function public.admin_upsert_mauritania_ai_package(
  p_id uuid, p_name text, p_pdf_credits integer, p_price_mru numeric, p_validity_days integer, p_is_active boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid;
begin
  if not public.is_app_admin() then raise exception 'Not an app admin' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.mauritania_ai_packages(name, pdf_credits, price_mru, validity_days, is_active)
      values (trim(p_name), p_pdf_credits, p_price_mru, p_validity_days, p_is_active) returning id into result_id;
  else
    update public.mauritania_ai_packages set name = trim(p_name), pdf_credits = p_pdf_credits, price_mru = p_price_mru, validity_days = p_validity_days, is_active = p_is_active, updated_at = now() where id = p_id returning id into result_id;
    if result_id is null then raise exception 'Package not found' using errcode = 'P0002'; end if;
  end if;
  return result_id;
end;
$$;

create or replace function public.admin_update_mauritania_ai_settings(p_bankily_number text, p_whatsapp_number text, p_cost_per_pdf_mru numeric, p_credit_system_enabled boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Not an app admin' using errcode = '42501'; end if;
  update public.mauritania_ai_billing_settings set bankily_number = trim(p_bankily_number), whatsapp_number = trim(p_whatsapp_number), cost_per_pdf_mru = p_cost_per_pdf_mru, credit_system_enabled = p_credit_system_enabled, updated_at = now() where id = true;
end;
$$;

create or replace function public.admin_adjust_mauritania_ai_credits(p_user_id uuid, p_credits integer, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare grant_id uuid;
begin
  if not public.is_app_admin() then raise exception 'Not an app admin' using errcode = '42501'; end if;
  if p_credits = 0 then raise exception 'Adjustment cannot be zero'; end if;
  insert into public.mauritania_ai_credit_grants(user_id, credits_total, expires_at) values (p_user_id, abs(p_credits), now() + interval '30 days') returning id into grant_id;
  if p_credits < 0 then update public.mauritania_ai_credit_grants set credits_expired = credits_total where id = grant_id; end if;
  insert into public.mauritania_ai_credit_ledger(user_id, grant_id, event, credits, note) values (p_user_id, grant_id, 'adjustment', p_credits, trim(p_note));
end;
$$;

create or replace function public.admin_mauritania_ai_billing_dashboard(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cutoff timestamptz := now() - (greatest(1, least(coalesce(p_days, 30), 365)) || ' days')::interval; result jsonb;
begin
  if not public.is_app_admin() then raise exception 'Not an app admin' using errcode = '42501'; end if;
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'revenue_mru', coalesce((select sum(amount_mru) from public.mauritania_ai_payment_requests where status = 'approved' and reviewed_at >= cutoff), 0),
      'cost_mru', coalesce((select sum(cost_mru) from public.mauritania_ai_jobs where status = 'completed' and completed_at >= cutoff), 0),
      'completed_pdfs', (select count(*) from public.mauritania_ai_jobs where status = 'completed' and completed_at >= cutoff),
      'active_customers', (select count(distinct user_id) from public.mauritania_ai_jobs where status = 'completed' and completed_at >= cutoff),
      'pending_payments', (select count(*) from public.mauritania_ai_payment_requests where status = 'pending'),
      'expiring_credits', (select coalesce(sum(credits_total - credits_reserved - credits_consumed - credits_expired), 0) from public.mauritania_ai_credit_grants where expires_at > now() and expires_at <= now() + interval '7 days')
    ),
    'trend', coalesce((select jsonb_agg(to_jsonb(t)) from (
      select series.day_value::date as date_key,
        coalesce((select sum(amount_mru) from public.mauritania_ai_payment_requests where status = 'approved' and reviewed_at::date = series.day_value::date), 0) revenue_mru,
        coalesce((select sum(cost_mru) from public.mauritania_ai_jobs where status = 'completed' and completed_at::date = series.day_value::date), 0) cost_mru
      from generate_series(cutoff::date, current_date, interval '1 day') as series(day_value)
    ) t), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(t)) from (
      select r.id, r.user_id, coalesce(p.username, p.email) customer, p.email, r.package_name, r.pdf_credits, r.validity_days, r.amount_mru, r.bankily_reference, r.status, r.reviewed_by, r.reviewed_at, r.created_at
      from public.mauritania_ai_payment_requests r left join public.mauritania_profiles p on p.id = r.user_id where r.created_at >= cutoff
    ) t), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(to_jsonb(t)) from (
      select p.id user_id, p.username, p.email,
        coalesce((select sum(r.amount_mru) from public.mauritania_ai_payment_requests r where r.user_id = p.id and r.status = 'approved'), 0) revenue_mru,
        coalesce((select sum(g.credits_total) from public.mauritania_ai_credit_grants g where g.user_id = p.id), 0) purchased_credits,
        coalesce((select sum(g.credits_consumed) from public.mauritania_ai_credit_grants g where g.user_id = p.id), 0) used_credits,
        coalesce((select sum(greatest(g.credits_total - g.credits_reserved - g.credits_consumed - g.credits_expired, 0)) from public.mauritania_ai_credit_grants g where g.user_id = p.id and g.expires_at > now()), 0) remaining_credits,
        (select min(g.expires_at) from public.mauritania_ai_credit_grants g where g.user_id = p.id and g.expires_at > now() and g.credits_total > g.credits_reserved + g.credits_consumed + g.credits_expired) earliest_expiry,
        coalesce((select sum(j.cost_mru) from public.mauritania_ai_jobs j where j.user_id = p.id and j.status = 'completed'), 0) cost_mru,
        coalesce((select sum(r.amount_mru) from public.mauritania_ai_payment_requests r where r.user_id = p.id and r.status = 'approved'), 0) - coalesce((select sum(j.cost_mru) from public.mauritania_ai_jobs j where j.user_id = p.id and j.status = 'completed'), 0) profit_mru
      from public.mauritania_profiles p where exists (select 1 from public.mauritania_ai_payment_requests r where r.user_id = p.id) or exists (select 1 from public.mauritania_ai_jobs j where j.user_id = p.id and j.created_at >= cutoff)
    ) t), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(to_jsonb(t)) from (
      select j.id, j.user_id, coalesce(p.username, p.email) customer, j.title, j.question_count, j.question_type, j.provider, j.status, j.billing_status, j.cost_mru, j.created_at, j.completed_at
      from public.mauritania_ai_jobs j left join public.mauritania_profiles p on p.id = j.user_id where j.created_at >= cutoff
    ) t), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(to_jsonb(p)) from public.mauritania_ai_packages p), '[]'::jsonb),
    'settings', (select to_jsonb(s) from public.mauritania_ai_billing_settings s where id = true)
  ) into result;
  return result;
end;
$$;

revoke execute on function public.admin_review_mauritania_ai_payment(uuid, text), public.admin_upsert_mauritania_ai_package(uuid, text, integer, numeric, integer, boolean), public.admin_update_mauritania_ai_settings(text, text, numeric, boolean), public.admin_adjust_mauritania_ai_credits(uuid, integer, text), public.admin_mauritania_ai_billing_dashboard(integer) from public, anon;
grant execute on function public.admin_review_mauritania_ai_payment(uuid, text), public.admin_upsert_mauritania_ai_package(uuid, text, integer, numeric, integer, boolean), public.admin_update_mauritania_ai_settings(text, text, numeric, boolean), public.admin_adjust_mauritania_ai_credits(uuid, integer, text), public.admin_mauritania_ai_billing_dashboard(integer) to authenticated;
revoke execute on function public.reserve_mauritania_ai_credit(uuid, uuid), public.consume_mauritania_ai_credit(uuid), public.release_mauritania_ai_credit(uuid), public.expire_mauritania_ai_credits(uuid) from public, anon, authenticated;
grant execute on function public.reserve_mauritania_ai_credit(uuid, uuid), public.consume_mauritania_ai_credit(uuid), public.release_mauritania_ai_credit(uuid), public.expire_mauritania_ai_credits(uuid) to service_role;
