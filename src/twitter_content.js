console.log('twitter_content.js loaded');
import { sendToDB, sendPageView, sendTextBoxEntry, sendGotCompletion, sendPublishedComment, sendAcceptedAutoComplete } from "./sendToDB";
import config from './config';

import { initialCollectAndSendData as initialCollectAndSendAdData, resetPostAdData, collectAndSendData } from "./adCollector";
import { suggestAutoComplete, removeAutoCompleteSuggestion, showAutoCompleteSuggestion, getAutoCompleteSuggestion, getCaretCoordinates, getAutoCompleteData } from "./autosuggest"
if (!window.loadedstanfordextension) { // prevent double loading
window.loadedstanfordextension = true;

const imageUrlCache = new Map();

async function getTweetFromImageUrl(url) {
    // Using twitter.com and using https saves a few redirects
    url = url.replace("x.com", "twitter.com");
    url = url.replace("http://", "https://");
    if (!url.startsWith("http")) {
        url = `https://${url}`;
    }
    if (imageUrlCache.has(url)) {
        return imageUrlCache.get(url);
    }
    let endpoint = `${SERVER_ENDPOINT}/extract_status_id`;
    endpoint += `?url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        }
    });
    if (!response.ok) {
        console.error(`Getting Tweet from image URL: HTTP error! status: ${response.status}`);
        return null;
    }
    const data = await response.json();
    if (data.id && data.username) {
        const result = data.username + "/" + data.id;
        imageUrlCache.set(url, result);
        return result;
    } else {
        console.error('Error extracting status username and ID:', data.error);
        return null;
    }
}

function extractIdFromURL(url) {
    const regex = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/;
    const match = url.match(regex);

    if (match) {
        const username = match[1];
        const statusId = match[2];
        return username + "/" + statusId;
    }

    return null;
}

/* Helper function to get all of the innerText of an element excluding buttons */
function getTextExcludingButtons(element, depth = 10) {
    if (depth <= 0) {
        return '';
    }

    let text = '';

    for (let child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent;
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() !== 'button') {
            text += getTextExcludingButtons(child, depth - 1);
        }
    }

    return text;
}

async function getParentPostID() {
    // First, check if we are on a tweet page
    const url = window.location.href;
    const tweetId = extractIdFromURL(url);
    if (tweetId) {
        return tweetId;
    }

    // Second, see if we have a popup open
    if (url.includes("/compose/post")) {
        const button = document.getElementById('suggest-button');
        if (!button) {
            return null;
        }

        const container = button.closest('[role="dialog"]');
        if (!container) {
            return null;
        }
        const regex = /(?:https?:\/\/)?pic\.x\.com\/[a-zA-Z0-9]{10}/;
        const match = getTextExcludingButtons(container).match(regex);

        const firstUrl = match ? match[0] : null;

        // Check if there is an image url
        if (firstUrl) {
            return await getTweetFromImageUrl(firstUrl);
        }

        // Search through the DOM to find the tweet by date
        // const tweetText = container.querySelector('[data-testid="tweetText"]').innerText;
        const datetime = container.querySelector('time')?.getAttribute("datetime");
        if (!datetime) {
            return null;
        }
        const canditates = document.querySelectorAll(`time[datetime="${datetime}"]`);
        for (const el of canditates) {
            const parentAnchor = el.closest('a');
            if (parentAnchor) {
                // TODO: we could do some additional verifications for those rare
                // cases where more than one tweet have the same date. For example,
                // we could compare the usernames or text of the tweets.
                const id = extractIdFromURL(parentAnchor.href);
                if (id) {
                    return id;
                }
            }
        }
    }
    return null;
}

async function getPostInformation() {
    const [tweet, imageSource] = await Promise.all([setPostText(), setImageData()]);
    return { text: tweet, imageSource };
}

function collectAndSendDataCallback(adsInfo) {
    if (!postStartTime) return;

    safeStorageOperation('get', ["userId"], async function(result) {
        if (result) {
            const UUID = result.userId;
            sendPageView({
                platform: "Twitter",
                url: window.location.href,
                postInformation: getPostInformation(),
                postStartTime,
                parentPostID: getParentPostID(),
                adsInfo,
                startTime,
                UUID,
            });
        }
    });
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

const SERVER_ENDPOINT = config.SERVER_ENDPOINT;
let AUTOCOMPLETE_ENABLED = true;
let SUGGEST_BUTTON_ENABLED = true;
safeStorageOperation('get', ["autocomplete", "suggest"], function(result) {
    if (result) {
        AUTOCOMPLETE_ENABLED = result.autocomplete ?? true; // Default to true if undefined
        SUGGEST_BUTTON_ENABLED = result.suggest ?? true;    // Default to true if undefined
    }
});
let lastPageLoadTime = 0;
const PAGE_LOAD_COOLDOWN = 100; // in milliseconds
let postsOpened = 0;
let postStartTime = null;
let postStartTimeURL = null;
let UUID = null;
let startTime = Date.now();
let visibilityStartTime = startTime;
let openedPostsLinks = [];
chrome.storage.sync.get("userId", function(result) {
    UUID = result.userId
});

const initializedTextboxes = new WeakSet();

//------------------------------- TWITTER USAGE TRACKING -------------------------------------
(function() {
    let endTime;
    let lastUrl = window.location.href;

    // Reinitialize observer so suggest functionality works on home page.
    new MutationObserver(() => {
        const url = window.location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            cleanupAutocomplete(); // Edit from Ryan: setup abort autocomplete in MutationObserver
            tweetPage();  
        }
    }).observe(document, {subtree: true, childList: true});

    let clickCounter = 0;
    let scrollCounter = 0;
    let keypressCounter = 0;

    function logClick() {
        clickCounter++;
    }

    function logScrollEvent() {
        scrollCounter++;
    }

    function logKeypressEvent() {
        keypressCounter++;
    }

    document.addEventListener('click', logClick);
    window.addEventListener('scroll', logScrollEvent);
    document.addEventListener('keypress', logKeypressEvent);

    async function Time() {
        console.log('Session Ended. Calculating Time...');
        endTime = Date.now();
        
        try {
            const adsInfo = collectAndSendData();
            
            const data = {
                'UUIDxStart': UUID + '-' + visibilityStartTime, 
                'UUID': UUID, 
                'Platform': 'Twitter', 
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
            
            console.log('data: ', data);
            
            chrome.runtime.sendMessage({action: "tab-close-analytics", data: data});
            // sendToDB(data)
            console.log('sent tab-close-analytics');
        } catch (error) {
            console.error('Error in Time function:', error);
        }
        
        // Reset counters
        clickCounter = 0;
        scrollCounter = 0;
        keypressCounter = 0;
        postsOpened = 0;
        openedPostsLinks = [];
    }

    //window.addEventListener('beforeunload', calculateTime);

    document.addEventListener('visibilitychange', async function() {
        if (document.visibilityState === 'hidden') {
            await Time();
            //This remove was causing the autocomplete to not work on the next post
            //removeAutoCompleteSuggestion();
        } else {
            visibilityStartTime = Date.now();
        }
    });
})();

const observer = new MutationObserver((mutations, obs) => {
    const profileLinkElement = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (profileLinkElement) {
        var Twitterusername = profileLinkElement.href.split('/').pop();
        chrome.storage.sync.get(["userId", "extensionSetupTime"], function(result) {
            let UUID = result.userId;
            sendToDB({
                UUID: UUID,
                Twitterusername: Twitterusername,
                ExtensionInstallTime: getFormattedDateTime(result.extensionSetupTime),
                LoginTime: getFormattedDateTime(),
                table: 'Usernames'
            });
        });
        obs.disconnect();
    }
});

observer.observe(document, {
    childList: true,
    subtree: true
});

//------------------------- TWITTER USER DATA COLLECTION --------------------------------

function generateRandomId(length = 10) {
  return Math.random().toString(36).substr(2, length);
}

//------------------------------- TWITTER POST PAGE -------------------------------------

let statusAutocomplete_id = null;

function getAutocompleteID() {
    return statusAutocomplete_id;
}

function setAutocompleteID(id) {
    statusAutocomplete_id = id;
}

function findElementWithRetry(selector, interval = 100, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const check = () => {
            const element = document.querySelector(selector);
            if (element) {
                console.log("FOUND", element);
                resolve(element);
            } else if (Date.now() - startTime >= timeout) {
                resolve(null);
            } else {
                setTimeout(check, interval);
            }
        };
        check();
    });
}


async function replyButtonHandler(event) {
    // Finding the reply element can take a while, so we store some variables
    // which may change
    const cache = {
        parentPostID: getParentPostID(),
        postStartTime: postStartTime,
        startTime: startTime,
    };
    const reply = getUserReply();

    const publishedButton = await findElementWithRetry('div[data-testid="toast"][role="alert"] a');
    const publishedURL = publishedButton?.href;
    let publishedCommentID = null;
    if (publishedURL) {
        publishedCommentID = extractIdFromURL(publishedURL);
    }

    console.log("COMMENT ID", publishedCommentID);

    safeStorageOperation('get', ["userId"], function(result) {
        if (result) {
            const UUID = result.userId;
            console.log("PUBLISHING..");
            sendPublishedComment({
                platform: "Twitter",
                UUID,
                url: window.location.href,
                publishedComment: reply,
                publishedCommentID,
                ...cache,
            });
            postStartTime = Date.now(); // get a new id
            collectAndSendData(true);
        }
    });
}

async function tweetPage() {
    console.log('AUTOCOMPLETE_ENABLED: ', AUTOCOMPLETE_ENABLED);
    console.log('SUGGEST_BUTTON_ENABLED: ', SUGGEST_BUTTON_ENABLED);
    if (!openedPostsLinks.includes(window.location.href)) {
        openedPostsLinks.push(window.location.href);
        postsOpened++;
        
        const postUUID = UUID + '-' + Date.now();
        resetPostAdData(postUUID);
    }
    if (!openedPostsLinks.includes(window.location.href)) {
        openedPostsLinks.push(window.location.href);
        postsOpened++;
    }
    setTimeout(async () => {
        sendPageView({
            platform: "Twitter",
            url: window.location.href,
            postInformation: getPostInformation(),
            postStartTime,
            parentPostID: getParentPostID(),
            startTime,
            UUID,
        });

        let isSettingUpAutocomplete = false;

        function setupAutoCompleteListener() {
            if (isSettingUpAutocomplete) {
                console.log('Autocomplete setup already in progress');
                return;
            }
            isSettingUpAutocomplete = true;
            
            const editor = getEditorRoot();
            if (editor) {
                console.log('Editor: ', editor);

                const editorContent = getEditableElement(editor);
                if (!editorContent) {
                    isSettingUpAutocomplete = false;
                    return;
                }

                // Clean up previous editor state if it exists
                if (currentAbortController) {
                    currentAbortController.abort();
                    currentAbortController = null;
                }
                removeAutoCompleteSuggestion();
                setAutocompleteID(null);

                const id = generateRandomId();
                console.log("New listener ID: ", id);
                setAutocompleteID(id);


                const sendTextEntryListener = event => {
                    if (getAutocompleteID() != id) {
                        event.currentTarget.removeEventListener('input', sendTextEntryListener);
                        return;
                    }
                    if (editorContent.innerText.trim() != '') {
                        console.log('Editor content: ', editorContent.innerText);
                        sendTextBoxEntryToDB(event.target.innerText);
                    }
                }
                editorContent.addEventListener('input', sendTextEntryListener);
            
                // Cache for recent autocomplete suggestions
                const suggestionCache = new Map();
            
                // Minimum character limit before triggering autocomplete
                const MIN_CHARS = 3;
                
                // Debounce function
                const debounce = (func, delay) => {
                    let debounceTimer;
                    return function() {
                        const context = this
                        const args = arguments;
                        clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => func.apply(context, args), delay);
                    }
                }
            
                // Function to handle tab key press
                const handleTabPress = (event) => {
                    event.preventDefault();
                    let autoCompleteSuggestion = getAutoCompleteSuggestion();
                    let autoCompleteData = getAutoCompleteData();
                    if (autoCompleteSuggestion) {
                        removeAutoCompleteSuggestion();
                        injectTextCore(editor.innerText.trim() + " " + autoCompleteSuggestion.trim());
                        if (autoCompleteData) {
                            chrome.storage.sync.get("userId", function(result) {
                                const UUID = result.userId;
                                sendAcceptedAutoComplete({
                                    platform: "Twitter",
                                    parentPostID: getParentPostID(),
                                    UUID,
                                    startTime,
                                    postStartTime,
                                    url: window.location.href,
                                    acceptedSuggestion: autoCompleteData.autoCompleteSuggestion,
                                });
                            });
                        }
                    }
                };

                // Function to handle backspace and delete
                const handleDelete = () => {
                    setTimeout(() => removeAutoCompleteSuggestion(editorContent), 10);
                };

                function inputEvent(event) {
                    if (currentAbortController) {
                        currentAbortController.abort();
                        currentAbortController = null;
                    }
                    triggerAutocomplete(event, event.currentTarget);
                }
            
                // Function to trigger autocomplete
                const triggerAutocomplete = debounce(async (event, currentTarget) => {
                    if (getAutocompleteID() != id) {
                        console.log("Deregistering event listener (triggerAutocomplete).");
                        currentTarget.removeEventListener('input', inputEvent);
                        return;
                    }
                    // if (statusAutocomplete.lastTrigger > Date.now() - 999) {
                    //     console.log("Avoiding duplicate event (triggerAutocomplete)");
                    //     return;
                    // }
                    // console.log("Autocomplete triggered");
                    // statusAutocomplete.lastTrigger = Date.now();
                    let userTypedComment = editor.innerText;
            
                    if (userTypedComment.length < MIN_CHARS || userTypedComment.toLowerCase().trim() === 'post your reply') {
                        removeAutoCompleteSuggestion(editorContent);
                        return;
                    }
            
                    if (getCaretCoordinates(editorContent).remainingText !== '') {
                        removeAutoCompleteSuggestion(editorContent);
                        return;
                    }
            
                    // Check cache first
                    if (suggestionCache.has(userTypedComment)) {
                        showAutoCompleteSuggestion(suggestionCache.get(userTypedComment), editorContent, true);
                        return;
                    }
            
                    // Edit from Ryan: added autocomplete cancel functionality
                    // Cancel any existing request
                    if (currentAbortController) {
                        currentAbortController.abort();
                    }
            
                    // Create new abort controller for this request
                    currentAbortController = new AbortController();
            
                    try {
                        // console.log("Autocomplete request started");
                        // console.time("twitterautocomplete");
                        // Execute concurrently.
                        const [tweet, imageSource] = await Promise.all([setPostText(), setImageData()]);

                        // console.log("Submitting autocomplete request");
                        // console.timeLog("twitterautocomplete");

                        showSpinner(true);
                        let {autoCompleteSuggestion, prompt, prompt_category} = await suggestAutoComplete(
                            '', 
                            tweet, 
                            userTypedComment, 
                            imageSource, 
                            "twitter",
                            currentAbortController.signal
                        );

                        // console.log("Received response to autocomplete request");
                        // console.timeEnd("twitterautocomplete");

                        if (getAutocompleteID() != id) {
                            // console.log("Deregistering event listener (triggerAutocomplete).", { trueId: statusAutocomplete.id, myId: id });
                            console.log("Deregistering event listener (triggerAutocomplete).");
                            currentTarget.removeEventListener('input', inputEvent);
                            return;
                        }
            
                        const userReply = getUserReply();
                        // Only show suggestion if we haven't been aborted
                        if (autoCompleteSuggestion) {
                            showAutoCompleteSuggestion(autoCompleteSuggestion, editorContent, true, false,
                                { userReply, autoCompleteSuggestion });
                            suggestionCache.set(userTypedComment, autoCompleteSuggestion);
                        }
            
                        // Send analytics only if we haven't been aborted
                        chrome.storage.sync.get("userId", function(result) {
                            const UUID = result.userId;
                            sendGotCompletion({
                                platform: "Twitter",
                                parentPostID: getParentPostID(),
                                UUID,
                                startTime,
                                postStartTime,
                                url: window.location.href,
                                suggestion: autoCompleteSuggestion,
                                userTyped: userReply ? userReply : 'N/A',
                                parentText: tweet,
                                prompt,
                                promptCategory: prompt_category,
                                completionType: "autocomplete",
                            });
                        });
                    } catch (error) {
                        // If this was an abort, just ignore it
                        if (error.name === 'AbortError') {
                            console.log('Autocomplete request was cancelled');
                            hideSpinner(true);
                            return;
                        } else if (error === "suggest") {
                            console.log('Autocomplete request aborted: suggest');
                            return;
                        }
                        hideSpinner(true);
                        console.error('Error in autocomplete:', error);
                    } finally {
                        currentAbortController = null;
                        hideSpinner(true);
                    }
                }, 500);


                // Function to handle blur event
                const handleBlur = event => {
                    if (getAutocompleteID() != id) {
                        event.currentTarget.removeEventListener('blur', handleBlur);
                        return;
                    }
                    removeAutoCompleteSuggestion(editorContent);
                };

                const keydownEvent = event => {
                    if (getAutocompleteID() != id) {
                        event.currentTarget.removeEventListener('keydown', keydownEvent);
                        return;
                    }
                    if (event.key === 'Tab') handleTabPress(event);
                    
                    // Note from Ryan: 
                    // Problem: The suggestion would stay even when the user typed something new
                    // Original code: else if (event.key === 'Backspace' || event.key === 'Delete')
                    // New code: else
                    // new code solves this issue by removing the suggestion whenever the user types something
                    else handleDelete();
                }
            
                // Add event listeners
                editorContent.addEventListener('keydown', keydownEvent);
                editorContent.addEventListener('input', inputEvent);
                editorContent.addEventListener('blur', handleBlur);

                // Note from Ryan: add textbox to hashset 
                initializedTextboxes.add(editorContent);
            }
            isSettingUpAutocomplete = false;
        }

        // Adds the suggest button (and autocomplete) whenever a reply composer
        // appears without one. X re-renders the composer often, so this runs
        // from a MutationObserver rather than once.
        let autocompleteEditor = null;
        function setupComposer() {
            const replyButton = findReplyButton();
            if (!replyButton || !isReplyComposer(replyButton)) return;

            // X moves Reply when the composer expands on focus, so an existing
            // Suggest button follows it rather than being re-created.
            let suggestButton = document.getElementById('suggest-button');
            if (suggestButton) {
                placeSuggestButton(suggestButton, replyButton);
            } else {
                console.log("Reply button", replyButton);
                suggestButton = createSuggestButton(replyButton);
                if (SUGGEST_BUTTON_ENABLED) {
                    suggestButton.addEventListener('click', function() {
                        getReply();
                    });
                }
            }
            if (SUGGEST_BUTTON_ENABLED && !hookedReplyButtons.has(replyButton)) {
                hookedReplyButtons.add(replyButton);
                replyButton.addEventListener('click', replyButtonHandler);
            }
            // Re-attach autocomplete if X swapped in a new editor
            const editor = getEditorRoot();
            if (AUTOCOMPLETE_ENABLED && editor && editor !== autocompleteEditor) {
                autocompleteEditor = editor;
                console.log("Setting up autocomplete");
                setupAutoCompleteListener();
            }
        }

        // Throttled rather than debounced: X mutates the DOM constantly, so a
        // debounce might never fire.
        let composerCheckPending = false;
        composerObserver?.disconnect();
        composerObserver = new MutationObserver(() => {
            if (composerCheckPending) return;
            composerCheckPending = true;
            setTimeout(() => {
                composerCheckPending = false;
                setupComposer();
            }, 200);
        });
        composerObserver.observe(document.body, { childList: true, subtree: true });
        setupComposer();

    }, 0);
}

function handlePageLoad() {
    const currentTime = Date.now();
    if (currentTime - lastPageLoadTime < PAGE_LOAD_COOLDOWN) {
        console.log("Page load handled recently. Skipping...");
        return;
    }
    lastPageLoadTime = currentTime;
    tweetPage();
}

// Listener to call for Script run when the status page opens
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.message === "page-load") {
        if (message.options) {
            AUTOCOMPLETE_ENABLED = message.options.autocomplete ?? true; // Default to true if undefined
            SUGGEST_BUTTON_ENABLED = message.options.suggest ?? true;    // Default to true if undefined
        }

        if (document.getElementById('suggest-button') == null && postStartTimeURL != window.location.href) {
            console.log("Updating postStartTime from: ", postStartTimeURL, " to: ", window.location.href);
            postStartTimeURL = window.location.href;
            postStartTime = Date.now();
            handlePageLoad();
            initialCollectAndSendAdData(collectAndSendDataCallback, "twitter");
        }
    }
});

// ---------------------------- helper Functions -------------------------------------

class SpinnerManager {
    constructor() {
        this.autoCompleteSpinner = null;
        this.suggestSpinner = null;
        this.suggestContent = null;
    }

    initialize() {
        this.autoCompleteSpinner = document.querySelector(".custom-spinner");
        if (document.getElementById('suggest-button')) {
            this.suggestSpinner = document.querySelector(`#suggest-button .dot-flashing`);
            this.suggestContent = document.querySelector(`#suggest-button .suggest-button-label`);
        }
    }

    showAutoComplete() {
        if (this.autoCompleteSpinner) {
            this.autoCompleteSpinner.style.display = '';
        }
    }

    hideAutoComplete() {
        if (this.autoCompleteSpinner) {
            this.autoCompleteSpinner.style.display = 'none';
        }
    }

    showSuggest() {
        if (this.suggestSpinner && this.suggestContent) {
            this.suggestSpinner.style.display = 'inline-block';
            this.suggestContent.style.opacity = '0';
        }
    }

    hideSuggest() {
        if (this.suggestSpinner && this.suggestContent) {
            this.suggestSpinner.style.display = 'none';
            this.suggestContent.style.opacity = '1';
        }
    }

    show(is_autocomplete) {
        if (is_autocomplete) {
            this.hideSuggest();
            this.showAutoComplete();
        } else {
            this.showSuggest();
            this.hideAutoComplete();
        }
    }

    hide(is_autocomplete) {
        if (is_autocomplete) {
            this.hideAutoComplete();
        } else {
            this.hideSuggest();
        }
    }
}

