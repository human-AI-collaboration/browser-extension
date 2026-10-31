"""
Instrument validation checks.

Input : the CombinedActivity table exported from Supabase (CSV), or the synthetic
        file produced by make_synthetic_data.py, which has the same structure.
Output: validation tables (CSV + Markdown) in the output folder.

    python validation_checks.py CombinedActivity_rows.csv out/ \
        [RedditActivity_rows.csv TwitterActivity_rows.csv Usernames_rows.csv]

The three optional tables (older activity tables and the installation registry)
add the overall scale of testing to the coverage table: total installations across
all tables, and the number of distinct linked platform accounts (a lower bound on
the number of testers, since most installations record no account).

What it checks
  Coverage: how many writing episodes the instrument captured at each step,
      from opening a post to publishing a reply.
  Completeness: whether every logged suggestion carries the fields the
      design needs (arm, form, prompt, the draft it was generated for, timing).
  Validity: whether logged accept/reject decisions agree with what appears
      in the published text (retention of accepted vs. rejected autocompletes),
      overall and for each installation separately.
  Assignment: whether each installation stayed in one arm across sessions.
  Composition: draft-to-published composition of published replies (descriptive only).

These are checks on the instrument (does it log what it should, and do the logs
agree with what was published), not estimates of how people use AI.
"""
import json, re, sys, os
import numpy as np
import pandas as pd

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
df = pd.read_csv(src)
df["A"] = df["Activity Object"].map(json.loads)
tok = lambda s: re.findall(r"[a-z0-9']+", s.lower()) if isinstance(s, str) else []

def lcs_hits(a, b, avail=None):
    """Positions in b matched by the longest common subsequence with a (word level)."""
    n, m = len(a), len(b)
    if not n or not m: return set()
    dp = np.zeros((n + 1, m + 1), dtype=np.int32)
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            ok = a[i] == b[j] and (avail is None or j in avail)
            dp[i, j] = dp[i + 1, j + 1] + 1 if ok else max(dp[i + 1, j], dp[i, j + 1])
    i = j = 0; hit = set()
    while i < n and j < m:
        ok = a[i] == b[j] and (avail is None or j in avail)
        if ok and dp[i, j] == dp[i + 1, j + 1] + 1: hit.add(j); i += 1; j += 1
        elif dp[i + 1, j] >= dp[i, j + 1]: i += 1
        else: j += 1
    return hit

# ---------- suggestion-level table -------------------------------------------
S = []
for _, r in df.iterrows():
    pub = r["Published Comment"] if isinstance(r["Published Comment"], str) else None
    for key, form in [("Auto Completions", "Inline autocomplete"), ("Suggestions", "Full reply on request")]:
        for s in r.A[key]:
            S.append(dict(install=r.UUID, post=r.PostID, platform=r.Platform, form=form,
                          arm=s.get("promptCategory"), accepted=s.get("accepted"),
                          has_prompt=bool(s.get("prompt")), has_typed="userTyped" in s,
                          has_time=bool(s.get("timestamp")),
                          t=pd.to_datetime(s.get("timestamp")),
                          ta=pd.to_datetime(s["acceptedTimestamp"]) if s.get("acceptedTimestamp") else pd.NaT,
                          suggestion=s.get("suggestion") or "", published=pub))
S = pd.DataFrame(S)
S["latency_s"] = (S.ta - S.t).dt.total_seconds()
S["retention"] = [len(lcs_hits(tok(p), tok(x))) / len(tok(x)) if isinstance(p, str) and tok(x) else np.nan
                  for p, x in zip(S.published, S.suggestion)]
S.drop(columns=["suggestion", "published"]).to_csv(f"{out}/suggestions.csv", index=False)

tables = {}

# ---------- coverage -------------------------------------------------------
typed = df.A.map(lambda a: len(a["Text Box Entries"]) > 0)
shown = df.A.map(lambda a: len(a["Suggestions"]) + len(a["Auto Completions"]) > 0)
pub = df["Published Comment"].notna()
A3 = pd.DataFrame([
    ("Posts opened", len(df)),
    ("Posts where writing started (typing or suggestion logged)", int((typed | shown | pub).sum())),
    ("Posts where at least one AI suggestion was shown", int(shown.sum())),
    ("Replies published", int(pub.sum())),
    ("Published replies linked to the suggestions shown", int((pub & shown).sum())),
    ("Posts with suggestions shown but no reply published", int((shown & ~pub).sum())),
], columns=["Step", "Count"])
A3.loc[len(A3)] = ("Installations in the data", df.UUID.nunique())
A3.loc[len(A3)] = ("Installations with a published reply", df[pub].UUID.nunique())

