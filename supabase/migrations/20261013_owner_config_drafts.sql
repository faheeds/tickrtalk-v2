create table if not exists public.owner_config_drafts (
 id text primary key,
 config jsonb not null,
 updated_by text not null,
 updated_at timestamptz not null default now()
);
alter table public.owner_config_drafts enable row level security;
revoke all on public.owner_config_drafts from public, anon, authenticated;
grant select,insert,update on public.owner_config_drafts to service_role;
