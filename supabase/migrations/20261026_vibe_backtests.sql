create table if not exists public.vibe_backtest_jobs (
  id uuid primary key,
  owner_id text not null,
  status text not null check (status in ('queued','running','completed','failed','cancelled')),
  stage text not null default 'Queued',
  request jsonb not null,
  result jsonb,
  error text,
  sandbox_name text,
  runner_started boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vibe_backtest_jobs_owner_created on public.vibe_backtest_jobs(owner_id, created_at desc);
alter table public.vibe_backtest_jobs enable row level security;
revoke all on public.vibe_backtest_jobs from anon, authenticated;
grant select, insert, update on public.vibe_backtest_jobs to service_role;

create or replace function public.vibe_backtest_create(p_id uuid, p_owner text, p_request jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare active_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_owner));
  select count(*) into active_count from public.vibe_backtest_jobs
    where owner_id = p_owner and status in ('queued','running');
  if active_count >= 1 then raise exception 'backtest_active_limit'; end if;
  insert into public.vibe_backtest_jobs(id, owner_id, status, stage, request)
    values (p_id, p_owner, 'queued', 'Queued', p_request);
end;
$$;
revoke all on function public.vibe_backtest_create(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.vibe_backtest_create(uuid,text,jsonb) to service_role;
