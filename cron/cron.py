import requests
from supabase import create_client, Client
from dotenv import load_dotenv
import os
import requests
import praw

# TODO: Would be nice to process the users in a random order each time
# in case there are errors after n runs, they are evenly distributed.
# TODO: Would be nice to cache the results of API calls in case there
# are repeated usernames.

load_dotenv()

TWITTER_RAPIDAPI_KEY = os.getenv('TWITTER_RAPIDAPI_KEY')
REDDIT_CLIENT_ID = os.getenv('REDDIT_CLIENT_ID')
REDDIT_CLIENT_SECRET = os.getenv('REDDIT_CLIENT_SECRET')

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
assert url and key, "Missing Supabase URL or Key"
supabase: Client = create_client(url, key)

def fetch_all_users(limit = 1000):
    offset = 0
    data = []
    while True:
        print(f"Fetching Usernames chunk from offset:", offset)
        chunk = (supabase.table("Usernames").select("UUID, Reddit, Twitter")
                 .order("UUID") .range(offset, offset + limit - 0).execute())

        if not chunk.data:
            # If there are no more rows to fetch, break the loop
            print("No rows returned, breaking the loop.")
            break

            # Append the chunk to the DataFrame
        data.extend(chunk.data)

        if len(chunk.data) < limit:
            # If the number of rows returned is less than the limit, we have
            # reached the end of the table
            print("Less than limit rows returned, breaking the loop.")
            break

        offset += limit

    return data


def fetch_reddit_user_history(username):
    reddit = praw.Reddit(
        client_id=os.getenv('REDDIT_CLIENT_ID'),
        client_secret=os.getenv('REDDIT_CLIENT_SECRET'),
        user_agent=username,
        ratelimit_seconds=600, # max
    )
    print(f"[DEBUG] Starting fetch_user_history for username: {username}")
    redditor = reddit.redditor(username)

    # Initialize data structures
    submissions = []
    comments = []
    submission_info = {}
    comment_info = {}

    print("[DEBUG] Starting submission fetch")
    for submission in redditor.submissions.new(limit=40):
        submissions.append(submission.id)
        submission_info[submission.id] = {
            'body': submission.selftext,
            'score': submission.score,
            'created_utc': submission.created_utc,
            'title': submission.title,
            'subreddit': submission.subreddit.display_name,
            'url': submission.url
        }

    print(f"[DEBUG] Found {len(submissions)} submissions")

    print("[DEBUG] Starting comment fetch")
    for comment in redditor.comments.new(limit=40):
        comments.append(comment.id)
        comment_info[comment.id] = {
            'body': comment.body,
            'score': comment.score,
            'created_utc': comment.created_utc,
            'subreddit': comment.subreddit.display_name,
            'parent_id': comment.parent_id
        }
    print(f"[DEBUG] Found {len(comments)} comments")

    return submission_info, comment_info

def reddit_process_user(username, uuid):
    try:
        print(f"[DEBUG] Processing Reddit user: {username} with UUID: {uuid}")
        submission_info, comment_info = fetch_reddit_user_history(username)
        if submission_info or comment_info:
            data = {
                'UUID': uuid,
                'Username': username,
                'submissions': submission_info,
                'comments': comment_info,
            }
            print(f"[DEBUG] Upserting Reddit data:", data)
            supabase.table('RedditHistory').upsert(data).execute()
        else:
            print(f"[WARN] No Reddit data found for {username}")
    except Exception as e:
        print(f"[ERROR] Error processing Reddit user {username}: {str(e)}")

def fetch_twitter_timeline(username):
    try:
        url = "https://twitter-api45.p.rapidapi.com/timeline.php"

        querystring = {"screenname":username}

        headers = {
            "x-rapidapi-key": TWITTER_RAPIDAPI_KEY,
            "x-rapidapi-host": "twitter-api45.p.rapidapi.com"
        }

        response = requests.get(url, headers=headers, params=querystring, timeout=30)

        result = response.json()

        timeline = result.get("timeline")
        pinned = result.get("pinned")
        user = result.get("user")
        
        return timeline, pinned, user
    except Exception as e:
        print(f"Error fetching Twitter timeline for {username}: {str(e)}")
        return None, None, None
 
def fetch_twitter_replies(username):
    try:
        url = "https://twitter-api45.p.rapidapi.com/replies.php"

        querystring = {"screenname":username}

        headers = {
            "x-rapidapi-key": TWITTER_RAPIDAPI_KEY,
            "x-rapidapi-host": "twitter-api45.p.rapidapi.com"
        }

        response = requests.get(url, headers=headers, params=querystring, timeout=30)

        result = response.json()
        replies = result.get("timeline")
        
        return replies
    except Exception as e:
        print(f"Error fetching Twitter replies for {username}: {str(e)}")
        return None

def twitter_process_user(username, uuid):
    try:
        print(f"[DEBUG] Processing Twitter user: {username} with UUID: {uuid}")
        timeline, pinned, user = fetch_twitter_timeline(username)
        replies = fetch_twitter_replies(username)
        if timeline or pinned or user or replies:
            data = {
                'UUID': uuid,
                'Username': username,
                'timeline': timeline,
                'pinned': pinned,
                'user': user,
                'replies': replies
            }
            print(f"[DEBUG] Upserting Twitter data:", data)
            supabase.table('TwitterHistory').upsert(data).execute()
        else:
            print(f"[WARN] No Twitter data found for {username}")
    except Exception as e:
        print(f"[ERROR] Error processing Twitter user {username}: {str(e)}")

def run_cron_job():
    data = fetch_all_users()
    print("Fetched all users:", data)

    for user in data:
        try:
            reddit_usernames = user["Reddit"]
            twitter_usernames = user["Twitter"]
            uuid = user["UUID"]
            for reddit_username in reddit_usernames:
                reddit_process_user(reddit_username, uuid)
            for twitter_username in twitter_usernames:
                twitter_process_user(twitter_username, uuid)
        except Exception as e:
            print("[ERROR] Error processing user:", user, "Error:", str(e))


if __name__ == '__main__':
    run_cron_job()
