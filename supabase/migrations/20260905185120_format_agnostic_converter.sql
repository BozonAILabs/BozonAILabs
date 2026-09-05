-- Document-driven processing; no bank-name allowlist. Preserve the operator off switch.
alter table public.converter_settings drop column validated_banks;
update public.converter_settings set api_version=2 where id;
alter table public.conversions alter column engine_version set default '1.1.0';

create table public.converter_help_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  job_id uuid references public.conversions on delete set null,
  share_statement boolean not null default false,
  statement_access_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,job_id),
  check ((share_statement and statement_access_until is not null) or
    (not share_statement and statement_access_until is null))
);
create index on public.converter_help_requests(job_id);
alter table public.converter_help_requests enable row level security;
revoke all on public.converter_help_requests from anon,authenticated;
grant select on public.converter_help_requests to authenticated;
create policy own_help_requests on public.converter_help_requests for select to authenticated
using ((select auth.uid())=user_id);
grant all on public.converter_help_requests to service_role;

create or replace function public.converter_command(op text, uid uuid, jid uuid default null, args jsonb default '{}') returns jsonb
language plpgsql set search_path = '' as $$
declare j public.conversions; remaining int; prior uuid; payload jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  if op='profile' then
    if coalesce(args->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'PROFILE_REQUIRED'; end if;
    insert into public.converter_profiles(user_id,name,practice,email) values(uid,args->>'name',args->>'practice',lower(args->>'email'))
    on conflict(user_id) do update set name=excluded.name,practice=excluded.practice,email=excluded.email;
    return '{}';
  end if;
  if op='followup' then
    if not exists(select 1 from public.converter_followups where user_id=uid and created_at>now()-interval '1 day') then
      insert into public.converter_followups(user_id) values(uid);
    end if; return '{}';
  end if;
  select 50+coalesce(sum(case when kind='grant' then pages when kind in ('reserved','charged') then -pages else 0 end),0) into remaining from public.converter_allowance where user_id=uid;
  if op='account' then
    return jsonb_build_object('remaining',remaining,'profile',(select to_jsonb(p) from public.converter_profiles p where p.user_id=uid),
      'jobs',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,state,pages,created_at,expires_at,next_page,error_code,revision from public.conversions where user_id=uid and expires_at>now() and state not in ('deleted','expired') order by created_at desc limit 20) q),'[]'::jsonb));
  end if;
  if op='create' then
    if not exists(select 1 from public.converter_settings where enabled) then raise exception 'UNAVAILABLE'; end if;
    if not exists(select 1 from public.converter_profiles where user_id=uid and email is not null) then raise exception 'PROFILE_REQUIRED'; end if;
    if remaining<=0 then raise exception 'ALLOWANCE'; end if;
    if (select count(*) from public.conversions where user_id=uid and created_at>now()-interval '1 hour')>=15 then raise exception 'RATE_LIMIT'; end if;
    if exists(select 1 from public.conversions where user_id=uid and state in ('uploading','queued','processing')) then raise exception 'ACTIVE_JOB'; end if;
    insert into public.conversions(user_id,object_path) values(uid,uid::text||'/'||gen_random_uuid()::text||'.pdf') returning * into j;
    return to_jsonb(j);
  end if;
  select * into j from public.conversions where id=jid and user_id=uid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if op='delete' then
    update public.conversions set state='deleted',lease=null,file_hash=null where id=jid;
    update public.converter_help_requests set share_statement=false,statement_access_until=null,updated_at=now() where job_id=jid;
    delete from public.conversion_content where job_id=jid;
    update public.converter_allowance set kind='released' where job_id=jid and kind='reserved';
    return jsonb_build_object('object_path',j.object_path);
  end if;
  if j.expires_at<=now() or j.state in ('deleted','expired') then raise exception 'EXPIRED'; end if;
  if op='help' then
    if j.state not in ('review','failed') then raise exception 'STATE'; end if;
    if (args->>'share_statement')::boolean and (j.storage_deleted or j.pages is null) then raise exception 'STATE'; end if;
    insert into public.converter_help_requests(user_id,job_id,share_statement,statement_access_until)
      values(uid,jid,(args->>'share_statement')::boolean,case when (args->>'share_statement')::boolean then j.expires_at else null end)
      on conflict(user_id,job_id) do update set share_statement=excluded.share_statement,
        statement_access_until=excluded.statement_access_until,updated_at=now()
      returning jsonb_build_object('id',id,'share_statement',share_statement) into result;
    return result;
  end if;
  if op='begin_upload' then
    if j.state<>'uploading' or j.upload_started then raise exception 'STATE'; end if;
    update public.conversions set upload_started=true where id=jid;
    return to_jsonb(j);
  elsif op='get' then
    select to_jsonb(c) into payload from public.conversion_content c where job_id=jid and j.state='review';
    return to_jsonb(j)||jsonb_build_object('content',payload,'help',(select jsonb_build_object('id',r.id,'share_statement',r.share_statement) from public.converter_help_requests r where r.user_id=uid and r.job_id=jid));
  elsif op='finalize' then
    if j.state<>'uploading' then raise exception 'STATE'; end if;
    if (args->>'pages')::int not between 1 and 20 then raise exception 'PAGES'; end if;
    select id into prior from public.conversions where user_id=uid and id<>jid and file_hash=args->>'hash' and state='review' and expires_at>now() order by created_at desc limit 1;
    if prior is not null then
      update public.conversions set state='deleted' where id=jid;
      return jsonb_build_object('id',prior,'reused',true);
    end if;
    if (args->>'pages')::int>remaining then raise exception 'ALLOWANCE'; end if;
    update public.conversions set pages=(args->>'pages')::int,file_hash=args->>'hash',state='queued' where id=jid;
    insert into public.conversion_content(job_id) values(jid);
    insert into public.converter_allowance(user_id,job_id,pages,kind) values(uid,jid,(args->>'pages')::int,'reserved');
    perform pgmq.send('statement_jobs',jsonb_build_object('id',jid));
    return jsonb_build_object('id',jid);
  elsif op='fail' then
    if j.state='review' then raise exception 'STATE'; end if;
    update public.conversions set state='failed',error_code=args->>'code',lease=null where id=jid;
    update public.converter_allowance set kind='released' where job_id=jid and kind='reserved';
    return '{}';
  elsif op='edit' then
    if j.state<>'review' then raise exception 'STATE'; end if;
    if j.revision<>(args->>'revision')::int then raise exception 'REVISION'; end if;
    update public.conversion_content set corrected=args->'statement' where job_id=jid;
    update public.conversions set revision=revision+1 where id=jid returning revision into remaining;
    return jsonb_build_object('revision',remaining);
  elsif op='export' then
    if j.state<>'review' then raise exception 'STATE'; end if;
    insert into public.converter_events(user_id,job_id,event,pages) values(uid,jid,args->>'format',j.pages);
    return '{}';
  end if;
  raise exception 'UNKNOWN_OPERATION';
