-- Private durable paper checkpoint and fenced single-writer lease.
create table if not exists public.paper_cloud_state (
 id integer primary key check(id=1), revision bigint not null default 0,
 body jsonb not null default '{"version":1,"tables":{}}'::jsonb,
 holder uuid, lease_until timestamptz, generation uuid,
 updated_at timestamptz not null default now()
);
insert into public.paper_cloud_state(id) values(1) on conflict do nothing;
alter table public.paper_cloud_state enable row level security;
revoke all on public.paper_cloud_state from public, anon, authenticated;
grant select,update on public.paper_cloud_state to service_role;

create or replace function public.paper_cloud_claim(p_holder uuid,p_generation uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.paper_cloud_state;
begin
 if p_holder is null then raise exception 'Lease identity required'; end if;
 select * into r from public.paper_cloud_state where id=1 for update;
 if p_generation is not null and r.generation is distinct from p_generation then return jsonb_build_object('stopped',true); end if;
 if r.holder is not null and r.lease_until>clock_timestamp() then return jsonb_build_object('busy',true); end if;
 update public.paper_cloud_state set holder=p_holder,lease_until=clock_timestamp()+interval '120 seconds' where id=1 returning * into r;
 return jsonb_build_object('revision',r.revision,'body',r.body);
end $$;
create or replace function public.paper_cloud_save(p_holder uuid,p_revision bigint,p_body jsonb,p_generation uuid default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
 if p_body->>'version' is distinct from '1' or jsonb_typeof(p_body->'tables') is distinct from 'object' then raise exception 'Invalid checkpoint'; end if;
 update public.paper_cloud_state set body=p_body,revision=revision+1,lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
 where id=1 and holder=p_holder and revision=p_revision and lease_until>clock_timestamp() and (p_generation is null or generation=p_generation)
 returning revision into v;
 if v is null then raise exception 'Paper lease lost' using errcode='40001'; end if;
 return v;
end $$;
create or replace function public.paper_cloud_release(p_holder uuid)
returns void language sql security definer set search_path='' as $$
 update public.paper_cloud_state set holder=null,lease_until=null where id=1 and holder=p_holder;
$$;
revoke all on function public.paper_cloud_claim(uuid,uuid) from public,anon,authenticated;
revoke all on function public.paper_cloud_save(uuid,bigint,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.paper_cloud_release(uuid) from public,anon,authenticated;
grant execute on function public.paper_cloud_claim(uuid,uuid) to service_role;
grant execute on function public.paper_cloud_save(uuid,bigint,jsonb,uuid) to service_role;
grant execute on function public.paper_cloud_release(uuid) to service_role;

create table if not exists public.research_cloud_jobs (
 id uuid primary key, owner_id text not null, symbol text not null,
 analysis_date date not null, status text not null check(status in('queued','running','completed','failed','cancelled')),
 stage text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 saved boolean not null default false, report jsonb, error text, sandbox_name text,
 deadline timestamptz, runner_started boolean not null default false
);
create unique index if not exists research_cloud_one_active on public.research_cloud_jobs(owner_id) where status in('queued','running');
create index if not exists research_cloud_owner_created on public.research_cloud_jobs(owner_id,created_at desc);
alter table public.research_cloud_jobs enable row level security;
revoke all on public.research_cloud_jobs from public,anon,authenticated;
grant select,insert,update on public.research_cloud_jobs to service_role;
create or replace function public.research_cloud_create(p_id uuid,p_owner text,p_symbol text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(736492015);
 if p_owner is null or p_symbol !~ '^[A-Z][A-Z0-9.-]{0,19}$' then raise exception 'Invalid research request'; end if;
 if (select count(*) from public.research_cloud_jobs where status in('queued','running'))>=20 then raise exception 'Research queue is full'; end if;
 if (select count(*) from public.research_cloud_jobs where owner_id=p_owner and created_at >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')>=20 then raise exception 'Daily research limit reached'; end if;
 insert into public.research_cloud_jobs(id,owner_id,symbol,analysis_date,status,stage) values(p_id,p_owner,p_symbol,(clock_timestamp() at time zone 'UTC')::date,'queued','Waiting for an analyst');
end $$;
revoke all on function public.research_cloud_create(uuid,text,text) from public,anon,authenticated;
grant execute on function public.research_cloud_create(uuid,text,text) to service_role;
