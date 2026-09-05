-- Additive engine, disabled until release prerequisites are verified.
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select pgmq.create('statement_jobs');
alter table pgmq.q_statement_jobs enable row level security;
alter table pgmq.a_statement_jobs enable row level security;

create table public.converter_settings (
  id boolean primary key default true check(id), api_version int not null default 1,
  enabled boolean not null default false, validated_banks text[] not null default '{}'
);
insert into public.converter_settings default values;
create table public.converter_profiles (
  user_id uuid primary key references auth.users on delete cascade,
  name text not null check(length(name) between 1 and 120),
  practice text not null check(length(practice) between 1 and 180),
  role text not null check(length(role) between 1 and 80), created_at timestamptz not null default now()
);
create table public.converter_followups (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  wording text not null default 'Please contact me about improving my practice workflows.', created_at timestamptz not null default now()
);
create index on public.converter_followups(user_id);
create table public.conversions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  state text not null default 'uploading' check(state in ('uploading','queued','processing','review','failed','deleted','expired')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default (now() + interval '24 hours'),
  pages int check(pages between 1 and 20), file_hash text, object_path text not null,
  engine_version text not null default '1.0.0', model text not null default 'mistral-ocr-4-0',
  upload_started boolean not null default false, revision int not null default 0, next_page int not null default 0, attempts int not null default 0,
  lease uuid, error_code text, storage_checked_at timestamptz, storage_deleted boolean not null default false
);
create index on public.conversions(user_id, created_at desc);
create index on public.conversions(expires_at) where state not in ('deleted','expired');
create unique index converter_one_active on public.conversions(user_id) where state in ('uploading','queued','processing');
create table public.conversion_content (
  job_id uuid primary key references public.conversions on delete cascade,
  original jsonb, corrected jsonb, chunks jsonb not null default '[]'
);
create table public.converter_allowance (
  id bigint generated always as identity primary key, user_id uuid not null references auth.users on delete cascade,
  job_id uuid unique references public.conversions on delete set null,
  pages int not null check(pages > 0), kind text not null check(kind in ('reserved','charged','released','grant')),
  reason text, operator text, created_at timestamptz not null default now(),
  check(kind <> 'grant' or (job_id is null and length(reason)>0 and length(operator)>0))
);
create index on public.converter_allowance(user_id);
create table public.converter_events (
  id bigint generated always as identity primary key, user_id uuid not null references auth.users on delete cascade,
  job_id uuid references public.conversions on delete set null,
  event text not null check(event in ('completed','excel','xero')), pages int,
  created_at timestamptz not null default now()
);
create index on public.converter_events(user_id);

alter table public.converter_settings enable row level security;
alter table public.converter_profiles enable row level security;
alter table public.converter_followups enable row level security;
alter table public.conversions enable row level security;
alter table public.conversion_content enable row level security;
alter table public.converter_allowance enable row level security;
alter table public.converter_events enable row level security;
create policy own_profile on public.converter_profiles for select to authenticated using(user_id = (select auth.uid()));
create policy own_jobs on public.conversions for select to authenticated using(user_id = (select auth.uid()) and expires_at > now() and state not in ('deleted','expired'));
create policy own_content on public.conversion_content for select to authenticated using(exists(select 1 from public.conversions j where j.id=job_id and j.user_id=(select auth.uid()) and j.expires_at>now() and j.state='review'));
create policy own_allowance on public.converter_allowance for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.converter_settings,public.converter_profiles,public.converter_followups,public.conversions,public.conversion_content,public.converter_allowance,public.converter_events from anon,authenticated;
grant select on public.converter_profiles,public.conversions,public.conversion_content,public.converter_allowance to authenticated;
grant all on public.converter_settings,public.converter_profiles,public.converter_followups,public.conversions,public.conversion_content,public.converter_allowance,public.converter_events to service_role;
grant usage, select on all sequences in schema public to service_role;
grant usage on schema pgmq to service_role;
grant all on all tables in schema pgmq to service_role;
grant usage,select on all sequences in schema pgmq to service_role;
grant execute on all functions in schema pgmq to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('statements','statements',false,10485760,array['application/pdf']) on conflict(id) do nothing;
-- No browser Storage policies. All upload/read/delete access is mediated by authenticated Edge API.

