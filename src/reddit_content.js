import { getAutoCompleteData, getAutoCompleteSuggestion, getCaretCoordinates, removeAutoCompleteSuggestion, showAutoCompleteSuggestion, suggestAutoComplete } from "./autosuggest";
import config, { GLOBAL_DEFAULT_OPTIONS } from './config';
import { collectAndSendData, initialCollectAndSendData, resetPostAdData } from './adCollector';
import { sendAcceptedAutoComplete, sendGotCompletion, sendPageView, sendPublishedComment, sendTextBoxEntry, sendToDB } from "./sendToDB";
if (!window.loadedstanfordextension) { // prevent double loading
window.loadedstanfordextension = true;
console.log('Reddit Content Script Loaded');


const SERVER_ENDPOINT = config.SERVER_ENDPOINT;
let postsOpened = 0;
let startTime = Date.now();
let visibilityStartTime = startTime;
let postStartTime = null;
let extensionSetupTime = null;
let tempAutoCompleteDisabled = false;

let suggestedCommentTime;
let suggestedComment;
let webpageOpenTime;
let populate = false; //boolean that determines whether text box should be populated or not
let userTypedComment;
let buttonElement;
let SpanOldView;   
let clickCounter = 0;
let scrollCounter = 0;
let keypressCounter = 0;

let activeAutoCompleteController = null;

let globalOptions = GLOBAL_DEFAULT_OPTIONS;

function getParentPostID() {
    const url = window.location.href;
    const match = url.match(/reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]{6,8})\b/i);
    if (match) {
        return match[1];
    } else {
        return null;
    }
}

// Helper function for chrome.storage.sync operations
function safeStorageOperation(operation, data, callback) {
    if (!chrome?.storage?.sync) {
        console.warn('Chrome storage sync not available');
        return;
    }

    try {
        if (operation === 'get') {
            chrome.storage.sync.get(data, (result) => {
                if (chrome.runtime.lastError) {
                    console.error('Storage operation failed:', chrome.runtime.lastError);
                    callback?.(null);
                    return;
                }
                callback?.(result);
            });
        } else if (operation === 'set') {
            chrome.storage.sync.set(data, () => {
                if (chrome.runtime.lastError) {
                    console.error('Storage operation failed:', chrome.runtime.lastError);
                    callback?.(false);
                    return;
                }
                callback?.(true);
            });
        }
    } catch (error) {
        console.error('Storage operation error:', error);
        callback?.(null);
    }
}

function initializeSettings() {
    safeStorageOperation('get', ["autocomplete", "suggest", "treatment", "functionality"], function(result) {
        if (result) {
            // This operation uses the values from result first, and falls back to
            // the default values in GLOBAL_DEFAULT_OPTIONS if they are not set
            globalOptions = {
                ...globalOptions,
                ...result,
            };
            console.log("Global options set to:", globalOptions);
        }
    });
}

// Call this after the script loads
document.addEventListener('DOMContentLoaded', () => {
    initializeSettings();
});



// Note from Ryan: Textbox hashset
const initializedTextboxes = new WeakSet();

function logEvent(eventType) {
    switch(eventType) {
        case 'click': clickCounter++; break;
        case 'scroll': scrollCounter++; break;
        case 'keypress': keypressCounter++; break;
    }
}

async function calculateTime() {
    console.log('calculateTime called');
    const endTime = Date.now();
    try {
        const adsInfo = collectAndSendData();
        console.log('adData:', adsInfo);

        safeStorageOperation('get', ["userId"], async function(result) {
            if (result) {
                const UUID = result.userId;
                const data = {
                    'UUIDxStart': UUID + '-' + visibilityStartTime, 
                    'UUID': UUID, 
                    'Platform': 'Reddit', 
                    'sessionStart': getFormattedDateTime(visibilityStartTime), 
                    'sessionEnd': getFormattedDateTime(endTime), 
                    'sessionTotalTime': formatTimeInterval(endTime - visibilityStartTime), 
                    'postsOpened': postsOpened, 
                    'clicks': clickCounter, 
                    'scrolls': scrollCounter, 
                    'keypresses': keypressCounter,
                    'table': 'UserActivity'
                };

                if (adsInfo && typeof adsInfo === 'object') {
                    data["adsInfo"] = adsInfo;
                }

                console.log('Sending data:', data);
                await chrome.runtime.sendMessage({action: "tab-close-analytics", data: data});
                console.log('sent tab-close-analytics');
            }
        });
    } catch (error) {
        console.error('Error in calculateTime:', error);
    }
}

function addEventListeners() {
    document.addEventListener('click', () => logEvent('click'));
    window.addEventListener('scroll', () => logEvent('scroll'));
    document.addEventListener('keypress', () => logEvent('keypress'));
    
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'hidden') {
            console.log('Page hidden - calculating time');
            await calculateTime();
            removeAutoCompleteSuggestion();
        } else {
            visibilityStartTime = Date.now();
        }
    });

    window.addEventListener('beforeunload', async (event) => {
        console.log('Page unloading - calculating time');
        await calculateTime();
    });
}

const usernameStatusObj = { // use an object to avoid it being put in a closure
    fetching: false,
    latestUsername: null,
};


function getUsernameHelper() {
    
    function extractUsernameFromPath(path) {
        // find /user/ or /u/ followed by a username
        const match = path.match(/\/(?:user|u)\/([\w-]+)/);
        return match ? match[1] : null;
    }

    function attemptFindUsername() {
        const usernameSelector = "#user-drawer-content > ul:nth-child(2) > faceplate-tracker:nth-child(1) > li > a";

        let element = document.querySelector(usernameSelector);
        if (element && element.hasAttribute("href")) {
            return extractUsernameFromPath(element.getAttribute("href"));
        } else {
            return null;
        }
    }

    const profileButtonSelector = "#expand-user-drawer-button > span > span > div > faceplate-partial > span";
    document.querySelector(profileButtonSelector).click();
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            document.querySelector(profileButtonSelector).click();
            let username = attemptFindUsername();
            if (username) {
                resolve(username);
            } else {
                setTimeout(() => {
                    resolve(attemptFindUsername());
                }, 800);
            }
        }, 500);
        return null;
    });
}
async function getUsername() {
    if (usernameStatusObj.latestUsername) {
        console.log("Using cached latestUsername");
        return usernameStatusObj.latestUsername;
    }

    const { reddit_username, reddit_username_timestamp } = await chrome.storage.sync.get(['reddit_username', 'reddit_username_timestamp']);
    if (reddit_username && reddit_username_timestamp && reddit_username_timestamp > Date.now() - 24 * 60 * 60 * 1000) {
        console.log(`Avoided fetching username from Reddit (${reddit_username})`);
        usernameStatusObj.latestUsername = reddit_username;
        usernameStatusObj.fetching = false;
        return reddit_username;
    }

    if (usernameStatusObj.fetching) {
        console.log("Already fetching username, waiting for it to finish");
        return await (new Promise((resolve, reject) => {
            let n = 0;
            const interval = setInterval(() => {
                if (!usernameStatusObj.fetching) {
                    clearInterval(interval);
                    resolve(usernameStatusObj.latestUsername);
                } else if (n++ > 20) {
                    clearInterval(interval);
                    console.error("Timeout while waiting for username fetch");
                    reject(new Error("Timeout while waiting for username fetch"));
                }
            }, 100);
        }));
    } else {
        usernameStatusObj.fetching = true;
        const username = await getUsernameHelper();
        if (username) {
            usernameStatusObj.latestUsername = username;
            usernameStatusObj.fetching = false;

            safeStorageOperation('set', { reddit_username: username, reddit_username_timestamp: Date.now() }, () => {
                console.log('Username stored in storage');
            });
        }

        return username;
    }
}

