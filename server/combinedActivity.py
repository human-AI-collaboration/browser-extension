from datetime import datetime, timezone
from flask import jsonify

TABLE_NAME = "CombinedActivity"

def iso_format_utc(num):
    """Convert a JS Date.now() integer timestamp to ISO format in UTC timezone."""
    return datetime.fromtimestamp(num / 1000, tz=timezone.utc).isoformat()

def now_iso_utc():
    """Get the current time in ISO format in UTC timezone."""
    return datetime.now(timezone.utc).isoformat()

class CombinedActivity:
    def __init__(self, supabase_client, model=None):
        self.supabase = supabase_client
        self.model = model  # language model in the server configuration
        self.table = self.supabase.table(TABLE_NAME)

    def get_existing_entry(self, data):
        post_id, session_id = self.compute_ids(data)
        uuid = data.get('UUID')
        try:
            response = (self.table.select('*')
                        .eq('PostID', post_id)
                        .eq('SessionID', session_id)
                        .eq('UUID', uuid)
                        .execute())

            entry = self.get_latest_valid_entry(response)

            print('CombinedActivity.get_existing_entry. entry:', entry)

            return entry
        except Exception as e:
            print(f"Error in CombinedActivity.get_existing_entry: {e}")
            return None

    def create_new_entry(self, data):
        post_id, session_id = self.compute_ids(data)
        return {
            "PostID": post_id,
            "SessionID": session_id,
            "UUID": data.get('UUID'),
            "Platform": data.get('platform'),
            "URL": data.get('url'),
            "Parent Post ID": data.get('parentPostID'),
            "Webpage Open Time": iso_format_utc(data.get('postStartTime')),
            "Activity Object": {
                "Text Box Entries": [],
                "Auto Completions": [],
                "Suggestions": [],
            },
            "Post Information": {},
            "Ads Info": {}
        }

    # This function updates values which can always be sent and changed.
    # These are: url, parentPostID
    def update_global_values(self, entry, data):
        if data.get('replyID', "N/A") != "N/A":
            entry["Reply ID"] = data.get('replyID')

        if data.get('parentPostID', "N/A") != "N/A":
            entry["Parent Post ID"] = data.get('parentPostID')

        if data.get('parentText', "N/A") != "N/A":
            entry["Parent Text"] = data.get('parentText')

        return entry
    
    def get_latest_valid_entry(self, existing_data):
        try:
            if len(existing_data.data) == 0:
                print("CombinedActivity.get_latest_valid_entry: got empty data from supabase")
                return None
            latest_entry = max(existing_data.data, key=lambda x: x['Entry Timestamp'])
            return latest_entry
        except Exception as e:
            print(f"Error in CombinedActivity.get_latest_valid_entry: {e}")
            return None

    def compute_ids(self, data):
        # Compute PostID and SessionID
        postStartTime = data.get('postStartTime')
        startTime = data.get('startTime')
        UUID = data.get('UUID')
        postId = str(UUID) + "-" + str(postStartTime)
        sessionId = str(UUID) + "-" + str(startTime)
        return postId, sessionId

    def upsert_entry(self, entry):
        try:
            entry = {k: v for k, v in entry.items() if v != "N/A"}
            print("CombinedActivity.upsert_entry. entry:", entry)
            response, _ = self.supabase.table(TABLE_NAME).upsert(entry).execute()
            print("CombinedActivity.upsert_entry. response:", response)
            return jsonify({"message": "Successfully put item", "response": str(response)})
        except Exception as e:
            print(f"Error in CombinedActivity.update: {e}")
            return jsonify({"error": str(e)}), 500

    def get_or_create_entry(self, data):
        entry = self.get_existing_entry(data)
        if entry:
            print("CombinedActivity.get_or_create_entry. entry:", entry)
            return entry, True
        else:
            print("CombinedActivity.get_or_create_entry: creating new entry")
            entry = self.create_new_entry(data)
            return entry, False

    def sort_activity_object(self, entry):
        entry["Activity Object"]["Auto Completions"].sort(key=lambda x: x["timestamp"])
        entry["Activity Object"]["Suggestions"].sort(key=lambda x: x["timestamp"])
        entry["Activity Object"]["Text Box Entries"].sort(key=lambda x: x["timestamp"])
        return entry

    def handle_page_view(self, data):
        entry, _ = self.get_or_create_entry(data)

        adsInfo = data.get('adsInfo')
        postInformation = data.get('postInformation')

        if adsInfo:
            entry['Ads Info'] = adsInfo

        if postInformation:
            entry['Post Information'] = postInformation

        self.sort_activity_object(entry)
        self.update_global_values(entry, data)

        return self.upsert_entry(entry)

    def handle_text_box_entry(self, data):
        entry, _ = self.get_or_create_entry(data)
        textBoxEntry = data.get('textBoxEntry')
        entry_obj = {
            "text": textBoxEntry,
            "timestamp": now_iso_utc(),
        }
        entry['Activity Object']['Text Box Entries'].append(entry_obj)

        entry = self.sort_activity_object(entry)

        entry = self.update_global_values(entry, data)

        return self.upsert_entry(entry)

    def handle_got_completion(self, data):
        entry, _ = self.get_or_create_entry(data)
        completion_entry_obj = {
            "suggestion": data.get('suggestion'),
            "userTyped": data.get('userTyped'),
            "prompt": data.get('prompt'),
            "promptCategory": data.get('promptCategory'),
            "model": self.model,
            "timestamp": now_iso_utc(),
        }

        completion_type = data.get('completionType')
        if completion_type == "suggest":
            entry["Activity Object"]["Suggestions"].append(completion_entry_obj)
        elif completion_type == "autocomplete":
            completion_entry_obj["accepted"] = False
            completion_entry_obj["acceptedTimestamp"] = None
            entry["Activity Object"]["Auto Completions"].append(completion_entry_obj)
        else:
            print("CombinedActivity.handle_got_completion: invalid completionType", completion_type)
            return jsonify({"message": "invalid completionType"}), 400

        entry = self.sort_activity_object(entry)

        entry = self.update_global_values(entry, data)

        return self.upsert_entry(entry)

    def handle_accepted_auto_complete(self, data):
        entry, _ = self.get_or_create_entry(data)

        entry = self.sort_activity_object(entry)
        found = False
        for i in range(len(entry["Activity Object"]["Auto Completions"]) - 1, -1, -1):
            if entry["Activity Object"]["Auto Completions"][i]["suggestion"] == data.get("acceptedSuggestion"):
                entry["Activity Object"]["Auto Completions"][i]["accepted"] = True
                entry["Activity Object"]["Auto Completions"][i]["acceptedTimestamp"] = now_iso_utc()
                found = True
                break

        if not found:
            print("CombinedActivity.handle_accepted_auto_complete: accepted suggestion not found")
            return jsonify({"message": "accepted suggestion not found"}), 400

        entry = self.sort_activity_object(entry)
        entry = self.update_global_values(entry, data)

        return self.upsert_entry(entry)

    def handle_published_comment(self, data):
        entry, _ = self.get_or_create_entry(data)
        entry["Published Comment"] = data.get('publishedComment')
        entry["Published Comment Time"] = now_iso_utc()
        entry["Published Comment ID"] = data.get("publishedCommentID");

        self.update_global_values(entry, data)

        return self.upsert_entry(entry)

    def update(self, data):
        eventType = data.get('eventType')
        if eventType == 'pageView':
            return self.handle_page_view(data)
        elif eventType == 'textBoxEntry':
            return self.handle_text_box_entry(data)
        elif eventType == "gotCompletion":
            return self.handle_got_completion(data)
        elif eventType == "acceptedAutoComplete":
            return self.handle_accepted_auto_complete(data)
        elif eventType == "publishedComment":
            return self.handle_published_comment(data)
        else:
            print("CombinedActivity.update: invalid eventType")
            return jsonify({"message": "invalid eventType"}), 400
        
