"""Coordinated real PostgreSQL lock regressions; disposable Lamilia local DB only.

Default: all fixed-order checks must pass. --reproduce-old-order is an explicit
diagnostic for the pre-fix function and requires a genuine 40P01, never a release pass.
No database credentials, cloud target, or Python dependencies are needed.
"""
import json
import queue
import subprocess
import sys
import threading
import time
import uuid

CONTAINER = "supabase_db_lamilia-coloring-club-p0"
CMD = ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-U", "supabase_admin",
       "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]


def sql(query):
    return subprocess.run(CMD, input=query, text=True, capture_output=True, timeout=25)


def required(query):
    result = sql(query)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


class Session:
    def __init__(self, name):
        self.process = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.lines = []
        self.events = queue.Queue()

        def read():
            for line in self.process.stdout:
                self.lines.append(line.rstrip())
                self.events.put(line.strip())
            self.events.put(None)

        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        self.send(f"SET application_name='{name}'; SET deadlock_timeout='200ms'; SET statement_timeout='15s';")

    def send(self, query):
        self.process.stdin.write(query + "\n")
        self.process.stdin.flush()

    def marker(self, value):
        end = time.monotonic() + 10
        while time.monotonic() < end:
            line = self.events.get(timeout=max(0.01, end - time.monotonic()))
            if line == value:
                return
            if line is None:
                break
        raise RuntimeError("Session did not reach fixture marker: " + "\n".join(self.lines))

    def finish(self):
        if not self.process.stdin.closed:
            self.process.stdin.close()
        code = self.process.wait(timeout=20)
        self.reader.join(timeout=2)
        return code, "\n".join(self.lines)

    def stop(self):
        if self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=5)
        self.reader.join(timeout=2)