end $$;

-- Only the current lease may terminate a job or release its reservation.
create function public.converter_reject(jid uuid, token uuid, mid bigint, reason text) returns boolean
language plpgsql set search_path='' as $$
declare j public.conversions;
begin
  if reason not in ('UNSUPPORTED_STATEMENT','UNSUPPORTED_CURRENCY','INCONSISTENT_STATEMENT','NO_TRANSACTIONS') then raise exception 'INVALID_REASON'; end if;
  select * into j from public.conversions where id=jid;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.user_id::text,0));
  select * into j from public.conversions where id=jid for update;
  if j.lease is distinct from token or j.state<>'processing' or j.expires_at<=now() then return false; end if;
  update public.conversions set state='failed',error_code=reason,lease=null where id=jid;
  update public.converter_allowance set kind='released' where job_id=jid and kind='reserved';
  perform pgmq.delete('statement_jobs',mid);
  return true;
end $$;
revoke all on function public.converter_reject(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.converter_reject(uuid,uuid,bigint,text) to service_role;

-- Failed PDFs remain private until normal expiry/deletion so the visitor can
-- explicitly share one in a help request. This does not extend the 24-hour TTL.
create or replace function public.converter_cleanup() returns jsonb language plpgsql set search_path='' as $$
declare j record;
begin
  for j in select id,user_id from public.conversions where (expires_at<=now() and state not in ('expired','deleted')) or (state='uploading' and created_at<now()-interval '15 minutes') order by expires_at,id limit 100 loop
    perform pg_advisory_xact_lock(hashtextextended(j.user_id::text,0));
    update public.conversions set state='expired',lease=null,file_hash=null where id=j.id and (expires_at<=now() or state='uploading');
    if found then
      delete from public.conversion_content where job_id=j.id;
      update public.converter_allowance set kind='released' where job_id=j.id and kind='reserved';
    end if;
  end loop;
  update public.converter_help_requests set share_statement=false,statement_access_until=null,updated_at=now()
    where share_statement and (statement_access_until<=now() or job_id in (select id from public.conversions where state in ('deleted','expired')));
  delete from public.conversion_content where job_id in (select id from public.conversions where state in ('deleted','expired'));
  return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'object_path',q.object_path)) from (
    select id,object_path,storage_checked_at from public.conversions
    where state in ('deleted','expired') and (not storage_deleted or created_at>now()-interval '48 hours')
    union all
    select null::uuid,o.name,null::timestamptz from storage.objects o
    where o.bucket_id='statements' and o.created_at<now()-interval '15 minutes'
      and not exists(select 1 from public.conversions existing_job where existing_job.object_path=o.name)
    order by storage_checked_at nulls first limit 100
  ) q),'[]'::jsonb);
end $$;
revoke all on function public.converter_cleanup() from public,anon,authenticated;
grant execute on function public.converter_cleanup() to service_role;