const spinnerManager = new SpinnerManager();

// X's generated css-/r- class names change with every deploy, so everything
// below is located through data-testid attributes instead.
const REPLY_BUTTON_SELECTOR = '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]';

// Prefer the composer in an open dialog (the reply popup) over the inline one.
function findInComposer(selector) {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog?.querySelector(selector) || document.querySelector(selector);
}

function findReplyButton() {
    return findInComposer(REPLY_BUTTON_SELECTOR);
}

// The same buttons are used for new posts, which shouldn't get a suggest button.
function isReplyComposer(replyButton) {
    return /\/status\/\d+/.test(window.location.pathname) || /reply/i.test(replyButton.innerText);
}

// X's reply box: the Draft.js root on builds that still use it, otherwise the textarea itself.
function getEditorRoot() {
    return findInComposer('.DraftEditor-root, [data-testid="tweetTextarea_0"]');
}

function getEditableElement(editor) {
    return editor.matches('[contenteditable="true"]') ? editor : editor.querySelector('[contenteditable="true"]');
}

// Puts Suggest (and the autocomplete spinner) just left of Reply. X's divs are
// column flexboxes by default and Reply is usually wrapped, so climb to the
// child of the horizontal toolbar row; inserting next to Reply itself would
// stack Suggest above it.
function placeSuggestButton(button, replyButton) {
    let anchor = replyButton;
    for (let i = 0; i < 4 && anchor.parentElement; i++) {
        const parentStyle = getComputedStyle(anchor.parentElement);
        if (parentStyle.display.includes('flex') && parentStyle.flexDirection === 'row') break;
        anchor = anchor.parentElement;
    }
    if (getComputedStyle(anchor.parentElement).flexDirection !== 'row') {
        anchor = replyButton;
    }
    if (button.nextElementSibling === anchor) return;
    anchor.insertAdjacentElement('beforebegin', button);
    if (button.autocompleteSpinner) {
        button.insertAdjacentElement('beforebegin', button.autocompleteSpinner);
    }
}