(function() {
    let lastUrl = window.location.href;
    
    async function handleInitialInstall() {
        try {
            const primaryUsername = await getUsername();
            if (primaryUsername) {
                safeStorageOperation('get', ["userId", "extensionSetupTime", "initialDataStored"], async function(result) {
                    if (result) {
                        console.log('Initial install - storing user data');
                        const UUID = result.userId;
                        console.log(UUID);
                        const extensionSetupTime = result.extensionSetupTime;

                        // Use the second sendUserData function to fetch and store history
                        await sendUserData();  // This will store in Activity table

                        // Mark that initial data has been stored
                        safeStorageOperation('set', { initialDataStored: true }, () => {
                            console.log('Marked initial data as stored');
                        });

                        // Use the first sendUserData function to update login time
                        updateLoginTime();
                    }
                });
            }
        } catch (error) {
            console.error('Error in initial install handler:', error);
        }
    }

    async function updateLoginTime() {
        try {
            const primaryUsername = await getUsername();
            if (primaryUsername) {
                safeStorageOperation('get', ["userId", "extensionSetupTime"], async function(result) {
                    if (result) {
                        console.log('Updating login time');
                        const UUID = result.userId;
                        const extensionSetupTime = result.extensionSetupTime;

                        sendToDB({
                            UUID: UUID, 
                            Redditusername: primaryUsername, 
                            ExtensionInstallTime: getFormattedDateTime(extensionSetupTime), 
                            LoginTime: getFormattedDateTime(), 
                            table: 'Usernames'
                        });
                    }
                });
            }
        } catch (error) {
            console.error('Error updating login time:', error);
        }
    }

    async function sendUserData() {
        try {
            const primaryUsername = await getUsername();
            if (primaryUsername) {
                safeStorageOperation('get', ["userId", "extensionSetupTime"], async function(result) {
                    if (result) {
                        console.log('$result:', result);
                        const UUID = result.userId;
                        extensionSetupTime = result.extensionSetupTime;

                        // Send request to server to fetch and store user history
                        sendToDB({
                            UUID: UUID, 
                            Redditusername: primaryUsername, 
                            ExtensionInstallTime: getFormattedDateTime(extensionSetupTime), 
                            LoginTime: getFormattedDateTime(), 
                            table: 'Usernames'
                        });
                    }
                });
            }
        } catch (error) {
            console.error('Error sending user data:', error);
        }
    }
    // ------- Initialize and send user data -------
    handleInitialInstall();
    updateLoginTime();  // Update login time on every visit
    addEventListeners();
})();

function buttonElementEvent(event, buttonElement) {
    getComment(buttonElement);
}

async function searchTextBoxNewView(button) {
    const composer = button.closest('shreddit-composer');
    const interval = 100; // Check every 100 milliseconds
    const maxTime = 3000; // Maximum time to wait is 3000 milliseconds (3 seconds)

    return new Promise((resolve, reject) => {
        let elapsedTime = 0;
        const timer = setInterval(() => {
            const textBox = composer.querySelector('div[contenteditable="true"]');
            if (textBox || elapsedTime >= maxTime) {
                clearInterval(timer);
                if (textBox) {
                    resolve(textBox);
                } else {
                    reject(new Error('Text box not found within 3 seconds'));
                }
            }
            elapsedTime += interval;
        }, interval);
    });
}

async function findPublishedWithRetry(interval = 100, timeout = 30000) {
    let username = null;
    try {
        username = await getUsername();
    } catch (error) {
        console.error("Error fetching username:", error);
        return null;
    }
    
    if (!username) {
        console.error("No username found");
        return null;
    }
    
    return await (new Promise((resolve, _) => {
        const startTime = Date.now();
        const check = () => {
            let found = null;
            const elements = document.querySelectorAll(`shreddit-comment[author=${username}]`);
            // console.log(elements);
            for (const element of elements) {
                const timeEl = element.querySelector("time");
                if (!timeEl) continue;

                const time = Date.parse(timeEl.getAttribute('datetime'));
                if (!time || Math.abs(Date.now() - time) > 20000) continue; // check if the time is recent

                const permalink = element.getAttribute('permalink')?.split("/");
                if (permalink && permalink.length === 8) {
                    found = permalink[6];
                    break;
                }
            }
            
            if (found) {
                console.log("FOUND PUBLISHED ID", found);
                resolve(found);
            } else if (Date.now() - startTime >= timeout) {
                console.log("PUBLISHED COMMENT TIMED OUT");
                resolve(null);
            } else {
                setTimeout(check, interval);
            }
        };
        check();
    }));
}

async function publishedClickedEvent(event, button, SuggestButton) {
    const cache = {
        parentPostID: getParentPostID(),
        postStartTime: postStartTime,
        startTime: startTime,
    };
    if (activeAutoCompleteController) {
        activeAutoCompleteController.abort(); // Abort any existing request
    } 
    const buttonId = SuggestButton.id.split('REPLY')[1] || SuggestButton.id.split('SuggestCommentOldView')[1];
    let reply = false;
    let replyComment = findParentReply(button);
    if (replyComment != 'N/A' && replyComment != 'Not Reply') {
        reply = true;
    }
    let text = '';
    let publishedCommentID = null;
    let pattern = /^https:\/\/www\.reddit\.com\/.*$/;
    if (pattern.test(window.location.href)) {
        const textBox = await searchTextBoxNewView(button);
        removeAutoCompleteSuggestion(textBox);
        text = textBox? textBox.innerText : 'N/A';
        publishedCommentID = await findPublishedWithRetry();
    }
    pattern = /^https:\/\/old\.reddit\.com\/.*$/;
    if (pattern.test(window.location.href)) {
        const textBox = findTextBoxOldReddit(button);
        removeAutoCompleteSuggestion(textBox);
        text = textBox? textBox.innerText : 'N/A';
    }
    safeStorageOperation('get', ["userId"], function(result) {
        if (result) {
            const UUID = result.userId;
            sendPublishedComment({
                platform: "Reddit",
                UUID,
                url: location.href,
                replyID: reply ? buttonId : null,
                publishedComment: text,
                publishedCommentID: publishedCommentID,
                ...cache,
            });
            postStartTime = Date.now(); // get a new id
            collectAndSendData(true);
        }
    });
}

function findTextBoxOldReddit(buttonElement) {
    const buttonsDiv = buttonElement.closest('.usertext-buttons');
    const parentDiv = buttonsDiv ? buttonsDiv.parentElement?.parentElement : null;
    const textBoxDiv = parentDiv? parentDiv.firstElementChild : null;
    const textBox = textBoxDiv? textBoxDiv.firstElementChild : null;
    return textBox;
}

function injectTextCore(textBox, button, message) {
    let editor = textBox;
    editor.focus();
    document.execCommand('insertText', false, message);
    const textEvent = new Event('input', {
        bubbles: true,
        cancelable: true,
        data: message,
        inputType: 'insertText',
    });
    editor.dispatchEvent(textEvent);
    editor.focus()

    if (button) textBox.id = 'TextInput' + button.id.split('SuggestCommentNewView')[1];
}