if len(sys.argv) >= 6:
    rd, tw, us = (pd.read_csv(p) for p in sys.argv[3:6])
    us = us[us.UUID.astype(str).str.match(r"^[0-9a-f-]{36}$")]
    all_inst = set(df.UUID) | set(rd.UUID) | set(tw.UUID) | set(us.UUID)
    dates = pd.concat([pd.to_datetime(s, format="mixed", errors="coerce", utc=True) for s in
                       (df["Webpage Open Time"], rd["Webpage Open Time"], tw["Webpage Open Time"],
                        us["Extension Install Time"])]).dropna()
    # distinct linked accounts: installations joined by any shared Reddit/X handle
    parent = {}
    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for _, r in us.iterrows():
        handles = []
        for col in ("Reddit", "Twitter"):
            try: handles += [f"{col}:{h}" for h in json.loads(r[col])]
            except (TypeError, ValueError): pass
        if handles:
            find("i:" + r.UUID)
            for h in handles: parent[find("i:" + r.UUID)] = find(h)
    accounts = {find(k) for k in parent if k.startswith("i:")}
    A3.loc[len(A3)] = (f"Installations across all tables ({dates.min():%B %Y} to {dates.max():%B %Y})", len(all_inst))
    A3.loc[len(A3)] = ("Distinct linked test accounts (lower bound on testers)", len(accounts))
tables["coverage"] = A3

# ---------- completeness ---------------------------------------------------
rows = []
for form, g in S.groupby("form"):
    rows.append(dict(Form=form, Suggestions=len(g),
        **{"Arm logged": f"{g.arm.notna().mean():.0%}",
           "Prompt logged": f"{g.has_prompt.mean():.0%}",
           "Draft at time of suggestion logged": f"{g.has_typed.mean():.0%}",
           "Timestamp logged": f"{g.has_time.mean():.0%}",
           "Accept decision logged": f"{g.accepted.notna().mean():.0%}"}))
tables["completeness"] = pd.DataFrame(rows)

# ---------- validity: accepted vs rejected retention ----------------------
ac = S[(S.form == "Inline autocomplete") & S.retention.notna()].copy()
ac["Decision"] = ac.accepted.map({True: "Accepted", False: "Rejected"})
def summ(g):
    return pd.Series({"Suggestions": len(g), "Mean retention": f"{g.retention.mean():.0%}",
                      "Median retention": f"{g.retention.median():.0%}"})
overall = ac.groupby("Decision").apply(summ, include_groups=False).reset_index()
overall.insert(0, "Installation", "All")
by_inst = ac.groupby(["install", "Decision"]).apply(summ, include_groups=False).reset_index()
keep = by_inst.groupby("install").Decision.nunique().loc[lambda s: s == 2].index
by_inst = by_inst[by_inst.install.isin(keep)]
labels = {u: f"Tester {i+1}" for i, u in enumerate(sorted(keep))}
by_inst["Installation"] = by_inst.install.map(labels)
tables["validity"] = pd.concat([overall, by_inst.drop(columns="install")[overall.columns]], ignore_index=True)
lat = S[(S.form == "Inline autocomplete") & (S.accepted == True)].latency_s.dropna()
latency_note = (f"Accepted autocompletes: n = {len(lat)}, median time to accept "
                f"{lat.median():.1f} s (interquartile range {lat.quantile(.25):.1f}-{lat.quantile(.75):.1f} s).")

# ---------- assignment persistence ----------------------------------------
arms = S.groupby("install").arm.nunique()
tables["assignment"] = pd.DataFrame([
    ("Installations that received suggestions", len(arms)),
    ("Installations with exactly one arm across all sessions", int((arms == 1).sum())),
    ("Installations with more than one arm", int((arms > 1).sum())),
], columns=["Check", "Count"])

# ---------- composition of published replies ------------------------------
R = []
for _, r in df[pub].iterrows():
    sugs = sorted([s for k in ("Auto Completions", "Suggestions") for s in r.A[k]], key=lambda s: s["timestamp"])
    pw = tok(r["Published Comment"])
    if not pw: continue
    draft = (sugs[0].get("userTyped") or "") if sugs else r["Published Comment"]
    own = lcs_hits(tok(draft), pw); ai = set()
    for s in sugs:
        if s.get("accepted") is False and "acceptedTimestamp" in s and s in r.A["Auto Completions"]:
            continue  # rejected inline suggestions never entered the reply box
        ai |= lcs_hits(tok(s.get("suggestion")), pw, set(range(len(pw))) - own - ai)
    R.append(dict(ai_share=len(ai) / len(pw), draft_words=len(tok(draft)), any_suggestion=bool(sugs)))
R = pd.DataFrame(R)
bins = pd.cut(R.ai_share, [-.001, .1, .5, .9, 1.0], labels=["Under 10%", "10-50%", "50-90%", "Over 90%"])
A7 = bins.value_counts().sort_index().rename_axis("Share of published words from AI").reset_index(name="Replies")
tables["composition"] = A7
comp_note = (f"{len(R)} published replies with text; {int((~R.any_suggestion).sum())} had no suggestion shown. "
             f"Median draft length before the first suggestion: {R[R.any_suggestion].draft_words.median():.0f} words.")

# ---------- write --------------------------------------------------------------
with open(f"{out}/validation_tables.md", "w") as f:
    for name, t in tables.items():
        t.to_csv(f"{out}/{name}.csv", index=False)
        f.write(f"## {name}\n\n{t.to_markdown(index=False)}\n\n")
    f.write(latency_note + "\n\n" + comp_note + "\n")
print(open(f"{out}/validation_tables.md").read())
