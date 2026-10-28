/* Accept the migrated multi-style checkpoint while retaining lease fencing. */
create or replace function public.paper_cloud_save(p_holder uuid,p_revision bigint,p_body jsonb,p_generation uuid default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
 if coalesce(p_body->>'version','') not in ('1','2') or jsonb_typeof(p_body->'tables') is distinct from 'object' then raise exception 'Invalid checkpoint'; end if;
 update public.paper_cloud_state set body=p_body,revision=revision+1,lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
 where id=1 and holder=p_holder and revision=p_revision and lease_until>clock_timestamp() and (p_generation is null or generation=p_generation)
 and not (body->>'version'='2' and p_body->>'version'='1')
 returning revision into v;
 if v is null then raise exception 'Paper lease lost or checkpoint downgrade blocked' using errcode='40001'; end if;
 return v;
end $$;
revoke all on function public.paper_cloud_save(uuid,bigint,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.paper_cloud_save(uuid,bigint,jsonb,uuid) to service_role;
