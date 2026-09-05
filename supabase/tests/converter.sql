\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(condition boolean, message text) returns void language plpgsql as $$begin if condition is distinct from true then raise exception 'Assertion failed: %',message; end if; end$$;
insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','one@example.test'),('22222222-2222-4222-8222-222222222222','two@example.test');
update public.converter_settings set enabled=true;
select public.converter_command('profile','11111111-1111-4111-8111-111111111111',null,'{"name":"One","practice":"Test","email":"shared@example.test"}');
select public.converter_command('profile','22222222-2222-4222-8222-222222222222',null,'{"name":"Two","practice":"Test","email":"shared@example.test"}');
select pg_temp.ok(not has_function_privilege('authenticated','public.converter_command(text,uuid,uuid,jsonb)','execute'),'user cannot spoof service RPC identity');
select pg_temp.ok(not has_function_privilege('anon','public.converter_claim()','execute'),'anonymous cannot claim worker');
select pg_temp.ok(not has_function_privilege('service_role','public.converter_grant(uuid,integer,text)','execute'),'worker cannot grant pages');
select pg_temp.ok(not has_table_privilege('authenticated','public.converter_allowance','insert'),'cannot grant own quota');
select pg_temp.ok(not has_table_privilege('authenticated','public.conversions','update'),'cannot alter job state');

do $$declare u uuid:='11111111-1111-4111-8111-111111111111'; j jsonb; claim jsonb; job uuid; token uuid; n int; result jsonb; begin
  foreach n in array array[20,20,9] loop
    j:=public.converter_command('create',u); job:=(j->>'id')::uuid;
    perform public.converter_command('begin_upload',u,job);
    begin perform public.converter_command('begin_upload',u,job);raise exception 'duplicate upload accepted';exception when others then if sqlerrm<>'STATE' then raise;end if;end;
    perform public.converter_command('finalize',u,job,jsonb_build_object('pages',n,'hash',job));
    begin perform public.converter_command('create',u);raise exception 'active job accepted';exception when others then if sqlerrm<>'ACTIVE_JOB' then raise;end if;end;
    loop
      claim:=public.converter_claim();
      perform pg_temp.ok(claim is not null,'queue claimed');
      result:=case when (claim->>'next_page')::int+6>=n then '{"transactions":[]}'::jsonb else null end;
      perform pg_temp.ok(public.converter_checkpoint(job,(claim->>'lease')::uuid,(claim->>'msg_id')::bigint,'{}',result),'checkpoint accepted');
      perform pg_temp.ok(not public.converter_checkpoint(job,(claim->>'lease')::uuid,(claim->>'msg_id')::bigint,'{}',result),'duplicate checkpoint ignored');
      exit when result is not null;
    end loop;
  end loop;
  perform pg_temp.ok((public.converter_command('account',u)->>'remaining')::int=1,'49 pages used');
  j:=public.converter_command('create',u);job:=(j->>'id')::uuid;
  begin perform public.converter_command('finalize',u,job,'{"pages":2,"hash":"over"}');raise exception '51st page accepted';exception when others then if sqlerrm<>'ALLOWANCE' then raise;end if;end;
  perform pg_temp.ok((public.converter_command('account',u)->>'remaining')::int=1,'failed reservation unchanged');
  perform public.converter_command('finalize',u,job,'{"pages":1,"hash":"last"}');
  perform pg_temp.ok((public.converter_command('account',u)->>'remaining')::int=0,'50th reserved');
  perform public.converter_command('fail',u,job,'{"code":"TEST_FAILURE"}');
  perform pg_temp.ok((public.converter_command('account',u)->>'remaining')::int=1,'failure releases');
  -- Consume stale message before new job.
  perform public.converter_claim();
  j:=public.converter_command('create',u);job:=(j->>'id')::uuid;
  perform public.converter_command('finalize',u,job,'{"pages":1,"hash":"last"}');
  claim:=public.converter_claim();token:=(claim->>'lease')::uuid;
  perform public.converter_command('delete',u,job);
  perform pg_temp.ok(not public.converter_checkpoint(job,token,(claim->>'msg_id')::bigint,'{}','{}'),'deleted job cannot be resurrected');
  perform pg_temp.ok(not exists(select 1 from public.conversion_content where job_id=job),'delete clears payload');
  perform pg_temp.ok((public.converter_command('account',u)->>'remaining')::int=1,'delete releases in-flight reservation');
  perform public.converter_claim();
  j:=public.converter_command('create',u);job:=(j->>'id')::uuid;
  perform public.converter_command('finalize',u,job,'{"pages":1,"hash":"last"}');
  claim:=public.converter_claim();
  perform public.converter_checkpoint(job,(claim->>'lease')::uuid,(claim->>'msg_id')::bigint,'{}','{"transactions":[]}');
  perform pg_temp.ok((public.converter_command('account',u)->>'remaining')::int=0,'50 pages charged');
  begin perform public.converter_command('create',u);raise exception 'quota exhausted accepted';exception when others then if sqlerrm<>'ALLOWANCE' then raise;end if;end;
  perform public.converter_command('edit',u,job,'{"revision":0,"statement":{"transactions":[]}}');
  begin perform public.converter_command('edit',u,job,'{"revision":0,"statement":{}}');raise exception 'stale edit accepted';exception when others then if sqlerrm<>'REVISION' then raise;end if;end;
  begin perform public.converter_command('get','22222222-2222-4222-8222-222222222222',job);raise exception 'other user accepted';exception when others then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
  update public.conversions set expires_at=now()-interval '1 second' where id=job;
  begin perform public.converter_command('get',u,job);raise exception 'expired read accepted';exception when others then if sqlerrm<>'EXPIRED' then raise;end if;end;
  perform public.converter_cleanup();
  perform pg_temp.ok(not exists(select 1 from public.conversion_content where job_id=job),'expiry clears payload');
  perform pg_temp.ok((public.converter_command('account',u)->>'remaining')::int=0,'expiry never refunds consumed pages');
