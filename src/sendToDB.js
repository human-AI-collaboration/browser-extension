
import config from './config';
const SERVER_ENDPOINT = config.SERVER_ENDPOINT;
export const sendToDB = async ({
    UUID = 'N/A',
    RedditPostUrl = 'N/A',
    table = 'N/A',
    Redditusername = 'N/A',
    Twitterusername = 'N/A', 
    UUIDxStart = 'N/A',
    sessionStart = 'N/A',
    sessionEnd = 'N/A',
    sessionTotalTime = 'N/A',
    Platform = 'N/A',
    postsOpened = 'N/A',
    clicks = 'N/A',
    scrolls = 'N/A',
    keypresses = 'N/A',
    adsInfo = 'N/A',
    Time = 'N/A',
    Tone = 'N/A',
    Humor = 'N/A',
    Length = 'N/A',
    AdditionalInstructions = 'N/A',
    SampleComments = 'N/A',
    PreferenceID = 'N/A',
    LoginTime = 'N/A',
    ExtensionInstallTime = 'N/A',
    treatment_status = 'N/A',
  } = {}) => {
    let data = {};
    let tableEndpoint = '';

    if (table === 'Usernames') {
        data = {
            'UUID': UUID,
            'Twitter': Twitterusername,
            'Reddit': Redditusername,
            'Login Time': LoginTime,
            'Extension Install Time': ExtensionInstallTime,
            'treatment_status': treatment_status
        };
        tableEndpoint = `${SERVER_ENDPOINT}/update_usernames`;
    } else  if (table === 'UserActivity') {
        data = {
            'UUIDxStartTime': UUIDxStart,
            'Platform': Platform,
            'UUID': UUID,
            'Session Start Timestamp': sessionStart,
            'Session end Timestamp': sessionEnd,
            'Total Session Time': sessionTotalTime,
            'Posts Opened': postsOpened,
            'Total Clicks': clicks,
            'Total Scrolls': scrolls,
            'Total Key presses': keypresses,
            'RedditPostUrl': RedditPostUrl,
            'Test': "Test",
            'Ads Info': adsInfo
        };
        tableEndpoint = `${SERVER_ENDPOINT}/update_userActivity`;
    }
    else if (table == 'User Preferences') {
        console.log('User Preferences Table');
        data = {
            'PreferenceID': PreferenceID,
            'UUID': UUID,
            'Time': Time,
            'Tone': Tone,
            'Humor': Humor,
            'Length': Length,
            'Additional Instructions': AdditionalInstructions,
            'Sample Comments': SampleComments
        };
        tableEndpoint = `${SERVER_ENDPOINT}/update_userPreferences`;
    }

    try {
        console.debug("sendToDB() sending...", { data, tableEndpoint });
        const response = await fetch(tableEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const responseData = await response.json();
        console.debug("sendToDB(): responseData", responseData);
    } catch (error) {
        console.error('Error sending data to DB:', error);
    }
};

const endpointCombinedActivity = `${SERVER_ENDPOINT}/update_combinedActivity`;

async function processPotentialPromise(value, debug_name="parentPostID") {
    const isPromise = Boolean(value && typeof value.then === 'function' && typeof value.catch === 'function');
    if (isPromise) {
        try {
            const resolvedValue = await value;
            return resolvedValue;
        } catch (error) {
            console.error(`Error processing potential ${debug_name}: ${error}`);
            return null;
        }
    } else {
        return value;
    }
}

export const sendPageView = async ({ platform, UUID, startTime, postStartTime, url, adsInfo, postInformation, parentPostID }) => {
    parentPostID = await processPotentialPromise(parentPostID);
    postInformation = await processPotentialPromise(postInformation);
    if (!parentPostID || postInformation === null) {
        return;
    }

    const data = { platform, UUID, startTime, postStartTime, url, adsInfo, postInformation, parentPostID };

    try {
        console.debug("sendPageView() sending...", data);
        const response = await fetch(endpointCombinedActivity, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...data, eventType: 'pageView' })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const responseData = await response.json();
        console.debug("sendPageView(): responseData", responseData);
    } catch (error) {
        console.error('Error in sendPageView():', error);
    }
};

export const sendPublishedComment = async ({ platform, UUID, startTime, postStartTime, url, replyID, publishedComment, parentPostID, publishedCommentID }) => {
    parentPostID = await processPotentialPromise(parentPostID);
    if (!parentPostID) {
        return;
    }

    const data = { platform, UUID, startTime, postStartTime, url, replyID, publishedComment, parentPostID, publishedCommentID };
 
    try {
        console.debug("sendPublishedComment() sending...", data);
        const response = await fetch(endpointCombinedActivity, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...data, eventType: 'publishedComment' })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const responseData = await response.json();
        console.debug("sendPublishedComment(): responseData", responseData);
    } catch (error) {
        console.error('Error in sendPublishedComment():', error);
    }
};

export const sendAcceptedAutoComplete = async ({ platform, UUID, startTime, postStartTime, url, replyID, acceptedSuggestion, parentPostID }) => {
    parentPostID = await processPotentialPromise(parentPostID);
    if (!parentPostID) {
        return;
    }

    const data = { platform, UUID, startTime, postStartTime, url, replyID, acceptedSuggestion, parentPostID };
    try {
        console.debug("sendAcceptedAutoComplete() sending...", data);
        const response = await fetch(endpointCombinedActivity, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...data, eventType: 'acceptedAutoComplete' })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const responseData = await response.json();
        console.debug("sendAcceptedAutoComplete(): responseData", responseData);
    } catch (error) {
        console.error('Error in sendAcceptedAutoComplete():', error);
    }
};

export const sendGotCompletion = async ({ platform, UUID, startTime, postStartTime, url, suggestion, userTyped, parentText, prompt, promptCategory, completionType, replyID, parentPostID }) => {
    parentPostID = await processPotentialPromise(parentPostID);
    if (!parentPostID) {
        return;
    }

    const data = { platform, UUID, startTime, postStartTime, url, suggestion, userTyped, parentText, prompt, promptCategory, completionType, replyID, parentPostID };
    try {
        console.debug("sendGotCompletion() sending...", data);
        const response = await fetch(endpointCombinedActivity, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...data, eventType: 'gotCompletion' })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const responseData = await response.json();
        console.debug("sendGotCompletion(): responseData", responseData);
    } catch (error) {
        console.error('Error in sendGotCompletion():', error);
    }
};

export const sendTextBoxEntry = async ({ platform, UUID, startTime, postStartTime, url, textBoxEntry, replyID, parentPostID }) => {
    parentPostID = await processPotentialPromise(parentPostID);
    if (!parentPostID) {
        return;
    }

    const data = { platform, UUID, startTime, postStartTime, url, textBoxEntry, replyID, parentPostID };
    try {
        console.debug("sendTextBoxEntry() sending...", data);
        const response = await fetch(endpointCombinedActivity, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...data, eventType: 'textBoxEntry' })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const responseData = await response.json();
        console.debug("sendTextBoxEntry(): responseData", responseData);
    } catch (error) {
        console.error('Error in sendTextBoxEntry():', error);
    }
};
