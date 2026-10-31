# Digital Media Research: a field instrument for randomized AI writing interventions

This repository contains a Chrome extension and research server for running
randomized experiments on AI writing assistance on Reddit and X. Participants
install the extension and use the platforms as they normally would. When they write
a reply, the extension offers AI suggestions whose content is set by the arm they
are randomly assigned to. It also logs each step from the first draft to the
published reply.

The extension is published on the Chrome Web Store as **Digital Media Research**.

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

### What is logged for each reply

Each post the participant opens gets one row in the `CombinedActivity` table. Its
`Activity Object` field records:

- **Text Box Entries**: the contents of the reply box, sent about every two seconds while the participant types.
- **Auto Completions**: every inline suggestion shown, with the draft it was generated for (`userTyped`), the prompt, the arm's prompt name (`promptCategory`), the model, the time it was shown, and whether and when it was accepted.
- **Suggestions**: full replies generated on request (when the `suggest` option is on), with the same fields.

The row also stores the published reply and its platform ID, the text being replied
to, post information, and ads loaded and seen on the page. The extension also records
session-level activity (time on page, numbers of clicks, scrolls, and key presses, but
not their content) on Reddit, X, and the sites listed in `urls.json`.

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
and `{text}` (the post being replied to), and `{length}` and `{combined_prompts}`
(the participant's settings). To add an arm, add a block under `treatments` and,
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
