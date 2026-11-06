\set ON_ERROR_STOP on
-- Disposable local/Stage database only. Everything, including fixtures, rolls back.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('aa111111-1111-4111-8111-111111111111','kdp-admin@example.test',now(),'{"role":"admin"}','{}'),
 ('aa222222-2222-4222-8222-222222222222','kdp-a@example.test',now(),'{}','{}'),
 ('aa333333-3333-4333-8333-333333333333','kdp-b@example.test',now(),'{}','{}'),
 ('aa444444-4444-4444-8444-444444444444','kdp-unverified@example.test',null,'{}','{}'),
 ('aa555555-5555-4555-8555-555555555555','kdp-c@example.test',now(),'{}','{}');
insert into public.products(id,slug,status,audience,product_type) values
 ('bb111111-1111-4111-8111-111111111111','kdp-sql-shared','published','kids','coloring-book'),
 ('bb222222-2222-4222-8222-222222222222','kdp-sql-legacy','published','kids','coloring-book'),
 ('bb333333-3333-4333-8333-333333333333','kdp-sql-draft','draft','kids','coloring-book');
insert into public.premium_codes(id,product_id,code) values
 ('cc222222-2222-4222-8222-222222222222','bb222222-2222-4222-8222-222222222222','KDP-SQL-SINGLE');
set local role authenticated;
set local request.jwt.claim.sub='aa111111-1111-4111-8111-111111111111';
do $$ declare result jsonb; begin
 result := public.manage_shared_premium_code('bb111111-1111-4111-8111-111111111111','KDP-SQL-SHARED',true);
 assert result->>'code_type' = 'shared', 'shared admin create';
 assert public.manage_shared_premium_code('bb111111-1111-4111-8111-111111111111')->>'id' = result->>'id', 'stable creation retry';
 begin
   perform public.manage_shared_premium_code('bb111111-1111-4111-8111-111111111111','REPLACEMENT',true);
   raise exception 'shared code replacement allowed';
 exception when check_violation then null; end;
end $$;
set local request.jwt.claim.sub='aa444444-4444-4444-8444-444444444444';
do $$ begin
 assert public.redeem_premium_code('bb111111-1111-4111-8111-111111111111','KDP-SQL-SHARED')->>'status' = 'email_unverified';
end $$;
set local request.jwt.claim.sub='aa222222-2222-4222-8222-222222222222';
do $$ begin
 begin
   insert into public.user_product_unlocks(user_id,product_id)
   values(auth.uid(),'bb111111-1111-4111-8111-111111111111');
   raise exception 'client granted itself premium access';
 exception when insufficient_privilege then null; end;
 assert public.redeem_premium_code('bb111111-1111-4111-8111-111111111111','WRONG-CODE')->>'status' = 'invalid_code';
 assert public.redeem_premium_code('bb222222-2222-4222-8222-222222222222','KDP-SQL-SHARED')->>'status' = 'wrong_product';
 assert public.redeem_premium_code('bb111111-1111-4111-8111-111111111111',' kdp-sql-shared ')->>'status' = 'success';
 assert public.redeem_premium_code('bb111111-1111-4111-8111-111111111111','KDP-SQL-SHARED')->>'status' = 'already_unlocked';
 assert public.redeem_premium_code('bb222222-2222-4222-8222-222222222222','KDP-SQL-SINGLE')->>'status' = 'success';
 begin
   perform public.manage_shared_premium_code('bb111111-1111-4111-8111-111111111111');
   raise exception 'non-admin shared management allowed';
 exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claim.sub='aa333333-3333-4333-8333-333333333333';
do $$ begin
 assert public.redeem_premium_code('bb111111-1111-4111-8111-111111111111','KDP-SQL-SHARED')->>'status' = 'success';
 assert public.redeem_premium_code('bb222222-2222-4222-8222-222222222222','KDP-SQL-SINGLE')->>'status' = 'already_used';