async function findTextBox(button, message='') {
    console.log('findTextBox called');
    console.log('Button:', button);
    let composer = button.closest('shreddit-composer');
    if (composer) {
        console.log('Composer found');
        let textBox;
        let elapsedTime = 0;
        const interval = 100;
        const maxTime = 3000;

        return new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                textBox = composer.querySelector('div[contenteditable="true"]');
                if (textBox || elapsedTime >= maxTime) {
                    clearInterval(timer);
                    if (textBox) {
                        console.log('TextBox found');
                        resolve(textBox);
                    } else {
                        console.error('Text box not found within 3 seconds');
                        reject(new Error('Text box not found within 3 seconds'));
                    }
                }
                elapsedTime += interval;
            }, interval);
        }).then((textBox) => {
            console.log('Setting up autocomplete');
            if (message != '') {
                injectTextCore(textBox, button, message)
            }
            
            // Note from Ryan: 
            // Problem: autocomplete triggers multiple times
            // The problem was that multiple input eventlisteners were added to the same textbox
            // Solution: created a hashset that stores textboxes so we ensure only one event listener is added to each textbox
            if (!initializedTextboxes.has(textBox)) {
                // Debounce function
                const debounce = (func, delay) => {
                    let debounceTimer;
                    return function() {
                        const context = this;
                        const args = arguments;
                        clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => func.apply(context, args), delay);
                    }
                }
        
                // Cache for recent autocomplete suggestions
                const suggestionCache = new Map();
        
                // Minimum character limit before triggering autocomplete
                const MIN_CHARS = 3;

                // Function to remove suggestion when text box loses focus
                const handleBlur = () => {
                    removeAutoCompleteSuggestion(textBox);
                };
        
                // Adding event listener for auto suggestions
                textBox.addEventListener('keydown', function(event) {
                    if (event.key === 'Tab') {
                        event.preventDefault();
                        let autoCompleteSuggestion = getAutoCompleteSuggestion();
                        if (autoCompleteSuggestion) {
                            removeAutoCompleteSuggestion(textBox);

                            // Note from Ryan:
                            // Deletes repeated text from the autocomplete suggestion
                            // changed: autoCompleteSuggestion.replace(userTypedComment,'')
                            // injectTextCore(textBox, button, (userTypedComment?.endsWith(' ') ? '' : ' ') + autoCompleteSuggestion.replace(userTypedComment,''));
                            injectTextCore(textBox, button, autoCompleteSuggestion);

                            let autoCompleteData = getAutoCompleteData();
                            if (autoCompleteData) {
                                safeStorageOperation('get', ["userId"], function(result) {
                                    if (result) {
                                        const UUID = result.userId;
                                        sendAcceptedAutoComplete({
                                            platform: "Reddit",
                                            UUID,
                                            startTime,
                                            postStartTime,
                                            url: location.href,
                                            parentPostID: getParentPostID(),
                                            replyID: autoCompleteData.reply ? autoCompleteData.buttonId : null,
                                            acceptedSuggestion: autoCompleteData.autoCompleteSuggestion,
                                        });
                                    }
                                });
                            }
                        }
                    } else { 
                        // Note from Ryan: 
                        // Problem: The suggestion would stay even when the user typed something new
                            // Original code: else if (event.key === 'Backspace')
                            // New code: else
                            // new code solves this issue by removing the suggestion whenever the user types something
                        removeAutoCompleteSuggestion(textBox);
                    }
                });

                const triggerAutocomplete = debounce(async function () {
                    if (tempAutoCompleteDisabled) {
                        return;
                    }
                    console.log('triggerAutocomplete');
                    userTypedComment = textBox.innerText;
                    removeAutoCompleteSuggestion(textBox);

                    if (userTypedComment && userTypedComment.length >= MIN_CHARS && getCaretCoordinates(textBox).remainingText === '') {
                        // Create new AbortController for this request
                        if (activeAutoCompleteController) {
                            activeAutoCompleteController.abort(); // Abort any existing request
                        }
                        activeAutoCompleteController = new AbortController();
                        let signal = activeAutoCompleteController.signal;

                        try {
                            let { title, text, imageSource } = getPostInfo();
                            if (textBox.parentElement)
                                showSpinnerNewViewContainer(textBox.parentElement);
                            // Pass the signal to suggestAutoComplete
                            let {autoCompleteSuggestion, prompt, prompt_category} = await suggestAutoComplete(
                                title, 
                                text, 
                                userTypedComment, 
                                imageSource, 
                                "reddit",
                                activeAutoCompleteController.signal
                            );
                            const buttonId = button.id.split('REPLY')[1];
                            let parentReply = findParentReply(button);
                            let parentText;
                            let reply = false;
                            if (parentReply != 'N/A' && parentReply != 'Not Reply') {
                                parentText = parentReply;
                                reply = true;
                            } else {
                                parentText = text;
                            }
                            
                            if (autoCompleteSuggestion) {
                                showAutoCompleteSuggestion(
                                    autoCompleteSuggestion.replace(userTypedComment,''),
                                    textBox,
                                    false,
                                    false,
                                    { reply, autoCompleteSuggestion, buttonId });

                                // Cache the result
                                suggestionCache.set(userTypedComment, autoCompleteSuggestion);
        
                                safeStorageOperation('get', ["userId"], function(result) {
                                    if (result) {
                                        const UUID = result.userId;
                                        sendGotCompletion({
                                            platform: "Reddit",
                                            UUID,
                                            startTime,
                                            postStartTime,
                                            url: location.href,
                                            parentPostID: getParentPostID(),
                                            suggestion: autoCompleteSuggestion,
                                            userTyped: userTypedComment,
                                            parentText,
                                            prompt,
                                            promptCategory: prompt_category,
                                            completionType: "autocomplete",
                                            replyID: reply ? buttonId : null,
                                        });
                                    }
                                });
                            }
                            if (textBox.parentElement)
                                hideSpinnerNewViewContainer(textBox.parentElement);
                        } catch (error) {
                            if (error.name === 'AbortError') {
                                console.log('Autocomplete request aborted. Reason = ', signal?.reason);
                                hideSpinnerNewViewContainer(textBox.parentElement);
                                return;
                            } else if (error === "suggest") {
                                console.log('Autocomplete request aborted: suggest');
                                return;
                            }
                            hideSpinnerNewViewContainer(textBox.parentElement);
                            console.error('Error in autocomplete:', error);
                        }
                    }
                }, 1000);
                if (globalOptions.autocomplete) {
                    console.log('Adding input event listener');
                    textBox.addEventListener('input', (event) => {
                        console.log('Input event fired');
                        if (activeAutoCompleteController) {     
                            console.log('Input event fired (aborting...)');
                            activeAutoCompleteController.abort(); // Abort any existing request
                        }

                        triggerAutocomplete();
                    });
                }
        
                // Add blur event listener to remove suggestion when focus is lost
                textBox.addEventListener('blur', handleBlur);

                // Note from Ryan: add textbox to hashset 
                initializedTextboxes.add(textBox);

                // Find the closest comment-composer-host (or use composer if that's the top-level)
                const composerHost = composer.closest('comment-composer-host') || composer;

                // Set up a MutationObserver to watch for removal of the composerHost
                if (composerHost && composerHost.parentNode) {
                    const observer = new MutationObserver((mutations) => {
                        for (const mutation of mutations) {
                            for (const node of mutation.removedNodes) {
                                if (node === composerHost) {
                                    removeAutoCompleteSuggestion(textBox);
                                    observer.disconnect();
                                }
                            }
                        }
                    });
                    observer.observe(composerHost.parentNode, { childList: true });
                }
            }
            return textBox;
        }).catch(error => {
            console.error('Error in findTextBox:', error);
        });
    } else {
        console.error('Composer not found');
        return Promise.reject(new Error('Composer not found'));
    }
}

