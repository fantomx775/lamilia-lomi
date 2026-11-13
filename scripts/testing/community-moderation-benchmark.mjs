import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { loadIsolatedCommunityTarget } from './isolated-community-target.mjs';
const target = loadIsolatedCommunityTarget();
const client = createClient(target.apiUrl, target.serviceRoleKey, { auth: { persistSession: false } });
const statuses = ['pending', 'approved', 'rejected', 'removed'];
const select = 'id,product_id,content_type,description,status,revision,moderation_reason,created_at,updated_at,products(id,slug,audience,status,product_translations(locale,title)),community_profiles(username)';
const page = () => client.from('community_artworks').select(select).is('deleted_at', null).eq('status','pending').order('created_at').order('id').limit(31);
const checked = (results) => { for (const result of results) if (result.error) throw Error('Benchmark query failed'); };
async function before() {
 const counts = await Promise.all(statuses.map(status => client.from('community_artworks').select('id',{count:'exact',head:true}).is('deleted_at',null).eq('status',status)));
 const list = await page(); checked([...counts,list]);
 return { counts: Object.fromEntries(statuses.map((status,i)=>[status,counts[i].count])), ids:list.data.map(row=>row.id) };
}
async function after() {
 const [counts,list] = await Promise.all([client.rpc('community_moderation_counts',{p_product_id:null,p_creator_prefix:null}),page()]); checked([counts,list]);
 return { counts:counts.data, ids:list.data.map(row=>row.id) };
}
const ms={before:[],after:[]};
for(let round=0;round<12;round++) for(const [name,run] of [['before',before],['after',after]]) {
 const start=performance.now(); const result=await run(); if(round>1) ms[name].push(performance.now()-start);
 if(name==='before') globalThis.baseline=result; else if(statuses.some(status=>result.counts[status]!==globalThis.baseline.counts[status]) || JSON.stringify(result.ids)!==JSON.stringify(globalThis.baseline.ids)) throw Error('Count/page semantic mismatch');
}
const summary = values => ({samples:values.length,medianMs:+[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)].toFixed(3),minMs:+Math.min(...values).toFixed(3),maxMs:+Math.max(...values).toFixed(3)});
console.log(JSON.stringify({environment:'isolated loopback Supabase',requestCounts:{before:5,after:2},before:summary(ms.before),after:summary(ms.after),counts:globalThis.baseline.counts},null,2));
const sql = `explain (analyze,buffers) select count(*) from public.community_artworks where deleted_at is null and status='pending'; explain (analyze,buffers) select count(*) filter(where status='pending'),count(*) filter(where status='approved'),count(*) filter(where status='rejected'),count(*) filter(where status='removed') from public.community_artworks where deleted_at is null; select has_function_privilege('anon','public.community_moderation_counts(uuid,text)','execute') as anon_execute,has_function_privilege('authenticated','public.community_moderation_counts(uuid,text)','execute') as authenticated_execute,has_function_privilege('service_role','public.community_moderation_counts(uuid,text)','execute') as service_execute;`;
const output=execFileSync(target.dockerExecutable,['exec','-i',target.databaseContainerId,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:{...process.env,DOCKER_HOST:target.dockerEndpoint,DOCKER_CONTEXT:''}});
console.log(output);
const anon = createClient(target.apiUrl, target.publishableKey, { auth: { persistSession:false } });
if (!(await anon.rpc('community_moderation_counts', {})).error) throw Error('Anonymous aggregate access was allowed');
for (const prefix of ['_', '%', 'loading_', 'avatar_']) {
 const expectedResults = await Promise.all(statuses.map(status => client.from('community_artworks')
   .select('id,community_profiles:community_profiles!community_artworks_author_profile_fkey!inner(username)',{count:'exact',head:true})
   .is('deleted_at',null).eq('status',status).ilike('community_profiles.username', `${prefix.replace(/[\\%_]/g,'\\$&')}%`)));
 const actual = await client.rpc('community_moderation_counts',{p_creator_prefix:prefix,p_product_id:null});
 checked([...expectedResults,actual]);
 if(statuses.some((status,i)=>actual.data[status]!==expectedResults[i].count)) throw Error('Filtered count mismatch');
}
console.log('PASS: exact unfiltered counts/page, escaped creator prefix counts, anonymous denied, service-only grants');