end $$;
set local request.jwt.claim.sub='aa111111-1111-4111-8111-111111111111';
do $$ declare shared_id text; begin
 shared_id := public.manage_shared_premium_code('bb111111-1111-4111-8111-111111111111',null,false)->>'id';
 -- A stale editor submits removal and a replacement of the printed code. Its
 -- desired state must not rotate or reactivate the authoritative shared row.
 perform public.save_product(jsonb_build_object(
   'id','bb111111-1111-4111-8111-111111111111','slug','kdp-sql-renamed',
   'status','published','audience','kids','productType','coloring-book',
   'premiumCodes',jsonb_build_array(jsonb_build_object('id',shared_id,'code','STALE-REPLACEMENT','active',true)),
   'premiumCodeRemovals',jsonb_build_array(shared_id)));
 assert exists(select 1 from public.premium_codes where id=shared_id::uuid
   and code='KDP-SQL-SHARED' and not active and code_type='shared'), 'stale save changed shared code';
 -- Omitting it entirely must also preserve disabled identity.
 perform public.save_product(jsonb_build_object(
   'id','bb111111-1111-4111-8111-111111111111','slug','kdp-sql-renamed-again',
   'status','published','audience','kids','productType','coloring-book','premiumCodes','[]'::jsonb,
   'premiumCodeRemovals',jsonb_build_array(shared_id)));
 assert exists(select 1 from public.premium_codes where id=shared_id::uuid and not active), 'omitted shared code lost';
end $$;
set local request.jwt.claim.sub='aa555555-5555-4555-8555-555555555555';
do $$ begin
 assert public.redeem_premium_code('bb111111-1111-4111-8111-111111111111','KDP-SQL-SHARED')->>'status' = 'inactive_code';
end $$;
set local request.jwt.claim.sub='aa222222-2222-4222-8222-222222222222';
do $$ begin
 assert public.redeem_premium_code('bb111111-1111-4111-8111-111111111111','KDP-SQL-SHARED')->>'status' = 'already_unlocked';
 assert (select count(*) from public.user_product_unlocks where user_id=auth.uid()
   and product_id='bb111111-1111-4111-8111-111111111111') = 1;
end $$;
reset role;
do $$ begin
 assert (select count(*) from public.user_product_unlocks where product_id='bb111111-1111-4111-8111-111111111111') = 2;
 assert (select product_id from public.product_slug_aliases where slug='kdp-sql-shared') = 'bb111111-1111-4111-8111-111111111111'::uuid;
 assert (select count(*) from public.product_slug_aliases where product_id='bb111111-1111-4111-8111-111111111111') = 3;
 begin
   update public.products set slug='kdp-sql-shared' where id='bb222222-2222-4222-8222-222222222222';
   raise exception 'historical slug reassigned to another book';
 exception when unique_violation then null; end;
 assert exists(select 1 from public.premium_codes where product_id='bb111111-1111-4111-8111-111111111111'
   and redeemed_at is null and redeemed_by is null), 'shared code was consumed';
 begin
   delete from public.premium_codes where product_id='bb111111-1111-4111-8111-111111111111';
   raise exception 'shared deletion allowed';
 exception when check_violation then null; end;
 begin
   update public.premium_codes set code_type='shared' where code='KDP-SQL-SINGLE';
   raise exception 'legacy type mutation allowed';
 exception when check_violation then null; end;
 assert not has_function_privilege('anon','public.manage_shared_premium_code(uuid,text,boolean)','execute');
 assert not has_function_privilege('anon','public.redeem_premium_code(uuid,text)','execute');
 assert not has_function_privilege('authenticated','private.save_product_before_shared_codes(jsonb)','execute');
end $$;
set local role authenticated;
set local request.jwt.claim.sub='aa111111-1111-4111-8111-111111111111';
do $$ begin
 assert public.manage_shared_premium_code('bb111111-1111-4111-8111-111111111111',null,true)->>'active' = 'true';
end $$;
set local request.jwt.claim.sub='aa555555-5555-4555-8555-555555555555';
do $$ begin
 assert public.redeem_premium_code('bb111111-1111-4111-8111-111111111111','KDP-SQL-SHARED')->>'status' = 'success';
end $$;
reset role;
set local role anon;
do $$ begin
 assert exists(select 1 from public.product_slug_aliases where slug='kdp-sql-shared');
 assert not exists(select 1 from public.product_slug_aliases where slug='kdp-sql-draft');
 begin
   insert into public.product_slug_aliases(slug,product_id)
   values('attacker-alias','bb111111-1111-4111-8111-111111111111');
   raise exception 'anonymous alias poisoning allowed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo 'PASS shared SQL: multiple accounts, retries, legacy compatibility, verification, invalid/inactive, slug changes, stale saves, admin/RLS boundaries, immutable identity, reactivation'