-- Service-only, SECURITY INVOKER: callers cannot supply somebody else's identity through REST.
create function public.converter_command(op text, uid uuid, jid uuid default null, args jsonb default '{}') returns jsonb
language plpgsql set search_path = '' as $$
declare j public.conversions; remaining int; prior uuid; payload jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  if op='profile' then
    insert into public.converter_profiles(user_id,name,practice,role) values(uid,args->>'name',args->>'practice',args->>'role')
    on conflict(user_id) do update set name=excluded.name,practice=excluded.practice,role=excluded.role;
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
    if not exists(select 1 from public.converter_settings where enabled and cardinality(validated_banks)>0) then raise exception 'UNAVAILABLE'; end if;
    if not exists(select 1 from public.converter_profiles where user_id=uid) then raise exception 'PROFILE_REQUIRED'; end if;
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
    delete from public.conversion_content where job_id=jid;
    update public.converter_allowance set kind='released' where job_id=jid and kind='reserved';
    return jsonb_build_object('object_path',j.object_path);
  end if;
  if j.expires_at<=now() or j.state in ('deleted','expired') then raise exception 'EXPIRED'; end if;
  if op='begin_upload' then
    if j.state<>'uploading' or j.upload_started then raise exception 'STATE'; end if;
    update public.conversions set upload_started=true where id=jid;
    return to_jsonb(j);
  elsif op='get' then
    select to_jsonb(c) into payload from public.conversion_content c where job_id=jid and j.state='review';
    return to_jsonb(j)||jsonb_build_object('content',payload);
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
revoke all on function public.converter_command(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.converter_command(text,uuid,uuid,jsonb) to service_role;

create function public.converter_claim() returns jsonb language plpgsql set search_path='' as $$
declare m record; j public.conversions; token uuid;
begin
  select * into m from pgmq.read('statement_jobs',180,1);
  if not found then return null; end if;
  select * into j from public.conversions where id=(m.message->>'id')::uuid;
  if not found then perform pgmq.delete('statement_jobs',m.msg_id); return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.user_id::text,0));
  select * into j from public.conversions where id=j.id for update;
  if j.expires_at<=now() or j.state not in ('queued','processing') then perform pgmq.delete('statement_jobs',m.msg_id); return null; end if;
  if j.attempts>=3 then
    update public.conversions set state='failed',error_code='EXTRACTION_FAILED',lease=null where id=j.id;
    update public.converter_allowance set kind='released' where job_id=j.id and kind='reserved';
    perform pgmq.delete('statement_jobs',m.msg_id); return null;
  end if;
  token:=gen_random_uuid();
  update public.conversions set state='processing',attempts=attempts+1,lease=token where id=j.id;
  return to_jsonb(j)||jsonb_build_object('lease',token,'msg_id',m.msg_id,'chunks',(select chunks from public.conversion_content where job_id=j.id));
end $$;
revoke all on function public.converter_claim() from public,anon,authenticated;
grant execute on function public.converter_claim() to service_role;

create function public.converter_checkpoint(jid uuid, token uuid, mid bigint, chunk jsonb, final_result jsonb default null) returns boolean
language plpgsql set search_path='' as $$
declare j public.conversions;
begin
  select * into j from public.conversions where id=jid;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.user_id::text,0));
  select * into j from public.conversions where id=jid for update;
  if j.lease is distinct from token or j.state<>'processing' or j.expires_at<=now() then return false; end if;
  update public.conversion_content set chunks=chunks||jsonb_build_array(chunk),original=final_result,corrected=final_result where job_id=jid;
  update public.conversions set next_page=least(next_page+6,pages),attempts=0,lease=null,state=case when final_result is null then 'queued' else 'review' end where id=jid;
  perform pgmq.delete('statement_jobs',mid);
  if final_result is null then perform pgmq.send('statement_jobs',jsonb_build_object('id',jid));
  else
    update public.converter_allowance set kind='charged' where job_id=jid and kind='reserved';
    insert into public.converter_events(user_id,job_id,event,pages) values(j.user_id,jid,'completed',j.pages);
  end if;
  return true;
end $$;
revoke all on function public.converter_checkpoint(uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.converter_checkpoint(uuid,uuid,bigint,jsonb,jsonb) to service_role;

create function public.converter_cleanup() returns jsonb language plpgsql set search_path='' as $$
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
  delete from public.conversion_content where job_id in (select id from public.conversions where state in ('deleted','expired','failed'));
  return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'object_path',q.object_path)) from (
    select id,object_path,storage_checked_at from public.conversions
    where state in ('deleted','expired','failed') and (not storage_deleted or created_at>now()-interval '48 hours')
    union all
    select null::uuid,o.name,null::timestamptz from storage.objects o
    where o.bucket_id='statements' and o.created_at<now()-interval '15 minutes'
      and not exists(select 1 from public.conversions existing_job where existing_job.object_path=o.name)
    order by storage_checked_at nulls first limit 100
  ) q),'[]'::jsonb);
end $$;
revoke all on function public.converter_cleanup() from public,anon,authenticated;
grant execute on function public.converter_cleanup() to service_role;

-- Operator-only additive grants: execute as postgres in restricted SQL console.
create function public.converter_grant(uid uuid, pages int, reason text) returns void language plpgsql set search_path='' as $$
begin
  if pages<=0 or length(trim(reason))<1 then raise exception 'INVALID_GRANT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  insert into public.converter_allowance(user_id,pages,kind,reason,operator) values(uid,pages,'grant',reason,session_user);
end $$;
revoke all on function public.converter_grant(uuid,int,text) from public,anon,authenticated,service_role;

-- Scheduler intentionally inert until operator installs matching URL/token in Vault and Edge secrets.
create schema if not exists converter_private;
revoke all on schema converter_private from public,anon,authenticated;
create function converter_private.dispatch() returns void language plpgsql security definer set search_path='' as $$
declare target text; token text;
begin
  select decrypted_secret into target from vault.decrypted_secrets where name='converter_worker_url' limit 1;
  select decrypted_secret into token from vault.decrypted_secrets where name='converter_worker_token' limit 1;
  if target is not null and token is not null then
    perform net.http_post(url:=target,headers:=jsonb_build_object('Content-Type','application/json','x-worker-token',token),body:='{}'::jsonb,timeout_milliseconds:=120000);
  end if;
end $$;
revoke all on function converter_private.dispatch() from public,anon,authenticated,service_role;
select cron.schedule('converter-dispatch','* * * * *','select converter_private.dispatch()');
