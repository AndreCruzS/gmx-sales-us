"""Build the one-off SQL that imports PK Control's October groups (export 2026-11-06)."""
import re, sys, uuid, datetime as dt
import openpyxl

SRC, OUT, MODE = sys.argv[1], sys.argv[2], sys.argv[3]  # MODE: dry | real
NS = uuid.UUID("6f1c2b0e-4c55-4b8e-9a43-7d2f8a0c1e11")
uid = lambda *k: str(uuid.uuid5(NS, "|".join(k)))
ORG = "11111111-1111-1111-1111-111111111111"
BIANCA = "c0000000-0000-0000-0000-000000000001"
ANDRE = "21fd7128-ee0a-4a9f-b698-f73ed41a3b52"
AUTHORS = {"andre.matias": BIANCA}
REF = "pk-control-export-2026-11-06"

HEBER = uid("account", "bfs-heber")
GROUPS = {
    "CAPITAL LUMBER SLC/UT": dict(acct="d0000000-0000-0000-0000-000000000009", where="Salt Lake City, UT", who="João, Bianca"),
    "BFS Heber  DAVE FAGG": dict(acct=HEBER, where="Heber City, UT", who="Dave Fagg (BFS); João, Bianca"),
    "BURTON LUMBER": dict(acct="fa97e541-5ea7-4c8f-867a-c657b3c70f3f", where="Heber City, UT", who=None),
}
def group_of(name):
    for k in GROUPS:
        if name.startswith(k):
            return k
    raise SystemExit(f"unknown group {name!r}")

PRIO = {"URGENT / IMPORTANT": "DO_NOW", "NOT URGENT / IMPORTANT": "PLAN",
        "URGENT / NOT IMPORTANT": "DELEGATE", "URGENTE / NOT IMPORTANT": "DELEGATE",
        "NOT URGENT / NOT IMPORTANT": "ELIMINATE"}
DEFAULT_DAYS = {"DO_NOW": 1, "PLAN": 7, "DELEGATE": 2}
NOTE_RE = re.compile(r"(?m)^(\d+)\. ([\w.]+) \S (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})( \(edited\))?\n")

def q(s):
    return "null" if s is None else "$q$" + s.replace("$q$", "") + "$q$"

wb = openpyxl.load_workbook(SRC, data_only=True)
ov = list(wb["Overview"].iter_rows(values_only=True))
H = ov[0]
rows = [dict(zip(H, r)) for r in ov[1:] if r[0]]
SH = [c.value for c in wb["Subtasks"][1]]
subs = [dict(zip(SH, r)) for r in wb["Subtasks"].iter_rows(min_row=2, values_only=True) if r[0]]

sql = ["begin;", "set local search_path = public;"]
sql.append(f"""insert into accounts (id, org_id, name, account_type, city, state, territory_id, owner_id, lead_source, source_detail, parent_account_id)
values ('{HEBER}', '{ORG}', 'Builders FirstSource Heber', 'DEALER', 'Heber City', 'UT', 'b0000000-0000-0000-0000-000000000012', '{BIANCA}',
 'EXISTING_RELATIONSHIP', {q('From PK Control (gmxreviews.com): BFS Heber, Dave Fagg. Imported 2026-11-06.')}, 'b884c2d0-7f27-462b-8d96-4037215d90f7')
on conflict (id) do nothing;""")

acts = {}
for r in rows:
    g = group_of(r["Client / Group"])
    if g in acts:
        continue
    a = GROUPS[g]
    aid = uid("activity", g)
    acts[g] = (aid, r["Meeting Date"])
    who = a["who"] or r["Participants"]
    text = f"Meeting from PK Control (gmxreviews.com), imported 2026-11-06. Participants: {who}."
    sql.append(f"""insert into activities (id, org_id, activity_type, primary_account_id, owner_id, occurred_at, location, purpose, what_happened, follow_up_required)
values ('{aid}', '{ORG}', 'PK_TRAINING', '{a['acct']}', '{BIANCA}', ('{r['Meeting Date']} 12:00')::timestamp at time zone 'America/Denver', {q(a['where'])}, {q('PK Control meeting')}, {q(text)}, true)
on conflict (id) do nothing;""")

