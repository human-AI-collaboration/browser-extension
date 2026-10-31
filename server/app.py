from flask import Flask, request, jsonify, make_response
from flask_cors import CORS, cross_origin
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import requests
import re
from supabase import create_client, Client
import json
from openai import OpenAI
from prompt import generate_prompts
from dotenv import load_dotenv
import os
from combinedActivity import CombinedActivity
import requests
import random
from pathlib import Path
import math
import yaml
from urllib.parse import urljoin

load_dotenv()

# Demonstration mode: run the full pipeline without a database or credentials.
# Logged data are written to server/demo_data/ as JSON files, and if no OpenAI key
# is set, suggestions are replaced by a fixed placeholder text.
DEMO_MODE = os.getenv("DEMO_MODE", "0") == "1"

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
TWITTER_RAPIDAPI_KEY = os.getenv('TWITTER_RAPIDAPI_KEY')
REDDIT_CLIENT_ID = os.getenv('REDDIT_CLIENT_ID')
REDDIT_CLIENT_SECRET = os.getenv('REDDIT_CLIENT_SECRET')

DEFAULT_TREATMENT = "default_treatment"

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

app = Flask(__name__)
limiter = Limiter(
    app=app,
    key_func=get_remote_address
)

CORS(app, resources={
    r"/*": {
        "origins": ["https://www.reddit.com", "https://new.reddit.com", "https://old.reddit.com", "https://x.com"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

_script_dir = Path(__file__).parent

if DEMO_MODE:
    from local_store import LocalStore
    supabase = LocalStore(_script_dir / "demo_data")
    print("DEMO_MODE: logging to", _script_dir / "demo_data")
else:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    assert url and key, "Missing Supabase URL or Key (set DEMO_MODE=1 to run without a database)"
    supabase: Client = create_client(url, key)

class ExperimentConfig:
    def __init__(self, config_path=_script_dir / "experiment_config.yaml"):
        # Load config
        with open(config_path, "r") as f:
            self.config = yaml.safe_load(f)

        self.treatments = self.config["treatments"]
        self.prompts = self.config["prompts"]

        # Language model used for all arms, read from the gpt_model section
        model_config = self.config.get("gpt_model", {})
        self.model = model_config.get("name", "gpt-4.1-nano")
        self.temperature = model_config.get("temperature", 0.7)

        # Verify that probabilites add to 1
        assert math.isclose(sum([treatment["probability"] for treatment in self.treatments.values()]), 1), "The probabilities of the treatments do not add up to 1"

    def sample_treatment(self):
        """
        Sample a treatment from the experiment configuration based on the
        treatment probabilities
        """
        r = random.random()
        for treatment in self.treatments:
            r -= self.treatments[treatment]["probability"]
            if r <= 0:
                return treatment
        raise ValueError("Probabilities do not add up to 1")

    def get_prompt(self, treatment):
        """
        Given a treatment, returns the corresponding prompt.
        """
        if treatment not in self.treatments:
            print(f"Invalid treatment: {treatment}")
            return None
        # TODO: add a phony prompt called "default" so that if any prompt is missing a 
        # field we take it from there.
        prompt_category = self.treatments[treatment]["prompt"];
        return {**self.prompts[prompt_category], "treatment": treatment, "prompt_category": prompt_category}

    def get_treatment_settings(self, treatment):
        """
        Given a treatment, returns the settings for that treatment.
        """
        if treatment not in self.treatments:
            print(f"Invalid treatment: {treatment}")
            return None

        return {
            "treatment": treatment,
            "functionality": self.treatments[treatment]["functionality"],
            "suggest": self.treatments[treatment]["suggest"],
            "autocomplete": self.treatments[treatment]["autocomplete"],
        }

    def get_completion(self, messages):
        if openai_client is None:
            if DEMO_MODE:
                return None  # handled by the caller with a placeholder suggestion
            raise RuntimeError("OPENAI_API_KEY is not set")
        return openai_client.chat.completions.create(model=self.model, messages=messages, temperature=self.temperature)

experiment_config = ExperimentConfig()

surveys_config = {"enabled": False, "error": True}
try:
    with open(_script_dir / "surveys_config.json", "r") as f:
        surveys_config = json.load(f)
except FileNotFoundError:
    print("No surveys_config.json found, using default configuration.")

@app.route('/check_spelling', methods=['POST'])
@limiter.limit("20 per minute")  # Limit this endpoint to 20 requests per minute
def check_spelling():
    data = request.json
    text = data.get('text')

    if not text:
        return jsonify({"error": "No text provided"}), 400

    messages = [
        {"role": "system", "content": "You are a helpful assistant that corrects spelling and grammar errors in text."},
        {"role": "user", "content": f"Correct any spelling and grammar errors in the following text. If there are no errors, return the text as is.\n\nText: {text}"}
    ]

    max_retries = 3

    for attempt in range(max_retries):
        try:
            if openai_client is None:
                return jsonify({"result": text, "prompt": ""})
            response = openai_client.chat.completions.create(
                model=experiment_config.model,
                messages=messages,
                temperature=0.3
            )
            
            if response and response.choices:
                result = response.choices[0].message.content.strip()
                prompt = ""
                for dictionary in messages:
                    prompt += ', '.join(f"{key}: {value}" for key, value in dictionary.items()) + "\n"

                if "No spelling errors found" in result:
                    return jsonify({"result": text, "prompt": prompt})
                
                return jsonify({"result": result, "prompt": prompt})
                
        except Exception as e:
            print(f"Attempt {attempt + 1} failed with error: {e}")
            if attempt == max_retries - 1:
                return jsonify({"error": "Failed to check spelling after retries"}), 500

    return jsonify({"error": "Failed to check spelling after retries"}), 500


import praw

#@cross_origin(origins="*")
@app.route('/get_few_shot', methods=['POST'])
@limiter.limit("20 per minute")
def get_few_shot():
    print("Getting few shot comments")
    data = request.json
    print("LIMIT", data.get('limit'))
    limit = 0
    if data.get('limit'):
        if data.get('limit') == "Option 1":
            limit = 0
        elif data.get('limit') == "Option 2":
            limit = 5
        elif data.get('limit') == "Option 3":
            limit = 10
        else:
            limit = 0
        print("Limit: ", limit)
    username = data.get('username')
    print("Username: ", username)
    if not username:
        return jsonify({"error": "No username provided"}), 400
    comments = []
    try:
        reddit = praw.Reddit(
            client_id=os.getenv('REDDIT_CLIENT_ID'),
            client_secret=os.getenv('REDDIT_CLIENT_SECRET'),
            user_agent=username,
        )
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

    redditor = reddit.redditor(username)
    
    try:
        # Final version of few shot prompting
        for comment in redditor.comments.new(limit=limit):
            post_title = comment.submission.title + " " + comment.submission.selftext
            comments.append({
                "role": "user",
                "content": (
                    f"Analyze the following post and provide a unique, personality-driven response that reflects the user's typical style. "
                    f"Focus on their tone, humor, vocabulary, sentiment, common themes, and overall structure: {post_title}."
                ),
            })
            comments.append({
                "role": "assistant",
                "content": comment.body,
            })
        comments.append({
            "role": "system",
            "content": (
                "Use the above comments to understand and emulate the user's style in future interactions. Capture their preferred tone, humor, vocabulary, "
                "sentiment, recurring themes, response structure, and personality traits to generate responses that align with their unique voice."
            )
        })
        print("Few shot comments with comprehensive style analysis: ", comments)
        return jsonify({"comments": comments})
    except praw.exceptions.PRAWException as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500


#@cross_origin(origin='*', headers=['Content- Type'])  # Enable CORS for this route
@app.route('/get_comment', methods=['POST'])
@limiter.limit("20 per minute")  # Limits this endpoint to 20 requests per minute
def get_comment():
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    fewShot = data.get('fewShot', [])
    print("Few shot: ", fewShot)
    prompt = None
    treatment = data.get("treatment", "debug_t2")
    # treatment = "debug_t2"
    if treatment:
        prompt = experiment_config.get_prompt(treatment)

    messages, prompt_category = generate_prompts(data, fewShot, prompt)
    print("Messages: ", messages)
    suggest = data.get('suggest')
    writtenText = data.get('writtenText')
    text = data.get('text')

    max_retries = 3

    for attempt in range(max_retries):
        try:
            print(messages)
            response = experiment_config.get_completion(messages)
            if response is None:  # demonstration mode without an OpenAI key
                generated_text = " [placeholder suggestion: set OPENAI_API_KEY to generate real suggestions]"
            elif response.choices:
                generated_text = response.choices[0].message.content
            else:
                generated_text = None
            if generated_text:
                prompt = ""
                for dictionary in messages:
                    prompt += ', '.join(f"{key}: {value}" for key, value in dictionary.items()) + "\n"

                stripped_text = (writtenText or "").strip().lstrip('. ')
                generated_text = generated_text.strip().lstrip('. ')

                if generated_text.startswith(stripped_text):
                    generated_text = generated_text[len(stripped_text):]

                return jsonify({
                    "comment": generated_text,
                    "prompt": prompt,
                    "prompt_category": prompt_category,
                    "model": experiment_config.model
                })
        except Exception as e:
            print(f"Attempt {attempt + 1} failed with error: {e}")
            continue

    return jsonify({"error": "Failed to generate a comment after retries"}), 500

@app.route('/update_usernames', methods=['POST'])
def update_usernames():
    data = request.json
    uuid = str(data.get('UUID'))
    login_time = str(data.get('Login Time'))
    extension_install_time = str(data.get('Extension Install Time'))
    treatment_status = str(data.get('treatment_status'))

    # Create a dictionary to hold the new username data.
    new_usernames = {
        'Reddit': str(data.get('Reddit')),
        'Twitter': str(data.get('Twitter')),
    }
    print("New usernames to update:", new_usernames)

    new_entry = {
        'UUID': uuid,
        'Reddit': [],
        'Twitter': [],
        'Reddit Login Times': 'N/A',
        'Twitter Login Times': 'N/A',
        'Extension Install Time': extension_install_time,
        'treatment_status': treatment_status,
    }
    # Filter out any platforms not provided in the request.
    new_usernames = {k: v for k, v in new_usernames.items() if v not in ['N/A', None, '']}

    try:
        # Fetch the existing usernames for the user from the database.
        response = supabase.table('Usernames').select('*').eq('UUID', uuid).execute()
        existing_data = response.data[0] if response.data else None
        if existing_data:
            for platform in ["Reddit", "Twitter"]:
                new_username = new_usernames.get(platform)
                recorded_usernames = existing_data[platform] or []
                recorded_times = json.loads(existing_data[platform + ' Login Times'] or "[]") or []
                if new_username and new_username != 'N/A' and new_username not in recorded_usernames:
                    recorded_usernames.append(new_username)
                    recorded_times.append(f"({new_username}, {login_time})")
                new_entry[platform] = recorded_usernames
                new_entry[platform + ' Login Times'] = json.dumps(recorded_times)
        else:
            for platform in ["Reddit", "Twitter"]:
                new_username = new_usernames.get(platform)
                if new_username and new_username != 'N/A':
                    new_entry[platform] = [new_username]
                    new_entry[platform + ' Login Times'] = json.dumps([f"({new_username}, {login_time})"])

    except Exception as e:
        print(f"Error in Usernames: {e}")

    new_entry = {k: v for k, v in new_entry.items() if v != 'N/A'}
    try:
        response, count = supabase.table('Usernames').upsert(new_entry).execute()
        if count:
            return {"success": True, "message": "Usernames updated successfully."}, 200
        else:
            return {"success": False, "message": "No changes were made to the database."}, 200
    except Exception as e:
        return {"Error": str(e)}, 500

@app.route('/update_userActivity', methods=['POST'])
@cross_origin(origins="*")
def update_userActivity():
    data = request.json
    items = {
        'SessionID (UUIDxStartTime)': str(data.get('UUIDxStartTime')) or 'N/A',
        'Website/Platform': str(data.get('Platform')) or 'N/A',
        'UUID': str(data.get('UUID')) or 'N/A',
        'Session Start Timestamp': str(data.get('Session Start Timestamp')) or 'N/A',
        'Session end Timestamp': str(data.get('Session end Timestamp')) or 'N/A',
        'Total Session Time': str(data.get('Total Session Time')) or 'N/A',
        'Posts Opened': str(data.get('Posts Opened')) or 'N/A',
        'Total Clicks': str(data.get('Total Clicks')) or 'N/A',
        'Total Scrolls': str(data.get('Total Scrolls')) or 'N/A',
        'Total Key presses': str(data.get('Total Key presses')) or 'N/A',
        'Opened Posts Links': str(data.get('Opened Posts Links')) or 'N/A',
        'Ads Info': data.get('Ads Info', {}),
    }
    app.logger.info(f"Complete data: {data}")
    items_to_upsert = {k: v for k, v in items.items() if v != 'N/A'}
    try:
        print("Items to upsert:", items_to_upsert)
        response, count = supabase.table('UserActivity').upsert(items_to_upsert).execute()
        print("Upsert response:", response)
        return jsonify({"message": "Successfully put item", "response": str(response)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/update_combinedActivity', methods=['POST'])
def update_combinedActivity():
    data = request.json
    app.logger.info(f"Complete data: {data}")
    combined_acitivity = CombinedActivity(supabase, model=experiment_config.model)
    response = combined_acitivity.update(data)
    return response

@app.route('/update_userPreferences', methods=['POST'])
def update_userPreferences():
    data = request.json
    items = {
        'PreferenceID': str(data.get('PreferenceID')),
        'UUID': str(data.get('UUID')),
        'Time': str(data.get('Time')),
        'Tone': str(data.get('Tone')),
        'Humor': str(data.get('Humor')),
        'Length': str(data.get('Length')),
        'Additional Instructions': str(data.get('Additional Instructions')),
        'Sample Comments': str(data.get('Sample Comments')),
    }
    items_to_upsert = {k: v for k, v in items.items() if v != 'N/A'}
    try:

        response, count = supabase.table('User Preferences').upsert(items_to_upsert).execute()

        return jsonify({"message": "Successfully put item", "response": str(response)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

functionality = None

@app.route('/fetch_functionality', methods=['POST'])
def fetch_functionality():
    data = request.json
    user_id = data.get('UUID')

    print("fetching functionality for user_id:", user_id)

    # Fetch the existing treatment assignment for the user
    response = supabase.table('Usernames').select('treatment_status').eq('UUID', user_id).execute()
    if response.data and response.data[0]['treatment_status'] != DEFAULT_TREATMENT:
        # Return the existing treatment assignment
        treatment_assignment = response.data[0]['treatment_status']
    else:
        # Assign a new treatment if not already assigned
        treatment_assignment = experiment_config.sample_treatment()
        # Store the new assignment in the database
        supabase.table('Usernames').upsert({'UUID': user_id, 'treatment_status': treatment_assignment}).execute()

    treatment_settings = experiment_config.get_treatment_settings(treatment_assignment)
    return treatment_settings

@app.route('/get_surveys_config', methods=['GET'])
def get_surveys_config():
    return jsonify(surveys_config)

# Regex to match twitter.com/<username>/status/<id> with any trailing segments
STATUS_RE = re.compile(
    r"^https?://(?:www\.)?(?:twitter\.com|x\.com)"
    r"/([^/]+)/status/(\d+)(?:/.*)?$",
    re.IGNORECASE
)

@app.route("/extract_status_id", methods=["GET"])
@cross_origin(origins=["https://x.com", "https://twitter.com"], methods=['GET', 'OPTIONS'], allow_headers=['Content-Type'])
@limiter.limit("30 per minute")
def extract_status_id():
    url = request.args.get("url", type=str)
    if not url:
        return jsonify({"error": "Missing 'url' parameter"}), 400

    max_hops = 10
    current = url.strip()

    try:
        # First, attempt to follow redirects via HEAD
        for _ in range(max_hops):
            m = STATUS_RE.match(current)
            if m:
                username, tweet_id = m.group(1), m.group(2)
                return jsonify({"username": username, "id": tweet_id})

            resp = requests.head(current, allow_redirects=False, timeout=5)
            if 300 <= resp.status_code < 400 and "Location" in resp.headers:
                current = urljoin(current, resp.headers["Location"])
                continue
            break

    except requests.RequestException as e:
        return jsonify({"error": "Upstream request failed", "details": str(e)}), 502

    # Fallback: do a GET to follow any remaining redirects
    try:
        resp = requests.get(current, allow_redirects=True, timeout=5)
        final_url = resp.url
        m = STATUS_RE.match(final_url)
        if m:
            username, tweet_id = m.group(1), m.group(2)
            return jsonify({"username": username, "id": tweet_id})
    except requests.RequestException:
        pass

    return jsonify({
        "error": "Could not locate a valid URL after following redirects"
    }), 400


if __name__ == '__main__':
    app.run(debug=not DEMO_MODE)