end$$;

-- RLS checks as real authenticated role, not table owner.
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.ok((select count(*)=1 from public.converter_profiles),'own profile only');
select pg_temp.ok((select count(*)=0 from public.conversions),'other jobs invisible');
select pg_temp.ok((select count(*)=0 from public.conversion_content),'other content invisible');
select pg_temp.ok((select count(*)=0 from public.converter_allowance),'other allowance invisible');
select pg_temp.ok((select count(*)=0 from storage.objects where bucket_id='statements'),'no direct storage access');
reset role;

-- Duplicate reuse and three interrupted attempts, using separate user.
do $$declare u uuid:='22222222-2222-4222-8222-222222222222'; j jsonb; c jsonb; test_id uuid; reused jsonb; i int; begin
 j:=public.converter_command('create',u);test_id:=(j->>'id')::uuid;
 perform public.converter_command('finalize',u,test_id,'{"pages":1,"hash":"same"}');c:=public.converter_claim();
 perform public.converter_checkpoint(test_id,(c->>'lease')::uuid,(c->>'msg_id')::bigint,'{}','{}');
 j:=public.converter_command('create',u);reused:=public.converter_command('finalize',u,(j->>'id')::uuid,'{"pages":1,"hash":"same"}');
 perform pg_temp.ok(reused->>'id'=test_id::text and (reused->>'reused')::boolean,'duplicate reuse');
 perform pg_temp.ok((public.converter_command('account',u)->>'remaining')::int=49,'reuse not charged');
 j:=public.converter_command('create',u);test_id:=(j->>'id')::uuid;
 perform public.converter_command('finalize',u,test_id,'{"pages":1,"hash":"retry"}');
 for i in 1..4 loop update pgmq.q_statement_jobs set vt=now()-interval '1 second' where message->>'id'=test_id::text;c:=public.converter_claim();end loop;
 perform pg_temp.ok((select state='failed' from public.conversions where conversions.id=test_id),'bounded retry failure');
 perform pg_temp.ok((public.converter_command('account',u)->>'remaining')::int=49,'retry failure releases pages');
end$$;
insert into storage.objects(bucket_id,name,created_at) values('statements','orphan-test.pdf',now()-interval '1 hour');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.converter_cleanup()) item where item->>'object_path'='orphan-test.pdf'),'orphaned storage included in sweep');
rollback;
\echo 'Converter database assertions passed'
