"""
Generate a synthetic CombinedActivity table with the same structure as the one the
instrument logs, so that the analysis scripts can be run without participant data.

    python make_synthetic_data.py synthetic_CombinedActivity.csv [n_installations] [seed]

Everything in the output is simulated: installations, posts, drafts, suggestions,
accept/reject decisions, and published replies. The text is assembled from a small
fixed vocabulary and is not meaningful. The parameters below (acceptance rate,
time to accept, how much of an accepted suggestion people keep) are illustrative
and are not estimates from real data.
"""
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

out = sys.argv[1] if len(sys.argv) > 1 else "synthetic_CombinedActivity.csv"
N_INSTALL = int(sys.argv[2]) if len(sys.argv) > 2 else 40
rng = np.random.default_rng(int(sys.argv[3]) if len(sys.argv) > 3 else 2026)

# ---- illustrative simulation parameters --------------------------------------
ARMS = {"debug_t1": "uninformative", "debug_t2": "informative"}  # arm -> prompt name
P_WRITE = 0.35          # share of opened posts where the person starts writing
P_ACCEPT = 0.6          # probability an inline suggestion is accepted (Tab)
P_PUBLISH = 0.55        # probability a started reply is published
KEEP_ACCEPTED = 0.85    # share of an accepted suggestion's words kept when publishing

OPENERS = ["I think", "Honestly", "Not sure but", "In my experience", "I agree that",
           "I disagree because", "The thing is", "Good point but"]
OWN = ("this seems like a reasonable take and people often miss the bigger picture "
       "when the details get messy so it helps to look at what actually happened").split()
INFORMATIVE = ("recent studies show that outcomes depend on incentives local context "
               "implementation costs and how evidence is measured across different groups "
               "which suggests comparing alternatives before deciding").split()
UNINFORMATIVE = "it is what it is and that is just how things are anyway".split()
TOPICS = ["New policy announced for remote work", "Is this a good first car?",
          "City council approves housing plan", "Why do prices keep rising?",
          "Best way to learn statistics", "Debate: four-day work week"]


def words(pool, k):
    start = rng.integers(0, max(1, len(pool) - k))
    return pool[start:start + k]


def iso(t):
    return t.isoformat()


rows = []
t0 = datetime(2026, 3, 1, tzinfo=timezone.utc)
for i in range(N_INSTALL):
    uid = str(uuid.UUID(int=int(rng.integers(0, 2**63)) << 64 | int(rng.integers(0, 2**63)), version=4))
    arm = rng.choice(list(ARMS))
    prompt_name = ARMS[arm]
    platform = rng.choice(["Reddit", "Twitter"])
    session_start = t0 + timedelta(days=float(rng.uniform(0, 60)))
    session_ms = int(session_start.timestamp() * 1000)
    for j in range(int(rng.integers(3, 25))):
        open_time = session_start + timedelta(minutes=float(j * rng.uniform(1, 6)))
        open_ms = int(open_time.timestamp() * 1000)
        title = rng.choice(TOPICS)
        A = {"Text Box Entries": [], "Auto Completions": [], "Suggestions": []}
        published = pub_time = None
        if rng.random() < P_WRITE:
            t = open_time + timedelta(seconds=float(rng.uniform(5, 40)))
            draft = rng.choice(OPENERS).split() + words(OWN, int(rng.integers(0, 4)))
            A["Text Box Entries"].append({"text": " ".join(draft), "timestamp": iso(t)})
            reply = list(draft)
            for _ in range(int(rng.integers(1, 4))):
                t += timedelta(seconds=float(rng.uniform(1.5, 3)))
                pool = INFORMATIVE if prompt_name == "informative" else UNINFORMATIVE
                sug = words(pool, int(rng.integers(5, 12)) if prompt_name == "informative" else int(rng.integers(3, 7)))
                accepted = bool(rng.random() < P_ACCEPT)
                acc_t = t + timedelta(seconds=float(rng.lognormal(np.log(1.3), 0.5))) if accepted else None
                A["Auto Completions"].append({
                    "suggestion": " " + " ".join(sug),
                    "userTyped": " ".join(reply),
                    "prompt": f"[synthetic prompt for the {prompt_name} arm]",
                    "promptCategory": prompt_name,
                    "model": "gpt-4.1-nano",
                    "timestamp": iso(t),
                    "accepted": accepted,
                    "acceptedTimestamp": iso(acc_t) if acc_t else None,
                })
                if accepted:
                    kept = [w for w in sug if rng.random() < KEEP_ACCEPTED]
                    reply += kept
                    t = acc_t
                else:
                    reply += words(OWN, int(rng.integers(1, 4)))
                t += timedelta(seconds=2)
                A["Text Box Entries"].append({"text": " ".join(reply), "timestamp": iso(t)})
            if rng.random() < P_PUBLISH:
                published = " ".join(reply + words(OWN, int(rng.integers(0, 3))))
                pub_time = iso(t + timedelta(seconds=float(rng.uniform(2, 20))))
        rows.append({
            "PostID": f"{uid}-{open_ms}",
            "SessionID": f"{uid}-{session_ms}",
            "UUID": uid,
            "Webpage Open Time": iso(open_time),
            "Published Comment Time": pub_time,
            "URL": f"https://example.com/{platform.lower()}/post/{i}-{j}",
            "Parent Text": f"[synthetic post] {title}",
            "Published Comment": published,
            "Activity Object": json.dumps(A),
            "Ads Seen On Post": None,
            "Entry Timestamp": iso(open_time),
            "Post Information": json.dumps({"title": title}),
            "Platform": platform,
            "Reply ID": None,
            "Parent Post ID": f"synthetic-{i}-{j}",
            "Ads Loaded On Post": None,
            "Published Comment ID": f"synthetic-c-{i}-{j}" if published else None,
            "Ads Info": json.dumps({}),
        })

df = pd.DataFrame(rows)
df.to_csv(out, index=False)
print(f"Wrote {len(df)} synthetic posts from {N_INSTALL} installations to {out}")