function createButtonNewView() {
    const button = document.createElement('button');
    button.id = 'SuggestCommentNewView' + Math.floor(Math.random() * 1000000) + "REPLY";
    button.setAttribute('rpl', '');
    button.className = 'relative button-small px-[var(--rem10)] button-primary items-center justify-center button inline-flex cursor-pointer';
    button.setAttribute('slot', 'submit-button');
    button.setAttribute('type', 'button');
    
    const spanOuter = document.createElement('span');
    spanOuter.className = 'flex items-center justify-center';

    const spanInner = document.createElement('span');
    spanInner.className = 'flex items-center gap-xs';

    const spanBlock = document.createElement('span');
    spanBlock.className = 'block relative';

    const spanContent = document.createElement('span');
    spanContent.setAttribute('slot', 'content');
    spanContent.style.opacity = '1';
    spanContent.textContent = "Suggest";
    
    const spanSpinner = document.createElement('span');
    spanSpinner.setAttribute('slot', 'spinner');
    spanSpinner.className = 'absolute inset-0 flex justify-center items-center hidden';
    spanSpinner.setAttribute('aria-hidden', 'true ');

    const style = document.createElement('style');
    style.textContent = `
        .custom-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid #ccc;
            border-top: 2px solid #333;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            display: inline-block;
            vertical-align: middle;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);

    // const iconLoad = document.createElement('icon-load');
    // iconLoad.setAttribute('size', 'md');
    // iconLoad.className = 'animate-spin leading-[0] absolute';
    // iconLoad.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10 6.25a.75.75 0 0 1-.75-.75V1.75a.75.75 0 0 1 1.5 0V5.5a.75.75 0 0 1-.75.75Zm.75 12V14.5a.75.75 0 1 0-1.5 0v3.75a.75.75 0 1 0 1.5 0ZM8.125 6.752a.75.75 0 0 0 .274-1.024L6.524 2.48a.757.757 0 0 0-.455-.36.757.757 0 0 0-.575.074.757.757 0 0 0-.351.462.757.757 0 0 0 .083.574L7.1 6.478a.75.75 0 0 0 1.024.274ZM14.5 17.794a.75.75 0 0 0 .274-1.024L12.9 13.523a.757.757 0 0 0-.455-.36.757.757 0 0 0-.575.074.758.758 0 0 0-.351.462.757.757 0 0 0 .083.574l1.875 3.247a.75.75 0 0 0 1.024.274ZM6.752 8.125a.75.75 0 0 0-.274-1.024L3.231 5.226a.75.75 0 0 0-.75 1.298L5.728 8.4a.75.75 0 0 0 1.024-.274ZM17.794 14.5a.75.75 0 0 0-.274-1.024L14.271 11.6a.75.75 0 0 0-.75 1.298l3.248 1.875a.75.75 0 0 0 1.024-.274ZM6.25 10a.75.75 0 0 0-.75-.75H1.75a.75.75 0 0 0 0 1.5H5.5a.75.75 0 0 0 .75-.75ZM19 10a.75.75 0 0 0-.75-.75H14.5a.75.75 0 1 0 0 1.5h3.75A.75.75 0 0 0 19 10ZM3.23 14.774 6.478 12.9a.757.757 0 0 0 .359-.455.757.757 0 0 0-.074-.575.757.757 0 0 0-.461-.351.757.757 0 0 0-.574.083l-3.247 1.875a.757.757 0 0 0-.36.455.757.757 0 0 0 .074.575c.1.173.269.301.462.351.192.05.403.02.574-.083ZM14.272 8.4l3.248-1.875a.757.757 0 0 0 .359-.455.757.757 0 0 0-.074-.575.757.757 0 0 0-.461-.351.757.757 0 0 0-.574.083L13.522 7.1a.757.757 0 0 0-.359.455.757.757 0 0 0 .074.575c.1.173.268.301.461.351.193.05.403.02.574-.083ZM6.524 17.52 8.4 14.273a.757.757 0 0 0 .083-.574.757.757 0 0 0-.35-.461.757.757 0 0 0-.576-.074.757.757 0 0 0-.455.359L5.226 16.77a.757.757 0 0 0-.083.574c.05.192.178.362.35.461.173.1.384.127.576.074a.757.757 0 0 0 .455-.359ZM12.9 6.478l1.875-3.247a.75.75 0 0 0-1.298-.75L11.6 5.728a.757.757 0 0 0-.083.574c.05.193.178.362.35.461.173.1.384.127.576.074a.757.757 0 0 0 .455-.359Z"></path></svg>';
    
    // spanSpinner.appendChild(iconLoad);
    spanBlock.appendChild(spanContent);
    spanBlock.appendChild(spanSpinner);
    spanInner.appendChild(spanBlock);
    spanOuter.appendChild(spanInner);
    button.appendChild(spanOuter);
    return button;
}

/* adds a unique id to each draft editor*/
function findDraftEditor(button) {
    let commonAncestor = button.closest('._3MknXZVbkWU8JL9XGlzASi');
    let buttonNumber = button.id.split('SuggestCommentOldView')[1];
    let draftEditor = commonAncestor.querySelector('.DraftEditor-root');
    draftEditor.id = 'DraftEditor' + buttonNumber;
    return draftEditor;
}

function findParentReply(button) {
    let pattern = /^https:\/\/www\.reddit\.com\/.*$/;
    if (pattern.test(window.location.href)) {
        let ReplyActionWrapper = button.closest('shreddit-comment-action-row');
        if (ReplyActionWrapper) {
            // Reply buttons are id'd "...REPLY<commentId>"; look the parent comment
            // up by id rather than relying on Reddit's DOM layout.
            const commentId = button.id.split('REPLY')[1];
            const text = commentId && document.querySelector(`#t1_${commentId}-comment-rtjson-content`);
            return text?.innerText?.trim() || 'N/A';
        }
    }
    return 'N/A'
}

function createButtonWithOldView() {
    const divWrapper = document.createElement('div');
    divWrapper.className = '_3SNMf5ZJL_5F1qxcZkD0Cp';
    divWrapper.style.maxWidth = '50%';
    divWrapper.style.maxWidth = '90px';

    const button = document.createElement('button');
    button.id = 'SuggestCommentOldView' + Math.floor(Math.random() * 1000000);
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('type', 'button');
    button.className = '_22S4OsoDdOqiM-hPTeOURa _2iuoyPiKHN3kfOoeIQalDT _10BQ7pjWbeYP63SAPNS8Ts _3uJP0daPEH2plzVEYyTdaH';
    button.style.width = '70%';
    
    const spanText = document.createElement('span');
    spanText.textContent = 'Suggest';
    spanText.setAttribute('slot', 'text');
    spanText.style.opacity = '1';

    const style = document.createElement('style');
    style.textContent = `
        @keyframes dotFlashing {
            0% { opacity: 0; }
            50%, 100% { opacity: 1; }
        }

        .dot-flashing {
            display: inline-block;
            position: relative;
            width: 0.8em;
            height: 0.8em;
            margin: auto;
        }

        .dot-flashing::before, .dot-flashing::after {
            content: '';
            display: inline-block;
            position: absolute;
            top: 0;
            width: 0.8em;
            height: 0.8em;
            border-radius: 50%;
            background-color: white;
            animation: dotFlashing 0.5s infinite linear alternate;
        }

        .dot-flashing::before {
            left: -1.2em;
        }

        .dot-flashing::after {
            left: 1.2em;
        }

        .dot-flashing div {
            position: absolute;
            width: 0.8em;
            height: 0.8em;
            border-radius: 50%;
            background-color: white;
            animation: dotFlashing 0.5s infinite linear alternate;
            animation-delay: 0.25s;
        }
    `;

    document.head.appendChild(style);

    const divDotFlashing = document.createElement('div');
    divDotFlashing.className = 'dot-flashing';
    divDotFlashing.setAttribute('role', 'status');
    const divDot = document.createElement('div');
    const spanSrOnly = document.createElement('span');
    spanSrOnly.className = 'sr-only';
    spanSrOnly.textContent = 'Loading...';
    divDotFlashing.appendChild(divDot);
    divDotFlashing.appendChild(spanSrOnly);
    divDotFlashing.style.display = 'none';
    
    const divLoaderWrapper = document.createElement('div');
    divLoaderWrapper.style.display = 'flex';
    divLoaderWrapper.style.justifyContent = 'center';
    divLoaderWrapper.style.alignItems = 'center';
    divLoaderWrapper.style.position = 'absolute';
    divLoaderWrapper.style.width = '100%';
    divLoaderWrapper.style.height = '100%';
    divLoaderWrapper.style.top = '0';
    divLoaderWrapper.appendChild(divDotFlashing);
    
    button.appendChild(spanText);
    button.appendChild(divLoaderWrapper);

    divWrapper.appendChild(button);

    return divWrapper;
}

