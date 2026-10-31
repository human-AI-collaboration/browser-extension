from prompt_v2 import generate_prompts as generate_prompts_v2

# The parameter "prompt" is the same shape as each of the elements under "prompts"
# in experiment_config.json
def generate_prompts(data, fewShot, prompt_dict=None):
    if prompt_dict is not None:
        return generate_prompts_v2(data, fewShot, prompt_dict)

    title = data.get('title')
    text = data.get('text')
    writtenText = data.get('writtenText')
    context = data.get('context')
    tone = data.get('tone')
    humor = data.get('humor')
    length = data.get('length', 'Medium')
    instructions = data.get('instructions')
    sampleComments = data.get('sampleComments')
    imageSource = data.get('imageSource')
    twitter = True if data.get('twitter') == 'true' else False
    reply = data.get('reply')
    replyComment = data.get('replyComment')
    auto_complete = data.get('suggest')
    prompt_category = "informative"
    messages = fewShot if fewShot else []
    tone_prompt = {
        'Balanced': 'Write in a balanced way. Try not to take any particular side clearly',
        'Opinionated': 'Write in an opinionated manner, clearly taking a side.'
    }.get(tone, '')

    humor_prompt = {
        'Funny': 'Write in a humorous manner, using information from the post to make the comment funny.',
        'Serious': 'Write in a normal conversational manner, do not make the comment too sarcastic or very serious.'
    }.get(humor, '')

    def get_word_count(length_setting):
        length_ranges = {
            'Short': '1 to 2 sentences',
            'Medium': '3 to 5 sentences',
            'Long': '1 to 2 paragraphs'
        }
        return length_ranges.get(length_setting, '3 to 5 sentences')

    length_prompt = f'The length of the comment should be approximately {get_word_count(length)}. Try to adhere to it as much as you can.'

    sample_comments_prompt = f'Use the following sample comments to understand the user style, try to write in a style that matches the user\'s comment style: {sampleComments}' if sampleComments else ''
    # Q: are few shots being passed in as sample_comments_prompt?

    additional_instructions_prompt = f'Make sure to follow these additional instructions provided by the user: {instructions}' if instructions else ''

    respect_prompt = 'You must remain respectful and open-minded to the person you are responding to.'

    non_repeat_prompt = 'Do not try to repeat the information given to you and do not be repetitive.'

    combined_prompts = ' '.join(filter(None, [tone_prompt, humor_prompt, length_prompt, sample_comments_prompt, additional_instructions_prompt, respect_prompt, non_repeat_prompt]))

    if auto_complete:
        prompt = f"""Autocomplete the following comment that I am typing by adding new information while making sure to match the tone and style of my comment: {writtenText}. 
                   In my comment, I am replying to the post with the following title: {title}
                   and following text: {text}. 
                   Please make sure that you do not repeat any thoughts, ideas or information that has already been provided in my comment."""
        # After text, say. This post has the following image.
        messages.extend([
            {"role": "system", "content": f"""You are an AI assistant helping to autocomplete a user's comment on a social media post. 
             Your task is to suggest a continuation of the user's input that is coherent, relevant, and aligns with the post's context. 
             The suggestion should be as informative as possible, adding new knowledge and ideas to the user's comment to make the comment better and high quality.
             The suggestion should match the user's writing style e.g, if the user is sarcastic, your suggestion should also be sarcastic; 
             if it is serious, your suggestion should also be serious. 
             Do not reply to the user, but to the post/comment user is replying to.
             Make your auto-completed comment as informative as possible, adding new information that has not been provided yet. 
             Follow these specific instructions, especially the instructions about length, tone, humor, and instructions: {combined_prompts}. 
             Remember the length of the auto-completed comment should be strictly {length}"""},
            {"role": "user", "content": f"{prompt}"}
        ])
        if imageSource != 'N/A':
            imageSource_object = [
                {"type": "text", "text": "The post that I am replying to has the following image"},
                {
                    "type": "image_url",
                    "image_url": {
                    "url": imageSource,
                    },
                },
            ]
            messages.append({"role": "user", "content": imageSource_object})
        return messages, prompt_category


    if imageSource == 'N/A':
        system_content = f"""
        INSTRUCTION: You are an AI assistant helping to write comments on a social media post. Your goal is to assist the human using the AI tool write better comments. Write a reply in response to the given post. Please make your reply as informative as possible, adding new information that has not been provided yet. Do  not reply to the user, but to the post/comment user is replying to.
        {combined_prompts}
        """
    else:
        system_content = f"""
        INSTRUCTION: You are an AI assistant helping to write comments on a social media post. Your goal is to assist the human using the AI tool write better commentsWrite a reply in response to the given post. Please make your reply as informative as possible, adding new information that has not been provided yet. Do  not reply to the user, but to the post/comment user is replying to.
        You are supposed to generate a reply for the passed in image
        {combined_prompts}
        """

    if context:
        if twitter:
            messages.extend([
                {"role": "system", "content": system_content},
                {"role": "user", "content": f"""Write a response to the twitter post with this text: {text}. The user has provided this initial comment: \"{writtenText}\". Help the user in responding to the given social media post by taking the user's initial comment and adding new information to it to make the user's response as informative as possible. Do not remove the user's initial response; instead, elaborate and add new information to it without responding to the user's initial response. Do not respond to the user, but to the social media post given. 
                 Your job is to help the user craft the most informative response possible to the given social media post. The suggestion should match the user's writing style e.g, if the user is sarcastic, your suggestion should also be sarcastic, if it is serious, your suggestion should also be serious."""}
            ])
        else:
            messages.extend([
                {"role": "system", "content": system_content},
                {"role": "user", "content": f"The user has provided this initial comment: \"{writtenText}\" in response to the social media post with this title {title} and this text: {text}. Pretend you are this user. Take the user's initial comment and adding new information to it to make the user's response as informative as possible. Do not remove the user's initial response; instead add new information to it to craft the most informative response possible. The suggestion should match the user's writing style e.g, if the user is sarcastic, your suggestion should also be sarcastic, if it is serious, your suggestion should also be serious."}
            ])
    else:
        if twitter:
            messages.extend([
                {"role": "system", "content": system_content},
                {"role": "user", "content": f"Write a response to the twitter post with this text: {text}."}
            ])
        else:
            messages.extend([
                {"role": "system", "content": system_content},
                {"role": "user", "content": f"Write a response to the social media post with this title {title} and this text: {text}."}
            ])

    if imageSource != 'N/A':
        imageSource_object = {"type": "image_url", "image_url": {"url": f"{imageSource}"}}
        messages.append({"role": "user", "content": [imageSource_object]})

    # Need to handle replies for autocomplete
    if reply:
        messages.append({"role": "user", "content": f"The user is replying to this earlier comment {replyComment}. Help the user draft a reply by pretending to be the user and responding to the earlier comment. Keep in mind the context of the post through its title and text."})
    
    return messages, prompt_category