def scenario(kind, old_order):
    owner, reactor, admin, product, artwork, image = [str(uuid.uuid4()) for _ in range(6)]
    token = uuid.uuid4().hex[:8]
    a_name, b_name = "cc-heart-a-" + token, "cc-heart-b-" + token
    sessions = []
    approval = kind.startswith("approve")
    auth_delete = kind.endswith("auth")
    try:
        required(f"""BEGIN;
        INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES
          ('{owner}','cc-race-owner-{token}@example.test',now(),'{{}}','{{}}'),
          ('{reactor}','cc-race-member-{token}@example.test',now(),'{{}}','{{}}'),
          ('{admin}','cc-race-admin-{token}@example.test',now(),'{{}}','{{}}');
        UPDATE public.profiles SET role='admin' WHERE id='{admin}';
        INSERT INTO public.products(id,slug,status,audience,product_type)
          VALUES('{product}','cc-heart-race-{token}','published','adults','coloring-book');
        INSERT INTO public.user_product_unlocks(user_id,product_id) VALUES('{owner}','{product}');
        SET LOCAL ROLE service_role;
        SELECT public.community_join('{owner}','cc_race_owner_{token}',true,'2026-10-25-v1');
        SELECT public.community_join('{reactor}','cc_race_member_{token}',true,'2026-10-25-v1');
        INSERT INTO public.community_artworks(id,author_id,product_id,storage_path,storage_provider,content_type,size_bytes,status,published_at)
          VALUES('{artwork}','{owner}','{product}','community/{owner}/{image}','supabase','image/webp',100,'approved',now());
        SELECT public.community_set_artwork_like('{owner}','{artwork}',true);
        COMMIT;""")
        if approval:
            required(f"SET ROLE service_role; SELECT public.community_edit_artwork_description('{owner}','{artwork}',1,'Edited fixture');")
        b = Session(b_name)
        sessions.append(b)
        lock_table, lock_column = ("auth.users", "id") if auth_delete else ("public.community_profiles", "user_id")
        b.send(f"BEGIN; SELECT {lock_column} FROM {lock_table} WHERE {lock_column}='{owner}' FOR UPDATE; SELECT 'LOCKED';")
        b.marker("LOCKED")
        a = Session(a_name)
        sessions.append(a)
        call = (f"public.community_moderate_artwork('{admin}','{artwork}',2,'approve',NULL)"
                if approval else f"public.community_set_artwork_like('{reactor}','{artwork}',true)")
        a.send(f"BEGIN; SET LOCAL ROLE service_role; SELECT {call}; COMMIT;")
        deadline = time.monotonic() + 10
        while True:
            blocked = required(f"""SELECT EXISTS(SELECT 1 FROM pg_stat_activity a
              JOIN pg_stat_activity b ON b.pid=ANY(pg_blocking_pids(a.pid))
              WHERE a.application_name='{a_name}' AND b.application_name='{b_name}');""")
            if blocked == "t":
                break
            if time.monotonic() > deadline:
                raise RuntimeError("Actual RPC never waited on the held author lock.")
            time.sleep(0.02)  # Poll actual lock state; time is not the synchronization condition.
        probe = sql(f"BEGIN; SELECT id FROM public.community_artworks WHERE id='{artwork}' FOR UPDATE NOWAIT; ROLLBACK;")
        if old_order:
            assert probe.returncode and "55P03" in probe.stderr, "Old-order reproduction did not hold artwork first."
        else:
            assert probe.returncode == 0, "RPC held artwork while blocked on author: " + probe.stderr
        mutation = (f"DELETE FROM auth.users WHERE id='{owner}';" if auth_delete
                    else f"UPDATE public.community_profiles SET suspended_at=now() WHERE user_id='{owner}';")
        b.send(mutation + " COMMIT;")
        b_code, b_text = b.finish()
        a_code, a_text = a.finish()
        if old_order:
            assert "40P01" in a_text + b_text, "Old inversion did not produce a genuine PostgreSQL deadlock."
            print(kind + ": reproduced original 40P01 (diagnostic only)")
            return
        assert b_code == 0, b_text
        assert "40P01" not in a_text + b_text, a_text + b_text
        if approval:
            assert a_code != 0 and ("42501" in a_text or "40001" in a_text), a_text
            assert required(f"SELECT status FROM public.community_artworks WHERE id='{artwork}';") == "pending"
        else:
            assert a_code == 0, a_text
            payload = next(json.loads(line) for line in a.lines if line.startswith("{"))
            assert payload == {"available": False, "liked": False, "likesCount": 0}, payload
        assert required(f"SELECT count(*) FROM public.community_artwork_likes WHERE artwork_id='{artwork}';") == "0"
        assert required(f"SELECT likes_count FROM public.community_artworks WHERE id='{artwork}';") == "0"
        print(kind + ": PASS — observed author wait, artwork remained free, lifecycle committed, reaction/approval denied safely")
    finally:
        for session in sessions:
            session.stop()
        # UUIDs generated by this invocation are the entire cleanup boundary.
        required(f"""BEGIN;
        DELETE FROM public.community_moderation_events WHERE artwork_id='{artwork}';
        DELETE FROM public.community_artworks WHERE id='{artwork}';
        DELETE FROM public.products WHERE id='{product}';
        DELETE FROM auth.users WHERE id IN ('{owner}','{reactor}','{admin}'); COMMIT;""")


if __name__ == "__main__":
    identity = subprocess.check_output(["docker", "inspect", "--format", "{{.Name}}", CONTAINER], text=True).strip()
    assert identity == "/" + CONTAINER, "Unexpected database container."
    assert required("SELECT current_database();") == "postgres"
    diagnostic = sys.argv[1:] == ["--reproduce-old-order"]
    assert not sys.argv[1:] or diagnostic, "Unsupported test option."
    for test_kind in (["heart-profile"] if diagnostic else ["heart-profile", "heart-auth", "approve-profile", "approve-auth"]):
        scenario(test_kind, diagnostic)