function createButtonWithOldRedditView() {
    // Create the div wrapper with the specified class

    // Create the button with specified attributes and classes
    const button = document.createElement('button');
    button.id = 'SuggestCommentOldRedditView' + Math.floor(Math.random() * 1000000);
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('type', 'button');
    button.classList.add('save');
    button.classList.add('disable-hover');
    
    const spanText = document.createElement('span');
    spanText.textContent = 'suggest';
    spanText.setAttribute('slot', 'text');
    spanText.style.opacity = '1';

    const style = document.createElement('style');
    style.textContent = `
        @keyframes dotFlashing {
            0% { opacity: 0; }
            50%, 100% { opacity: 1; }
        }

        .dot-flashing {
            display: inline-block;
            position: relative;
            width: 0.8em;
            height: 0.8em;
            margin: auto;
        }

        .dot-flashing::before, .dot-flashing::after {
            content: '';
            display: inline-block;
            position: absolute;
            top: 0;
            width: 0.8em;
            height: 0.8em;
            border-radius: 50%;
            background-color: white;
            animation: dotFlashing 0.5s infinite linear alternate;
        }

        .dot-flashing::before {
            left: -1.2em;
        }

        .dot-flashing::after {
            left: 1.2em;
        }

        .dot-flashing div {
            position: absolute;
            width: 0.8em;
            height: 0.8em;
            border-radius: 50%;
            background-color: white;
            animation: dotFlashing 0.5s infinite linear alternate;
            animation-delay: 0.25s;
        }
    `;
    document.head.appendChild(style);

    const divDotFlashing = document.createElement('div');
    divDotFlashing.className = 'dot-flashing';
    divDotFlashing.setAttribute('role', 'status');
    const divDot = document.createElement('div');
    divDotFlashing.appendChild(divDot);
    divDotFlashing.style.display = 'none';
    
    const divLoaderWrapper = document.createElement('div');
    divLoaderWrapper.style.display = 'flex';
    divLoaderWrapper.style.justifyContent = 'center';
    divLoaderWrapper.style.alignItems = 'center';
    divLoaderWrapper.style.position = 'absolute';
    divLoaderWrapper.style.width = '100%';
    divLoaderWrapper.style.height = '100%';
    divLoaderWrapper.style.inset = '0';
    divLoaderWrapper.appendChild(divDotFlashing);
    
    button.appendChild(spanText);
    button.style.position = 'relative';
    button.appendChild(divLoaderWrapper);

    return button;
}

// Add this new function to set up autocomplete for old Reddit
function setupOldRedditAutocomplete(textBox, button) {
    if (!initializedTextboxes.has(textBox)) {
        const debounce = (func, delay) => {
            let debounceTimer;
            return function() {
                const context = this;
                const args = arguments;
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => func.apply(context, args), delay);
            }
        }

        const suggestionCache = new Map();
        const MIN_CHARS = 3;

        const handleBlur = () => {
            removeAutoCompleteSuggestion(textBox);
        };

        textBox.addEventListener('keydown', function(event) {
            if (event.key === 'Tab') {
                event.preventDefault();
                let autoCompleteSuggestion = getAutoCompleteSuggestion();
                if (autoCompleteSuggestion) {
                    removeAutoCompleteSuggestion(textBox);
                    textBox.value += (userTypedComment?.endsWith(' ') ? '' : ' ') + autoCompleteSuggestion.replace(userTypedComment,'');
                }
            } else {
                removeAutoCompleteSuggestion(textBox);
            }
        });

        const triggerAutocomplete = debounce(async function () {
            if (tempAutoCompleteDisabled) {
                return;
            }
            userTypedComment = textBox.value;
            removeAutoCompleteSuggestion(textBox);

            if (userTypedComment && userTypedComment.length >= MIN_CHARS) {
                let { title, text, imageSource } = getPostInfo();
                
                if (suggestionCache.has(userTypedComment)) {
                    showAutoCompleteSuggestion(suggestionCache.get(userTypedComment).replace(userTypedComment,''), textBox, false, true);
                    return;
                }

                let {autoCompleteSuggestion, prompt, prompt_category} = await suggestAutoComplete(title, text, userTypedComment, imageSource, "reddit");
                const buttonId = button.id.split('SuggestCommentOldRedditView')[1];
                let parentReply = findParentReply(button);
                let parentText;
                let reply = false;
                if (parentReply != 'N/A' && parentReply != 'Not Reply') {
                    parentText = parentReply;
                    reply = true;
                } else {
                    parentText = text;
                }
                
                if (autoCompleteSuggestion) {
                    showAutoCompleteSuggestion(autoCompleteSuggestion.replace(userTypedComment,''), textBox, false, true);
                    suggestionCache.set(userTypedComment, autoCompleteSuggestion);
                }

                safeStorageOperation('get', ["userId"], function(result) {
                    if (result) {
                        const UUID = result.userId;
                        sendGotCompletion({
                            platform: "Reddit",
                            UUID,
                            startTime,
                            postStartTime,
                            url: location.href,
                            parentPostID: getParentPostID(),
                            suggestion: autoCompleteSuggestion,
                            userTyped: userTypedComment,
                            parentText,
                            prompt,
                            promptCategory: prompt_category,
                            completionType: "autocomplete",
                            replyID: reply ? buttonId : null,
                        });
                    }
                });
            }
        }, 1000);

        if (globalOptions.autocomplete) {
            textBox.addEventListener('input', (event) => {
                triggerAutocomplete();
            });
        }

        textBox.addEventListener('blur', handleBlur);

        initializedTextboxes.add(textBox);
    }
}

function showSpinnerNewViewContainer(parent) {
    if (!parent) return;
    // console.log("SHOW SPINNER", parent);
    let spinner = parent.querySelector('.custom-spinner');

    if (spinner) {
        spinner.style.display = ''; // Unhide
    } else {
        // Similar to the `cancel` button
        spinner = document.createElement('div');
        spinner.className = 'custom-spinner items-center justify-center button inline-flex';
        spinner.setAttribute("slot", "cancel-button");
        parent.appendChild(spinner);
    }
}

function showSpinnerForNewViewButton(buttonId) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    const parent = button.parentElement;
    if (parent) showSpinnerNewViewContainer(parent);


    if (buttonId.includes('NewView')) {
        document.querySelector(`#${buttonId} [slot="spinner"]`).classList.remove('hidden');
        document.querySelector(`#${buttonId} [slot="content"]`).style.opacity = '0';
        if (button) {
            button.disabled = true;
            button.classList.remove("cursor-pointer");
            button.classList.add("cursor-wait");
        }
    } else {
        const loader = document.querySelector(`#${buttonId} .dot-flashing`);
        const divInner = document.querySelector(`#${buttonId} span[slot='text']`);
        if (loader) {
            loader.style.display = 'inline-block';
        }
        if (divInner) {
            divInner.style.opacity = '0';
        }
    }
}

function hideSpinnerNewViewContainer(parent) {
    if (!parent) return;

    const spinner = parent.querySelector('.custom-spinner');
    if (spinner) {
        spinner.style.display = 'none';
    }
}


