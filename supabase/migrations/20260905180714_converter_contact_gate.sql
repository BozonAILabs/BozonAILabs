-- Contact details belong to the private session, not to a verified email identity.
-- Never look up a previous session or grant file access by submitted email.
alter table public.converter_profiles alter column role drop not null;
alter table public.converter_profiles add column email text
  check (length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$');

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
    if not exists(select 1 from public.converter_settings where enabled and cardinality(validated_banks)>0) then raise exception 'UNAVAILABLE'; end if;
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
