"""Run against the local stack; credentials stay in process memory, not logs."""
import json, os, subprocess
status = json.loads(subprocess.check_output(['supabase', 'status', '--output', 'json'], stderr=subprocess.DEVNULL))
env = os.environ.copy()
for target, source in [('LOCAL_SUPABASE_URL','API_URL'), ('LOCAL_SUPABASE_SERVICE_KEY','SERVICE_ROLE_KEY'), ('LOCAL_SUPABASE_ANON_KEY','ANON_KEY')]:
    env[target] = status[source]
raise SystemExit(subprocess.call(['deno','run','--allow-env','--allow-net=127.0.0.1:56321','tests/integration/local-api.ts'], env=env))