function hideSpinnerForNewViewButton(buttonId) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    const parent = button.parentElement;
    if (parent) hideSpinnerNewViewContainer(parent);

    if (buttonId.includes('NewView')) {
        document.querySelector(`#${buttonId} [slot="spinner"]`).classList.add('hidden');
        document.querySelector(`#${buttonId} [slot="content"]`).style.opacity = '1';
        if (button) {
            button.disabled = false;
            button.classList.remove("cursor-wait");
            button.classList.add("cursor-pointer");
        }
    } else {
        const loader = document.querySelector(`#${buttonId} .dot-flashing`);
        const divInner = document.querySelector(`#${buttonId} span[slot='text']`);
        if (loader) {
            loader.style.display = 'none';
        }
        if (divInner) {
            divInner.style.opacity = '1';
        }
    }
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === "resetAndCollectAdData") {
        resetPostAdData(message.postUUID);
        collectAndSendData();
    } else if (message.message === "page-load") {
        if (message.options) {
            globalOptions = {
                ...globalOptions,
                ...message.options,
            };
        }
        postsOpened += 1;
        postStartTime = Date.now();
        initialCollectAndSendData(collectAndSendDataCallback, "reddit");
        setTimeout(async function() {
            console.log("Global options", globalOptions);
            webpageOpenTime = getFormattedDateTime();
            let username = document.querySelector("#overlayScrollContainer > div._1npCwF50X2J7Wt82SZi6J0 > div.u35lf2ynn4jHsVUwPmNU.Dx3UxiK86VcfkFQVHNXNi > div.uI_hDmU5GSiudtABRz_37 > div._1r4smTyOEZFO91uFIdWW6T.aUM8DQ_Nz5wL0EJc_wte6 > div._2kZkQ13N-kvhDEJOBd1S1I > span > a") || document.querySelector("#user-drawer-content > ul:nth-child(1) > faceplate-tracker:nth-child(1) > li > a > span.flex.items-center.gap-xs.min-w-0.shrink > span.flex.flex-col.justify-center.min-w-0.shrink.py-\\[var\\(--rem6\\)\\] > span.text-12.text-secondary-weak");
            if (!username) {
                try {
                    username = document.querySelector('.user') || 'Username failed to fetch'; //document.querySelector("#AppRouter-main-content > div > div > div._3ozFtOe6WpJEMUtxDOIvtU > div._31N0dvxfpsO6Ur5AKx4O5d > div._1OVBBWLtHoSPfGCRaPzpTf._3nSp9cdBpqL13CqjdMr2L_.2udhMC-jldHp_EpAuBeSR1.PaJBYLqPf_Gie2aZntVQ7._2OVNlZuUd8L9v0yVECZ2iA > div.uI_hDmU5GSiudtABRz_37 > div._1r4smTyOEZFO91uFIdWW6T.aUM8DQ_Nz5wL0EJc_wte6 > div._2kZkQ13N-kvhDEJOBd1S1I > span > a")
                } catch (error) {
                    console.error(error);
                }
            }
            let subredditElement = document.querySelector("#\\32 x-container > div > div:nth-child(2) > div:nth-child(6)");

            let subredditName = subredditElement ? subredditElement.className.substring(16) : null;
            if (!subredditName) {
                let subredditNameElements = document.querySelectorAll('.subreddit-name');
                subredditName = subredditNameElements.length > 0 ? subredditNameElements[0].textContent : null;
            }
            if (subredditName) {
                let subredditNameSelector = subredditName.match(/r\/\w+/);
                if (subredditNameSelector) {
                    subredditName = subredditNameSelector[0];
                }
            }
            if (!subredditName) {
                let subredditSpan = document.querySelector("#AppRouter-main-content > div > div > div._3ozFtOe6WpJEMUtxDOIvtU > span > a > div > div._2ejRlONMr5WoDRgyd4GRyM > span");
                subredditName = subredditSpan ? subredditSpan.textContent.split(' ')[0].substring(2) : null;
                if (!subredditName) {
                    subredditName = document.querySelector('span.redditname a')? document.querySelector('span.redditname a').textContent : null;
                }
            }
            safeStorageOperation('get', ["userId"], async function(result) {
                if (result) {
                    if (username && username.textContent) {
                        let cleanedUsername = username.textContent.startsWith('u/') ? username.textContent.substring(2) : username.textContent;
                        let matchResult = cleanedUsername.match(/^[\w-]+/);
                        if (matchResult && matchResult.length > 0) {
                            let primaryUsername = matchResult[0];
                            sendToDB({
                                UUID: result.userId + Date.now(),
                                Redditusername: primaryUsername,
                                ExtensionInstallTime: result.extensionSetupTime,
                                table: 'Usernames'
                            });
                        }
                    }
                    const UUID = result.userId;
                    const { title, text, imageSource, score } = getPostInfo()


                    sendPageView({
                        platform: "Reddit",
                        url: location.href,
                        parentPostID: getParentPostID(),
                        postInformation: {
                            title,
                            subreddit: subredditName,
                            text,
                            score,
                        },
                        postStartTime,
                        startTime,
                        UUID,
                    });
                }
            });
            let pattern = /^https:\/\/old\.reddit\.com\/.*$/;
            let oldRedditTarget = null;
            if(pattern.test(window.location.href)) {
                if (!oldRedditTarget) {
                    async function getOldRedditTargetWithTimeout() {
                        let elapsedTime = 0;
                        while (elapsedTime < 1000) {
                            const startT = Date.now();
                            const oldRedditTarget = document.querySelector('.usertext-buttons');
                            oldRedditTarget.id = 'old-reddit-' + Math.floor(Math.random() * 1000000);
                            if (oldRedditTarget) {
                                return oldRedditTarget;
                            }
                            await new Promise(resolve => setTimeout(resolve, 100)); // Wait for 100 milliseconds before trying again
                            elapsedTime += Date.now() - startT;
                        }
                        throw new Error('Could not find old Reddit target within 1 second.');
                    }
                    async function replyBoxesListOldRedditTarget() {
                        let elapsedTime = 0;
                        while (elapsedTime < 1000) {
                            const startT = Date.now();
                            oldRedditTarget = document.querySelectorAll('.usertext-buttons');
                            if (oldRedditTarget) {
                                return oldRedditTarget;
                            }
                            await new Promise(resolve => setTimeout(resolve, 100)); // Wait for 100 milliseconds before trying again
                            elapsedTime += Date.now() - startT;
                        }
                    }
                    function setupMutationObserverOldRedditTarget() {
                        let observer = null;
                        const cleanup = () => {
                            if (observer) {
                                observer.disconnect();
                                observer = null;
                            }
                        };

                        observer = new MutationObserver((mutations, obs) => {
                            mutations.forEach(mutation => {
                                replyBoxesListOldRedditTarget().then(oldRedditTargetResult => {
                                    for (let i = 0; i < oldRedditTargetResult.length; i++) {
                                        const target = oldRedditTargetResult[i];
                                        if (!target.querySelector('[id^="SuggestCommentOldRedditView"]') && globalOptions.suggest) {
                                            const oldRedditSuggestButton = createButtonWithOldRedditView();
                                            target.appendChild(oldRedditSuggestButton);
                                            oldRedditSuggestButton.addEventListener('click', (event) => {
                                                buttonElementEvent(event, oldRedditSuggestButton)
                                            });
                                            const textBox = findTextBoxOldReddit(oldRedditSuggestButton);
                                            if (textBox) {
                                                setupOldRedditAutocomplete(textBox, oldRedditSuggestButton);
                                            }
                                        }
                                    }
                                }).catch(error => {
                                    console.error('Error in mutation observer:', error);
                                    cleanup();
                                });
                            });
                        });

                        // Start observing the document body for DOM changes
                        observer.observe(document.body, {
                            childList: true, 
                            subtree: true,
                            attributes: false
                        });

                        // Clean up observer when page is unloaded
                        window.addEventListener('unload', cleanup);
                    }
                    if (!oldRedditTarget) {
                        getOldRedditTargetWithTimeout().then(async oldRedditTarget => {
                            if (!document.querySelector('[id^="SuggestCommentOldRedditView"]') && globalOptions.suggest) {
                                setupMutationObserverOldRedditTarget();
                                const oldRedditSuggestButton = createButtonWithOldRedditView();
                                oldRedditTarget.appendChild(oldRedditSuggestButton);
                                oldRedditSuggestButton.addEventListener('click', (event) => {
                                    buttonElementEvent(event, oldRedditSuggestButton);
                                });
                                const textBox = await findTextBoxOldReddit(oldRedditSuggestButton);
                                if (textBox) {
                                    setupOldRedditAutocomplete(textBox, oldRedditSuggestButton);
                                    textBox.addEventListener('input', (event) => {
                                        if (textBox.value.trim() != '') {
                                            sendTextBoxEntryToDB(event.target.value, oldRedditSuggestButton.id.split('SuggestCommentOldRedditView')[1], oldRedditSuggestButton);
                                        }
                                    });
                                }
                            }
                        }).catch(error => {
                            console.error(error);
                        });
                    }

                }
            }
            let newTarget = null;
            pattern = /^https:\/\/www\.reddit\.com\/.*$/;
            if (pattern.test(window.location.href)) {
                if (!newTarget) {
                    async function findNewTarget() {
                        let elapsedTime = 0;
                        while (elapsedTime < 25000) {
                            const startT = Date.now();
                            newTarget = document.querySelector('shreddit-composer');
                            if (newTarget) {  // Ensure no duplicate button in the new target
                                return { target: newTarget, type: 'new' };
                            }
                            await new Promise(resolve => setTimeout(resolve, 100)); // Throttle the loop slightly
                            elapsedTime += Date.now() - startT;
                        }
                        //throw new Error('Could not find new Target within 25 seconds.');
                    }
                    async function replyBoxesListNewTarget() {
                        let elapsedTime = 0;
                        while (elapsedTime < 25000) {
                            const startT = Date.now();
                            newTarget = document.querySelectorAll('shreddit-composer');
                            if (newTarget) {  // Ensure no duplicate button in the new target
                                return { target: newTarget, type: 'new' };
                            }
                            await new Promise(resolve => setTimeout(resolve, 100)); // Wait for 100 milliseconds before trying again
                            elapsedTime += Date.now() - startT;
                        }
                    }
                    function setupComposerFunctionality(target) {
                        if (!target.classList.contains('comment-functionality-enabled')) {
                            console.log("Setting up composer functionality");
                            const buttonElement = createButtonNewView();
                            const parentCommentEl = target.closest("shreddit-comment-action-row");
                            if (parentCommentEl) { // reply, use id of comment
                                const commentId = parentCommentEl.getAttribute('comment-id').split("_");
                                if (commentId.length === 2) {
                                    buttonElement.id += commentId[1];
                                }
                            }
                            target.appendChild(buttonElement);
                            
                            // Find the submit/publish button
                            const publishButton = target.querySelector('[type="submit"]');
                            if (publishButton) {
                                publishButton.addEventListener('click', (event) => {
                                    publishedClickedEvent(event, publishButton, buttonElement);
                                });
                            }
                    
                            // Set up text box functionality
                            findTextBox(buttonElement).then(textBox => {
                                if (textBox) {
                                    textBox.id = 'TextInput' + buttonElement.id.split('SuggestCommentNewView')[1];
                                    textBox.addEventListener('input', (event) => {
                                        if (textBox.innerText.trim() != '') {
                                            sendTextBoxEntryToDB(event.target.innerText, buttonElement.id.split('REPLY')[1], buttonElement);
                                        }
                                    });
                                }
                            });
                    
                            // Handle button visibility
                            if (globalOptions.suggest) {
                                buttonElement.addEventListener('click', (event) => {
                                    buttonElementEvent(event, buttonElement);
                                });
                            } else {
                                target.removeChild(buttonElement);
                            }
                            
                            target.classList.add('comment-functionality-enabled');
                        }
                    }
                    function setupMutationObserverNewTarget() {
                        const observer = new MutationObserver((mutations, obs) => {
                            mutations.forEach(mutation => {
                                replyBoxesListNewTarget().then(newTargetResult => {
                                    // Handle regular comment composers
                                    if (newTargetResult?.target) {
                                        for (let i = 0; i < newTargetResult.target.length; i++) {
                                            const target = newTargetResult.target[i];
                                            setupComposerFunctionality(target);
                                        }
                                    }
                                    
                                    // Handle post creation composer
                                    const postComposer = document.querySelector('div[data-test-id="post-composer"]');
                                    if (postComposer && !postComposer.classList.contains('comment-functionality-enabled')) {
                                        setupComposerFunctionality(postComposer);
                                    }
                                }).catch(error => {
                                    console.error('Error setting up composer functionality:', error);
                                });
                            });
                        });

                        // Start observing the document body for DOM changes
                        observer.observe(document.body, {
                            childList: true,
                            subtree: true,
                            attributes: false
                        });
                    }
                    if (!newTarget) {
                        findNewTarget().then(newTarget => {
                            // Button creation and appending happens here once per new target
                            if (!newTarget.target.classList.contains('comment-functionality-enabled')) {
                                setupMutationObserverNewTarget();
                            }
                        }).catch(error => {
                            console.error(error);
                        });
                    }
                }
            }
            // database entry when user presses the comment button
        }, 700);
    }
});

