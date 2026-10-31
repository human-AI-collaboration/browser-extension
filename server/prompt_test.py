import yaml
from prompt_v2 import replace_keywords

# Load the experiment config
with open('experiment_config.yaml', 'r') as f:
    config = yaml.safe_load(f)

# Sample data that would be passed to replace_keywords
sample_data = {
    "length": "Medium",
    "title": "Someone tell me why this was rejected? lol",
    "text": "So this upset me the other day. Literally accepted...",
    "writtenText": "I think I see the problem here - it's not just a case of human error",
    "combined_prompts": "Be concise and clear"
}

# Get the informative prompt template
prompt_template = config['prompts']['informative']['system']

# Replace the keywords in the prompt
replaced_prompt = replace_keywords(prompt_template, sample_data)

# New method using string interpolation with the config
new_replaced_prompt = config['prompts']['informative']['system'].format(
    length=sample_data['length'],
    title=sample_data['title'],
    text=sample_data['text'],
    writtenText=sample_data['writtenText'],
    combined_prompts=sample_data['combined_prompts']
)
print("Original prompt template:")
print(prompt_template)
print("\nReplaced prompt:")
print(replaced_prompt)
print("--------------------------------")
print("New method:")
print(new_replaced_prompt)