counts = dict(items=0, notes=0, subtasks=0)
for r in rows:
    g = group_of(r["Client / Group"])
    aid, mdate = acts[g]
    nid = uid("item", g, r["Action / Task"])
    prio = PRIO.get((r["Action Priority"] or "").strip())
    alert = r["Alert Date"] or r["Next Follow-up Date"] or None
    md = dt.date.fromisoformat(mdate)
    if prio and prio != "ELIMINATE":
        due = dt.date.fromisoformat(alert) if alert else md + dt.timedelta(days=DEFAULT_DAYS[prio])
        days = (due - md).days
    else:
        due, days = dt.date(2026, 11, 6), None  # no priority yet: due the day it was imported, not the meeting day
    progress = "WAITING" if r["Action Required / Read Notes"] == "AWAITING RESPONSE" else "WORKING_ON_IT"
    notes = r["Notes / Updates"] or ""
    parts = NOTE_RE.split(notes)
    parsed = []  # (author, ts, edited, body)
    for i in range(1, len(parts), 5):
        parsed.append((parts[i + 1], parts[i + 2], bool(parts[i + 3]), parts[i + 4].strip()))
    if notes and not parsed:
        raise SystemExit(f"notes not parsed: {r['Action / Task']}")
    created = parsed[0][1] if parsed else f"{mdate} 18:00:00"
    sql.append(f"""insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('{nid}', '{ORG}', {q(r['Action / Task'])}, '{BIANCA}', '{due}', '{GROUPS[g]['acct']}', '{aid}', 'MANUAL', '{REF}', '{BIANCA}',
 {q(prio) if prio else 'null'}, {days if days is not None else 'null'}, '{progress}', ('{created}')::timestamp at time zone 'UTC')
on conflict (id) do nothing;""")
    counts["items"] += 1
    for n, (author, ts, edited, body) in enumerate(parsed, 1):
        if author not in AUTHORS:
            raise SystemExit(f"unknown author {author}")
        sql.append(f"""insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('{uid('note', nid, str(n))}', '{ORG}', '{nid}', '{AUTHORS[author]}', {q(body)}, ('{ts}')::timestamp at time zone 'UTC', {"('" + ts + "')::timestamp at time zone 'UTC'" if edited else 'null'})
on conflict (id) do nothing;""")
        counts["notes"] += 1
    if r["Attachments"]:
        sql.append(f"-- attachments not imported for {r['Action / Task']!r}: {r['Attachments']}")
    pos = 0
    for s in subs:
        if s["Client / Group"] == r["Client / Group"] and s["Task"] == r["Action / Task"]:
            done = "now()" if s["Completed"] == "Yes" else "null"
            sql.append(f"""insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('{uid('subtask', nid, str(pos))}', '{ORG}', '{nid}', {q(s['Subtask'])}, {done}, {pos}, '{BIANCA}')
on conflict (id) do nothing;""")
            pos += 1
            counts["subtasks"] += 1
    exp = int(str(r["Subtasks Completed"]).split(" of ")[1])
    if exp != pos:
        raise SystemExit(f"subtask count mismatch {r['Action / Task']}: {pos} vs {exp}")

sql.append(f"""select (select count(*) from activities where id in ({",".join("'" + a + "'" for a, _ in acts.values())})) activities,
 (select count(*) from next_actions where source_ref = '{REF}') items,
 (select count(*) from next_action_notes n join next_actions a on a.id = n.next_action_id where a.source_ref = '{REF}') notes,
 (select count(*) from next_action_subtasks s join next_actions a on a.id = s.next_action_id where a.source_ref = '{REF}') subtasks,
 (select count(*) from next_actions where source_ref = '{REF}' and priority is not null) prioritised,
 (select count(*) from next_actions where source_ref = '{REF}' and progress = 'WAITING') waiting;""")
sql.append("rollback;" if MODE == "dry" else "commit;")
open(OUT, "w", encoding="utf-8").write("\n".join(sql) + "\n")
print(counts, file=sys.stderr)