function injectContentIntoRedditEditor(button, message) {
    // Assuming there's a way to identify the Draft.js editor, for example, by a unique class
    let pattern = /^https:\/\/www\.reddit\.com\/.*$/;
    if (pattern.test(window.location.href)) {
        let editor = findTextBox(button, message);
    }
    pattern = /^https:\/\/old\.reddit\.com\/.*$/;
    if (pattern.test(window.location.href)) {
        let textBox = findTextBoxOldReddit(button);
        if (textBox) {
            textBox.value = message;
        }
    }

}

const getComment = async (buttonElement) => {
    // Abort any pending autocomplete requests
    if (activeAutoCompleteController) {
        activeAutoCompleteController.abort("suggest");
        activeAutoCompleteController = null;
    }

    // Always re-enable autocomplete, even if fetching the suggestion fails;
    // otherwise autocomplete stays off until the page is reloaded.
    tempAutoCompleteDisabled = true;
    try {
        await fetchAndInjectSuggestion(buttonElement);
    } catch (error) {
        console.error('Error getting suggested comment:', error);
    } finally {
        hideSpinnerForNewViewButton(buttonElement.id);
        tempAutoCompleteDisabled = false;
    }
}

async function fetchAndInjectSuggestion(buttonElement) {
    let reply = false;
    let replyComment = 'N/A';
    replyComment = findParentReply(buttonElement);
    if (replyComment != 'N/A' && replyComment != 'Not Reply') {
        reply = true;
    }
    showSpinnerForNewViewButton(buttonElement.id);
    let { title, text, imageSource } = getPostInfo();
    let parentText = '';
    if (reply) {
        parentText = replyComment;
    } else {
        parentText = text;
    }
    let pattern = /^https:\/\/www\.reddit\.com\/.*$/;
    let userTypedCommentBox = null;
    if (pattern.test(window.location.href)) {
        userTypedCommentBox = await searchTextBoxNewView(buttonElement);
    }
    pattern = /^https:\/\/old\.reddit\.com\/.*$/;
    if (pattern.test(window.location.href)) {
        userTypedCommentBox = await findTextBoxOldReddit(buttonElement);
    }
    let userTypedComment = userTypedCommentBox ? userTypedCommentBox.innerText : '';
    const flaskResult = await postCommentToFlask(text, title, userTypedComment ? userTypedComment : '', imageSource, reply, replyComment, buttonElement);
    if (!flaskResult) {
        console.error('No suggestion received from server');
        return;
    }
    const {comment,prompt,prompt_category} = flaskResult;
    suggestedComment = comment ? comment : '';
    suggestedComment = suggestedComment.replace(/^\s*[""']+|[""']+\s*$/g, '');
    injectContentIntoRedditEditor(buttonElement, suggestedComment);
    hideSpinnerForNewViewButton(buttonElement.id);
    suggestedCommentTime = getFormattedDateTime();
    let submissionElem = document.querySelector("h1[class*='_eYtD2XCVieq6emjKBH3m']");
    if (submissionElem) {
        submissionElem = submissionElem.textContent;
    }
    safeStorageOperation('get', ["userId"], function(result) {
        if (result) {
            const UUID = result.userId;
            userTypedComment = userTypedComment.trim();
            if (userTypedComment in ['\n\n\n', ' ', '', '\n', '\n\n']) {
                userTypedComment = 'N/A';
            }
            let buttonId = buttonElement.id.split('REPLY')[1] || buttonElement.id.split('SuggestCommentOldView')[1] || buttonElement.id.split('SuggestCommentOldRedditView')[1];
            sendGotCompletion({
                platform: "Reddit",
                UUID,
                startTime,
                postStartTime,
                url: location.href,
                parentPostID: getParentPostID(),
                suggestion: comment,
                userTyped: userTypedComment,
                parentText,
                prompt,
                promptCategory: prompt_category,
                completionType: "suggest",
                replyID: reply ? buttonId : null,
            });
        }
    });
}

