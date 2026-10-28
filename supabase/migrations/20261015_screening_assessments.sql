create table if not exists public.screening_assessments (
 user_id text not null references public.users(id) on delete cascade,
 symbol text not null check(symbol ~ '^[A-Z0-9.^=-]{1,20}$'),
 report jsonb not null check(jsonb_typeof(report)='object' and report->>'ticker'=symbol and report->>'status' in ('pass','review','fail','unavailable')),
 assessed_at timestamptz not null,
 saved_at timestamptz not null default now(),
 primary key(user_id,symbol)
);
alter table public.screening_assessments enable row level security;
revoke all on public.screening_assessments from public,anon,authenticated;
grant select,insert,update on public.screening_assessments to service_role;

create or replace function public.save_screening_assessments(p_user_id text,p_results jsonb)
returns void language sql security definer set search_path='' as $$
 insert into public.screening_assessments(user_id,symbol,report,assessed_at)
 select p_user_id,item->>'ticker',item,(item->>'asOf')::timestamptz
 from jsonb_array_elements(p_results) item
 on conflict(user_id,symbol) do update
 set report=excluded.report,assessed_at=excluded.assessed_at,saved_at=now()
 where excluded.assessed_at>=screening_assessments.assessed_at;
$$;
revoke all on function public.save_screening_assessments(text,jsonb) from public,anon,authenticated;
grant execute on function public.save_screening_assessments(text,jsonb) to service_role;
notify pgrst,'reload schema';
