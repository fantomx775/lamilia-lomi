"""Exercise independent Postgres sessions against a disposable local Supabase.
Usage: python supabase/tests/kdp-shared-concurrency.py [--port 57322]
The fixed loopback host deliberately prevents accidental hosted execution.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
import subprocess
from uuid import uuid4

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=57322)
parser.add_argument("--owner", choices=("postgres", "supabase_admin"), default="postgres")
args = parser.parse_args()
if not 1024 <= args.port <= 65535:
    raise SystemExit("Invalid local database port")
env = {**os.environ, "PGPASSWORD": "postgres"}

def query(sql, username="postgres"):
    result = subprocess.run([
        "psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
        "-h", "127.0.0.1", "-p", str(args.port), "-U", username, "-d", "postgres"
    ], input=sql, text=True, capture_output=True, env=env, timeout=45)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip().splitlines()

product, legacy_product = str(uuid4()), str(uuid4())
users = [str(uuid4()) for _ in range(4)]
shared, single = "KDP-TEST-" + uuid4().hex, "SINGLE-TEST-" + uuid4().hex
code_ids = [str(uuid4()), str(uuid4())]

def redeem(user, product_id, code):
    lines = query(f"""begin;
      set local role authenticated;
      set local request.jwt.claim.sub = '{user}';
      select public.redeem_premium_code('{product_id}', '{code}');
      commit;""", username=args.owner)
    return json.loads(lines[-1])["status"]

try:
    user_values = ",".join(f"('{u}','{u}@kdp-concurrency.test',now(),'{{}}','{{}}')" for u in users)
    query(f"""insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
      values {user_values};
      insert into public.products(id,slug,status,audience,product_type) values
      ('{product}','kdp-test-{product}','published','kids','coloring-book'),
      ('{legacy_product}','kdp-test-{legacy_product}','published','kids','coloring-book');
      insert into public.premium_codes(id,product_id,code,code_type) values
      ('{code_ids[0]}','{product}','{shared}','shared'),
      ('{code_ids[1]}','{legacy_product}','{single}','single_use');""")
    with ThreadPoolExecutor(max_workers=12) as pool:
        # Twelve actual connections, including three simultaneous scans/account.
        outcomes = list(pool.map(lambda u: redeem(u, product, shared), users * 3))
    assert outcomes.count("success") == 4, outcomes
    assert outcomes.count("already_unlocked") == 8, outcomes
    with ThreadPoolExecutor(max_workers=4) as pool:
        legacy = list(pool.map(lambda u: redeem(u, legacy_product, single), users))
    assert legacy.count("success") == 1, legacy
    assert legacy.count("already_used") == 3, legacy
    counts = query(f"""select json_build_object(
      'unlocks',(select count(*) from public.user_product_unlocks where product_id='{product}'),
      'consumed',(select redeemed_at is not null from public.premium_codes where id='{code_ids[0]}'));
    """)
    assert json.loads(counts[-1]) == {"unlocks": 4, "consumed": False}, counts
    print("PASS concurrent shared: 4 accounts / 12 requests / 4 grants / 8 idempotent retries")
    print("PASS concurrent single_use compatibility: 1 winner / 3 already_used")
finally:
    # Shared codes are intentionally undeletable in the application; only this
    # disposable test cleanup temporarily disables its exact identity trigger.
    query(f"""begin;
      delete from public.user_product_unlocks where product_id in ('{product}','{legacy_product}');
      alter table public.premium_codes disable trigger premium_codes_shared_identity_guard;
      delete from public.premium_codes where id in ('{code_ids[0]}','{code_ids[1]}');
      alter table public.premium_codes enable trigger premium_codes_shared_identity_guard;
      delete from public.products where id in ('{product}','{legacy_product}');
      delete from auth.users where id in ({','.join("'" + u + "'" for u in users)});
      commit;""", username=args.owner)
