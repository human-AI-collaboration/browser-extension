# Words which may be enclosed in curly braces in experiment_config.json and will
# be replaced with the corresponding value from data. The value in this dictionary
# is the default value if the key is not found in data.

def replace_keywords(prompt, data):
    """
    Takes a prompt and replaces all REPLACEABLE_KEYWORDS with the corresponding
    value from data
    """
    prompt = prompt.format(
        length=data.get("length", "Medium"),
        title=data.get("title", None),
        text=data.get("text", None),
        writtenText=data.get("writtenText", None),
        combined_prompts=data.get("combined_prompts", None)
    )
    return prompt

def generate_prompts(data, fewShot, prompt_dict):
    messages = [] # this variable stores the return value, a list of messages for ChatGPT

    messages.extend([
        {"role": "system", "content": replace_keywords(prompt_dict["system"], data)},
        {"role": "user", "content": replace_keywords(prompt_dict["user_prompt"], data)},
    ])

    if data.get("imageSource", "N/A").startswith("https://"):
        messages.append({
            "role": "user",
            "content": [{
                "type": "image_url",
                "image_url": {
                    "url": data.get("imageSource")
                }
            }]
        })

    return messages, prompt_dict["prompt_category"]