function getFormattedDateTime(timestamp = Date.now()) {
    const now = new Date(timestamp);
    return now.toISOString();
}

function formatTimeInterval(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getStorageData(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }
            resolve(result);
        });
    });
}

async function postCommentToFlask(text, title, writtenText, imageSource, reply, replyComment, button) {

    const flaskEndpoint = `${SERVER_ENDPOINT}/get_comment`;
    let context = false;
    if (writtenText.trim() != '') {
        context = true;
    }
    const { selectedLength, selectedTone, selectedHumor, instructions, sampleComments, treatment } = await getStorageData(['selectedLength', 'selectedTone', 'selectedHumor', 'instructions', 'sampleComments', 'treatment']); // JAVIER CHANGE
    const requestData = {
        title: title.trim().replace(/\s+/g, ' '),
        text: text.trim().replace(/\s+/g, ' '),
        writtenText: writtenText,
        context: context,
        tone: selectedTone,
        humor: selectedHumor,
        length: selectedLength,
        instructions: instructions,
        sampleComments: sampleComments,
        imageSource: imageSource,
        twitter: 'false',
        reply: reply,
        replyComment: replyComment,
        treatment,
    };
    try {
        const response = await fetch(flaskEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            if (response.status === 429) {
                let errorMessageList = [
                'You\'re clicking faster than we can keep up! Time for a quick one-minute coffee break.', 
                'You\'re doing great, but let\'s pace ourselves! Take a minute, then hit it again!', 
                'Whoa, turbo! Let\'s put a one-minute pause on that enthusiasm!',
                'Wow, you\'re speedy! Let\'s take a short 60-second timeout for a stretch.', 
                'You\'re on a roll, but even superheroes need a quick break! See you in a minute.', 
                'Racing through, aren\'t we? Let\'s hit the brakes for just a minute and resume shortly.',
                'You\'re setting records with those clicks! Time to catch our breath for a minute.'
                ];
                let randomIndex = Math.floor(Math.random() * errorMessageList.length);
                chrome.runtime.sendMessage({ message: errorMessageList[randomIndex]});
            }
            return null;
        }

        const responseData = await response.json();
        if (responseData.error) {
            return null;
        }

        return {
            comment:responseData.comment,
            prompt:responseData.prompt,
            prompt_category:responseData.prompt_category
        };
    } catch (error) {
        return null;
    }
}



// Add visibility change handler
document.addEventListener('visibilitychange', async function() {
    if (document.visibilityState === 'hidden') {
        try {
            await calculateTime();
            console.log('Calculate time completed');
        } catch (error) {
            console.error('Error in visibility change handler:', error);
        }
    } else {
        visibilityStartTime = Date.now();
    }
});
window.addEventListener('beforeunload', async function(event) {
    try {
        await calculateTime();
    } catch (error) {
        console.error('Error in beforeunload handler:', error);
    }
});

function getPostScore() {
    const scoreElement = document.querySelector("#main-content > shreddit-post")?.shadowRoot?.querySelector("div.shreddit-post-container.flex.gap-sm.flex-row.items-center.flex-nowrap.justify-start.h-2xl.mt-md.px-md.xs\\:px-0 > span > span > span > faceplate-number");
    if (!scoreElement) return null;
    const score = Number.parseInt(scoreElement?.getAttribute("number"));
    if (!score || isNaN(score)) return null;
    return score;
}

function getPostInfo() {
    const divs = Array.from(document.querySelectorAll('div[id*="-post-rtjson-content"]'));

    const filteredDivs = divs.filter(div => {
        const id = div.id;
        return /^.+-post-rtjson-content$/.test(id); 
    });

    // Extract the content from the filtered divs
    let genericSubmissionText = filteredDivs[0] || '';
    let genericSubmissionTitle = document.querySelector('[id^="post-title-"], ._eYtD2XCVieq6emjKBH3m._2SdHzo12ISmrC8H86TgSCp._29WrubtjAcKqzJSPdQqQ4h') || document.querySelector("#thing_t3_1by8uvf > div.entry.unvoted > div.top-matter > p.title > a") || document.querySelector('a[data-event-action="title"]');
    let title = genericSubmissionTitle ? genericSubmissionTitle.textContent || genericSubmissionTitle.innerText : '';
    let text = genericSubmissionText ? genericSubmissionText.textContent || genericSubmissionText.innerText : '';
    const img = (document.querySelector("gallery-carousel")?.querySelector("img") ??
        document.querySelector("#post-image"));
    let imageSource = 'N/A';
    if (img) {
        imageSource = img.src;
        console.log("image source:", imageSource);
    }
    if (text) {
        text = text.trim();
    }
    if (title) {
        title = title.trim();
    }

    // compute score = (upvotes - downvotes)
    let score = getPostScore();

    return { title, text, imageSource, score };
}

function collectAndSendDataCallback(adsInfo) {
    // console.log("getting info", postStartTime, getParentPostID());
    if (!postStartTime) return;

    if (!getParentPostID()) {
        return;
    }

    safeStorageOperation('get', ["userId"], async function(result) {
        if (result) {
            const UUID = result.userId;
            sendPageView({
                platform: "Reddit",
                url: location.href,
                parentPostID: getParentPostID(),
                postInformation: getPostInfo(),
                postStartTime,
                adsInfo,
                startTime,
                UUID,
            });
        }
    });
}


// debounce function to prevent multiple calls to the database
function debounce(func, delay) {
    let debounceTimer;
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(context, args), delay);
    }
}
const sendTextBoxEntryToDB = debounce((text, typeID, buttonElement) => {
    safeStorageOperation('get', ["userId"], function(result) {
        if (result) {
            const UUID = result.userId;
            let reply = false;
            let replyComment = 'N/A';
            replyComment = findParentReply(buttonElement);
            if (replyComment != 'N/A' && replyComment != 'Not Reply') {
                reply = true;
            }
            sendTextBoxEntry({
                platform: "Reddit",
                url: location.href,
                parentPostID: getParentPostID(),
                UUID,
                startTime,
                postStartTime,
                textBoxEntry: text,
                replyID: reply ? typeID : null,
            });
        }
    });
}, 2000);
}
