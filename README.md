# A field instrument for randomized AI interventions

This repository contains a Chrome extension and research server for running
randomized experiments on AI writing assistance on Reddit and X. Participants
install the extension and use the platforms as they normally would. When they write
a reply, the extension offers AI suggestions whose content is set by the arm they
are randomly assigned to. It also logs each step from the first draft to the
published reply.

The extension is published on the Chrome Web Store: https://chromewebstore.google.com/detail/digital-media-research/fbgciapdfloecjllcljokeidadlmdnif?

> **For reviewers.** You can run the whole pipeline on your own machine without
> any credentials. See [Quick start: demonstration mode](#quick-start-demonstration-mode).
> No participant data are included in this repository. The analysis scripts run on
> a synthetic dataset with the same structure as the logged data.

---

## How it works

| Component | Where | What it does |
|---|---|---|
| Chrome extension | `src/`, `manifest.json`, `popup.html` | Detects the reply box on Reddit and X, requests suggestions as the participant types, shows them inline in grey (Tab accepts), and sends logging events to the server. |
| Research server | `server/app.py` | Flask app. Assigns each installation to an arm, builds the prompt for that arm, calls the language model, and writes logs to the database. |
| Study configuration | `server/experiment_config.yaml` | Defines the model, the arms, their assignment probabilities, and the prompt templates. |
| Survey configuration | `server/surveys_config.json` | Defines in-extension survey invitations, reminders, and follow-up waves (see `server/surveys_config_instructions.md`). |
| Posting-history job | `cron/` | Scheduled job that collects the public posting history of participants' linked Reddit/X accounts for pre-treatment baselines and later outcomes. |
| Analysis | `analysis/` | Synthetic data generator and the instrument validation checks. |

### Assignment

When the extension is installed, it creates a random identifier (UUID v4) and asks
the server for an arm (`/fetch_functionality`). The server draws one with the
probabilities in `experiment_config.yaml`, stores it in the `Usernames` table, and
returns the stored arm on every later request. Each installation therefore stays in
one arm across sessions. Researchers can move an installation to another arm by
editing `treatment_status` in the `Usernames` table.

### What is logged

Each post a participant opens gets one row in `CombinedActivity`, which records the
writing process from first draft to published reply (see
[Database tables](#database-tables)). The extension also logs:

- installations and their arms (`Usernames`);
- session-level activity on Reddit, X, and the sites in `urls.json`: time on page and counts of clicks, scrolls, and key presses, but not their content (`UserActivity`);
- participants' suggestion settings (`User Preferences`);
- the public posting history of linked accounts, collected by the scheduled job (`RedditHistory`, `TwitterHistory`).

---

## Database tables

The server writes to a Supabase (PostgreSQL) database. All tables are linked by
`UUID`, the random identifier created when the extension is installed. Timestamps
are ISO 8601 in UTC unless noted.

### CombinedActivity: one row per post opened

This is the main table for analysis. Each row follows one post from the moment the
participant opens it to the reply they publish, and links every suggestion to the
draft it was generated for and to the decision the participant made.

| Column | Type | Description |
|---|---|---|
| `PostID` | text | `UUID` + `-` + time the post was opened (ms). Identifies the row together with `SessionID` and `UUID`. |
| `SessionID` | text | `UUID` + `-` + session start time (ms). Links the row to the browsing session. |
| `UUID` | text | Installation identifier. Joins to `Usernames`. |
| `Platform` | enum | `Reddit` or `Twitter` (X). |
| `URL` | text | Page address when the row was last updated. |
| `Webpage Open Time` | timestamp | When the participant opened the post. |
| `Parent Post ID` | text | Platform ID of the root post of the thread. |
| `Reply ID` | text | Platform ID of the comment being replied to, if the participant replied to a comment rather than the post. |
| `Parent Text` | text | Text of the post or comment being replied to. |
| `Post Information` | jsonb | Details of the post. Reddit: `title`, `subreddit`, `text`, `score` (upvotes minus downvotes). X: `text`, `imageSource`. |
| `Activity Object` | jsonb | The writing process for this post (structure below). |
| `Published Comment` | text | The reply the participant published, if any. |
| `Published Comment Time` | timestamp | When the reply was published. |
| `Published Comment ID` | text | Platform ID of the published reply, which links it to the responses it later receives. |
| `Ads Info` | jsonb | Ads on the page (structure below). |
| `Entry Timestamp` | timestamp | When the row was created (set by the database). |
| `Ads Seen On Post`, `Ads Loaded On Post` | array | Columns used by earlier versions. The current version records ads in `Ads Info`. |

**`Activity Object`** contains three time-ordered lists:

```json
{
  "Text Box Entries": [
    {"text": "I think it's quite likely", "timestamp": "..."}
  ],
  "Auto Completions": [
    {
      "suggestion": " given the unpredictable nature of ...",
      "userTyped": "I think it's quite likely we won't even get there",
      "prompt": "role: system, content: ...",
      "promptCategory": "informative",
      "model": "gpt-4.1-nano",
      "timestamp": "...",
      "accepted": true,
      "acceptedTimestamp": "..."
    }
  ],
  "Suggestions": [
    {"suggestion": "...", "userTyped": "...", "prompt": "...",
     "promptCategory": "informative", "model": "gpt-4.1-nano", "timestamp": "..."}
  ]
}
```

| Field | Description |
|---|---|
| `Text Box Entries` | Contents of the reply box, recorded about every two seconds while the participant types. |
| `Auto Completions` | Every inline suggestion shown. `userTyped` is the draft at the moment the suggestion was requested; `prompt` is the full prompt sent to the model; `promptCategory` is the arm's prompt name; `model` is the language model; `accepted` and `acceptedTimestamp` record whether and when the participant pressed Tab. |
| `Suggestions` | Full replies generated on request (when the arm's `suggest` option is on), with the same fields except the accept decision. |

The row is built from five events that the extension sends to `/update_combinedActivity`:
`pageView` (post opened; creates the row and adds post and ad information),
`textBoxEntry`, `gotCompletion` (suggestion shown), `acceptedAutoComplete`, and
`publishedComment`.

**`Ads Info`** records the advertisers whose ads were on the page:

| Field | Description |
|---|---|
| `adsLoaded` | Advertisers whose ads were loaded on the page. |
| `adsSeen` | Advertisers whose ads entered the visible part of the screen. |
| `adLog` | Time-ordered list of `{ad, becameVisible}` and `{ad, becameHidden}` events (ms timestamps). |
| `stoppedCollecting` | When ad collection for the page ended (ms). |

### Usernames: one row per installation

| Column | Type | Description |
|---|---|---|
| `UUID` | text | Installation identifier (UUID v4), created when the extension is installed. |
| `treatment_status` | text | Arm assigned to the installation (a block name in `experiment_config.yaml`). Edit this to reassign an installation. |
| `Extension Install Time` | timestamp | When the extension was installed. |
| `Reddit`, `Twitter` | array | Platform usernames the participant was logged in with while using the extension. |
| `Reddit Login Times`, `Twitter Login Times` | text (JSON) | List of `(username, time)` pairs recording when each account was first seen. |

### UserActivity: one row per browsing session on a tracked site

A session is one tab on a tracked site, from opening it until it is closed or hidden.
Rows are also written every five minutes during long sessions.

| Column | Description |
|---|---|
| `SessionID (UUIDxStartTime)` | `UUID` + `-` + session start time (ms). |
| `UUID` | Installation identifier. |
| `Website/Platform` | Site name or hostname. |
| `Session Start Timestamp`, `Session end Timestamp` | Start and end of the session. |
| `Total Session Time` | Session length (hh:mm:ss). |
| `Posts Opened` | Number of posts opened (Reddit and X). |
| `Total Clicks`, `Total Scrolls`, `Total Key presses` | Counts only; what was clicked or typed is not recorded. A scroll of one down-arrow press counts as 1. |
| `Opened Posts Links` | URLs of posts opened (not populated by the current version). |
| `Ads Info` | Session-level ad information (Reddit and X). |

### User Preferences: one row per settings change

| Column | Description |
|---|---|
| `PreferenceID` | `UUID` + time of the change. |
| `UUID` | Installation identifier. |
| `Time` | When the settings were changed. |
| `Length` | Suggested length (Short, Medium, or Long). |
| `Tone` | Balanced or Opinionated, or empty. |
| `Humor` | Funny or Serious, or empty. |
| `Additional Instructions` | Free-text instructions to the model (up to 200 characters). |
| `Sample Comments` | Example comments in the participant's own style (up to 200 characters). |

The length setting fills the `{length}` placeholder in the prompt templates; if
none is set, the server uses Medium. In the current version, the extension does not
send a value for `{combined_prompts}`, so tone, humor, and free-text instructions do
not enter the configured prompts. (The earlier prompt builder in `server/prompt.py`
used them.) The settings panel itself is commented out in `popup.html`.

### RedditHistory and TwitterHistory: posting history of linked accounts

Written by the scheduled job in `cron/`. For each username in `Usernames`, the job
stores the account's recent public activity, which gives pre-treatment baselines and
later outcomes.

| Table | Columns |
|---|---|
| `RedditHistory` | `UUID`, `Username`, `submissions`, `comments` |
| `TwitterHistory` | `UUID`, `Username`, `timeline`, `pinned`, `user`, `replies` |

### Earlier tables

Versions before May 2025 logged writing activity in separate `RedditActivity` and
`TwitterActivity` tables, with one row per logged action. The current version writes
all writing activity to `CombinedActivity` instead.

---

## Configuring a study

All study settings live in `server/experiment_config.yaml`. The extension itself
does not change between studies.

```yaml
gpt_model:
  name: gpt-4.1-nano        # model used for all arms
  temperature: 0.7
treatments:
  debug_t1:                 # arm label, logged with every suggestion
    functionality: comment_suggestion
    autocomplete: true      # inline suggestions while typing
    suggest: false          # full reply on request
    prompt: uninformative   # name of a template under `prompts`
    probability: 0.5        # share of new installations; must sum to 1
  debug_t2:
    functionality: comment_suggestion
    autocomplete: true
    suggest: false
    prompt: informative
    probability: 0.5
prompts:
  informative:
    system: >
      ...
    user_prompt: >
      ...
```

Prompt templates can use `{writtenText}` (the participant's draft so far), `{title}`
and `{text}` (the post being replied to), `{length}` (the participant's length
setting), and `{combined_prompts}` (other participant instructions; see
[User Preferences](#user-preferences-one-row-per-settings-change)). To add an arm, add a block under `treatments` and,
if needed, a template under `prompts`.

Changes take effect at different times:

| Change | Takes effect |
|---|---|
| Prompt text or model | The next suggestion |
| `autocomplete` / `suggest` | When the participant's browser restarts |
| `probability` | New installations only |

`functionality: comment_suggestion` is the only option implemented in the current
version. Proofreading code exists in `src/proofread/` but is not active.

---

## Quick start: demonstration mode

Demonstration mode runs the server without a database or credentials. Logs are
written to JSON files in `server/demo_data/`, one file per table, so you can see
exactly what a study would record. Without an OpenAI key, suggestions are a fixed
placeholder text. With a key, they are generated by the configured model.

**1. Run the server** (Python 3.9 or later)

```bash
cd server
pip install -r requirements.txt
DEMO_MODE=1 python app.py              # serves on http://127.0.0.1:5000
# optional, for real suggestions:
# DEMO_MODE=1 OPENAI_API_KEY=sk-... python app.py
```

**2. Load the extension**

The bundles in `dist/` are built to talk to `http://127.0.0.1:5000`
(set in `src/config.js`).

1. Open `chrome://extensions/` and turn on **Developer mode**.
2. Click **Load unpacked** and select this repository's root folder.
3. Open a post on Reddit or X and start typing a reply. Pause briefly to see a suggestion and press Tab to accept it.
4. Inspect `server/demo_data/CombinedActivity.json` to see the logged record.

Uninstall the store version of the extension first, if you have it, so that the two
do not run at the same time.

---

## Running a full deployment

1. **Database.** Create a Supabase project with the tables `Usernames`,
   `CombinedActivity`, `UserActivity`, and `User Preferences` (and `RedditHistory`
   and `TwitterHistory` if you use the posting-history job). Enable row-level
   security, and give the server a key that can only write to these tables.
2. **Server.** Copy `server/.env.example` to `server/.env` and fill it in. Deploy
   with the included `Dockerfile` (for example, to Google Cloud Run).
3. **Extension.** Set `SERVER_ENDPOINT` in `src/config.js` to your server's URL,
   then rebuild:
   ```bash
   npm install
   npx webpack
   ```
4. **Posting-history job (optional).** See `cron/README.md`. It needs Reddit API
   and RapidAPI (X) credentials.

Never commit `.env` files or keys. `.gitignore` excludes them.

---

## Analysis on synthetic data

```bash
cd analysis
pip install pandas numpy tabulate
python make_synthetic_data.py synthetic_CombinedActivity.csv     # simulated data, same columns as the real export
python validation_checks.py synthetic_CombinedActivity.csv out/  # validation tables
```

`validation_checks.py` checks the following:

- **Coverage:** how many writing episodes were captured at each step, from opening a post to publishing.
- **Completeness:** whether every suggestion carries its arm, prompt, draft, timestamp, and accept decision.
- **Validity:** whether accepted suggestions appear in the published text far more than rejected ones.
- **Assignment:** whether each installation stayed in one arm.
- **Composition:** the share of each published reply that came from the participant's own draft versus from AI suggestions.

To run it on real data, export the `CombinedActivity` table from Supabase as CSV and
pass that file instead. The synthetic data are simulated from illustrative
parameters and say nothing about real behavior.

---

## Data and ethics

- The repository contains no participant data and no credentials.
- Studies using this instrument should obtain ethics (IRB) approval and informed
  consent. The consent materials should describe everything listed under
  "What is logged", including the posting-history job and the ad and session
  activity logging.
- `urls.json` is a short example list. Replace it with the sites relevant to your study.

## License

MIT. See `LICENSE`.