function createSuggestButton(replyButton) {
    console.log('Creating suggest button')
    // Clone X's Reply button so we match its current look (theme, size, font)
    // without hard-coding X's class names, which change with every deploy.
    // React doesn't attach handlers to the clone, so clicks only run ours.
    let button = replyButton.cloneNode(true);
    button.id = 'suggest-button';
    button.setAttribute('data-testid', 'suggestButtonInline');
    button.removeAttribute('disabled');
    button.removeAttribute('aria-disabled');
    button.setAttribute('type', 'button');
    // Reply is dimmed and unclickable while the box is empty; Suggest isn't
    button.style.opacity = '1';
    button.style.pointerEvents = 'auto';
    button.style.cursor = 'pointer';
    button.style.marginRight = '12px';

    // Swap the label text, keeping X's span styling
    let textSpan = [...button.querySelectorAll('span')].find(s => !s.children.length && s.textContent.trim());
    if (!textSpan) {
        textSpan = document.createElement('span');
        button.appendChild(textSpan);
    }
    textSpan.textContent = 'Suggest';
    textSpan.classList.add('suggest-button-label');

    const style = document.getElementById('suggest-button-style') || document.createElement('style');
    style.id = 'suggest-button-style';
    style.textContent = `
        @keyframes dotFlashing {
            0% { opacity: 0; }
            50%, 100% { opacity: 1; }
        }

        .dot-flashing {
            display: inline-block;
            position: relative;
            width: 0.8em; /* Reduced size */
            height: 0.8em; /* Reduced size */
            margin: auto; /* Center the loader within the button */
        }

        .dot-flashing::before, .dot-flashing::after {
            content: '';
            display: inline-block;
            position: absolute;
            top: 0;
            width: 0.8em; /* Reduced size */
            height: 0.8em; /* Reduced size */
            border-radius: 50%;
            background-color: currentColor;
            animation: dotFlashing 0.5s infinite linear alternate; /* Made faster */
        }

        .dot-flashing::before {
            left: -1.2em; /* Adjusted for reduced size */
        }

        .dot-flashing::after {
            left: 1.2em; /* Adjusted for reduced size */
        }

        .dot-flashing div {
            position: absolute;
            width: 0.8em; /* Reduced size */
            height: 0.8em; /* Reduced size */
            border-radius: 50%;
            background-color: currentColor;
            animation: dotFlashing 0.5s infinite linear alternate; /* Made faster */
            animation-delay: 0.25s; /* Adjusted for faster animation */
        }
        .custom-spinner {
            width: 20px;
            height: 20px;
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

    const divDotFlashing = document.createElement('div');
    divDotFlashing.className = 'dot-flashing';
    divDotFlashing.setAttribute('role', 'status');
    const divDot = document.createElement('div');
    divDotFlashing.appendChild(divDot);
    divDotFlashing.style.display = 'none';
    // Center the loader within the button
    const divLoaderWrapper = document.createElement('div');
    divLoaderWrapper.style.display = 'flex';
    divLoaderWrapper.style.justifyContent = 'center';
    divLoaderWrapper.style.alignItems = 'center';
    divLoaderWrapper.style.position = 'absolute';
    divLoaderWrapper.style.width = '100%';
    divLoaderWrapper.style.height = '100%';
    divLoaderWrapper.style.inset = '0';
    divLoaderWrapper.appendChild(divDotFlashing);
    button.appendChild(divLoaderWrapper);

    // Append spans to button
    button.style.position = 'relative';

    const spinner = document.createElement('div');
    spinner.className = 'custom-spinner'; // items-center justify-center button inline-flex';
    spinner.setAttribute("slot", "cancel-button");
    spinner.style.position = 'relative';
    spinner.style.marginRight = '10px';
    spinner.style.display = 'none'; // Initially hidden

    if (!SUGGEST_BUTTON_ENABLED) {
        button.style.display = 'none';
    }

    button.autocompleteSpinner = spinner;
    placeSuggestButton(button, replyButton);

    // Loading dots use the label's text colour so they show on either theme
    divLoaderWrapper.style.color = getComputedStyle(textSpan).color;

    spinnerManager.initialize();
    return button;
}


// Replace the old spinner functions with the new manager
function showSpinner(is_autocomplete) {
    spinnerManager.show(is_autocomplete);
}

function hideSpinner(is_autocomplete) {
    spinnerManager.hide(is_autocomplete);
}

function cleanTweet(tweet) {
    // Split the tweet into lines
    const lines = tweet.split('\n');
    
    // Find the line with the period (·)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === '·') {
        // Extract everything before the period (·)
        return lines.slice(0, i).join('\n');
      }
    }
    
    // Return the original tweet if no period is found
    return tweet;
  }

async function setPostText() {
    const startTimeForPostText = Date.now();
    const maxDurationForPostText = 3 * 1000; // 3 seconds
    const attemptIntervalForPostText = 100; // milliseconds

    const attempt = () => {
        const tweetArticle = document.querySelector("article[tabindex='-1']");
        if (tweetArticle) {
            const postElement = tweetArticle.querySelector("div[data-testid=tweetText]");
            if (postElement) {
                return postElement.innerText;
            } else {
                return "";
            }
        }
        if (Date.now() - startTimeForPostText > maxDurationForPostText) {
            return "";
        }
        return null;
    }

    const firstAttempt = attempt();

    if (firstAttempt != null) {
        return firstAttempt;
    }
    
    return await new Promise((resolve, reject) => {
        const findPostTextTimer = setInterval(() => {
            const result = attempt();
            if (result != null) {
                clearInterval(findPostTextTimer);
                resolve(result);
            }
        }, attemptIntervalForPostText);
    });
}

async function setImageData() {
    const startTimeForImage = Date.now();
    const maxDurationForImage = 1 * 1000; // 1 second
    const attemptIntervalForImage = 100; // milliseconds

    const attempt = () => {
        const tweetArticle = document.querySelector("article[tabindex='-1']");
        if (tweetArticle) {
            const imageElement = tweetArticle.querySelector('img[alt="Image"]');
            if (imageElement) {
                return imageElement.src;
            }
            if (Date.now() - startTimeForImage > maxDurationForImage) {
                return 'N/A';
            }
        }
        return null;
    };

    const firstAttempt = attempt();

    if (firstAttempt != null) {
        return firstAttempt;
    }

    // Temporary change to avoid retries (which slow down the process)
    return 'N/A';
    
    return await new Promise((resolve, reject) => {
        const findImageTimer = setInterval(() => {
            const result = attempt();
            if (result != null) {
                clearInterval(findImageTimer);
                resolve(result);
            }
        }, attemptIntervalForImage);
    });
}


const getReply = async () => {
    // Abort any pending autocomplete requests
    if (currentAbortController) {
        currentAbortController.abort("suggest");
        currentAbortController = null;
    }

    try {
        showSpinner(false);
        const [tweet, postLink] = await Promise.all([setPostText(), setImageData()]);
        let userReply = getUserReply();
        if (userReply === 'N/A') {
            userReply = '';
        }
        const flaskResult = await postCommentToFlask('This is a tweet made by a user. Restrict comment to 250 characters MAX', tweet? tweet : '', postLink, userReply);
        if (!flaskResult) {
            console.error('No suggestion received from server');
            return;
        }
        let {message,prompt,prompt_category} = flaskResult;
        message = message ? message : '';
        console.log('Message: ', message);

        injectTextCore((userReply + " " + message.trim()).trim());
        chrome.storage.sync.get("userId", function(result) {
            const UUID = result.userId;
            sendGotCompletion({
                platform: "Twitter",
                parentPostID: getParentPostID(),
                UUID,
                startTime,
                postStartTime,
                url: window.location.href,
                suggestion: message,
                userTyped: userReply ? userReply : 'N/A',
                parentText: tweet,
                prompt,
                promptCategory: prompt_category,
                completionType: "suggest",
            });
        });
    } catch (error) {
        console.error('Error in getReply:', error);
    } finally {
        hideSpinner(false);
    }

}

function injectTextCore(message) {
    const event = new CustomEvent("draft-js-twitter-content-update", {
        detail: {
            content: message,
        }
    });
    document.head.dispatchEvent(event);
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



async function postCommentToFlask(title, text, imageSource, writtenText) {
    const flaskEndpoint = `${SERVER_ENDPOINT}/get_comment`; // Change this to your Flask server URL
    let context = false;
    if (writtenText != '') {
        context = true;
    }
    const { selectedLength, selectedTone, selectedHumor, instructions, sampleComments, treatment } = await getStorageData(['selectedLength', 'selectedTone', 'selectedHumor', 'instructions', 'sampleComments', 'treatment']);
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
        imageSource: imageSource, //image source has been disabled since it is not working
        twitter: 'true',
        treatment
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
            //console.error(`HTTP error! status: ${response.status}`);
            if (response.status === 429) {
                let errorMessageList = [
                'You\'re clicking faster than we can keep up! Time for a quick one-minute coffee break.', 
                'You\'re doing great, but let\'s pace ourselves! Take a minute, then hit it again!', 
                'Whoa, turbo! Let\'s put a one-minute pause on that enthusiasm!',
                'Wow, you\'re speedy! Let\'s take a short 60-second timeout for a stretch.', 
                'You\'re on a roll, but even superheroes need a quick break! See you in a minute.', 
                'Racing through, aren\'t we? Let\'s hit the brakes for just a minute and resume shortly.',
                'You\'re setting records with those clicks! Time to catch our breath for a minute.'
                ]
                let randomIndex = Math.floor(Math.random() * errorMessageList.length);
                chrome.runtime.sendMessage({ message: errorMessageList[randomIndex]}); // shows a popup
            }
            return null;
            
        }

        const responseData = await response.json();
        if (responseData.error) {
            //console.error('Error from Flask server:', responseData.error);
            return null;
        }
        console.log('Response from Flask server:', responseData);
        return {
            message:responseData.comment,
            prompt:responseData.prompt,
            prompt_category:responseData.prompt_category
        };
    } catch (error) {
        //console.error('Error making request to Flask server:', error);
        return null;
    }
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

function getUserReply() {
    // innerText includes the "Post your reply" placeholder when the box is empty
    const reply = getEditorRoot()?.innerText.trim() ?? '';
    if (!reply || reply.toLowerCase() === 'post your reply') {
        return 'N/A';
    }
    return reply;
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
const sendTextBoxEntryToDB = debounce((text) => {
    chrome.storage.sync.get("userId", function(result) {
        const UUID = result.userId;
        sendTextBoxEntry({
            platform: "Twitter",
            parentPostID: getParentPostID(),
            url: window.location.href,
            UUID,
            startTime,
            postStartTime,
            textBoxEntry: text,
        });
    });
}, 2000);


// Edit from Ryan: autocomplete abort logic
let currentAbortController = null;

// Watches for the reply composer; replaced on each tweetPage() so only one runs
let composerObserver = null;
// Reply buttons we've already attached replyButtonHandler to
const hookedReplyButtons = new WeakSet();

// Add cleanup when leaving a tweet
function cleanupAutocomplete() {
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }
    removeAutoCompleteSuggestion();
}

// Function to handle initial installation data collection
async function handleInitialInstall() {
    try {
        const userId = await new Promise((resolve) => {
            chrome.storage.sync.get("userId", (result) => {
                resolve(result.userId);
            });
        });

        if (!userId) {
            console.warn('No userId found for initial Twitter data collection');
            return;
        }

        const username = await getCurrentTwitterUsername();
        if (!username) {
            console.warn('Could not determine Twitter username');
            return;
        }

        // Update installation timestamp
        chrome.storage.sync.set({
            "twitterInstallTime": Date.now()
        });
    } catch (error) {
        console.error('Error in initial Twitter history collection:', error);
    }
}

// Function to get current Twitter username
async function getCurrentTwitterUsername() {
    // Look for username in profile link using the data-testid attribute
    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
        return profileLink.href.split('/').pop();
    }
    return null;
}

// Check installation status and collect data if needed
chrome.storage.sync.get(["twitterInstallTime"], function(result) {
    if (!result.twitterInstallTime) {
        handleInitialInstall();
    }
});

} else {
    console.log("Was already loaded!");
}

