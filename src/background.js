import { dynamicInjectContentScript } from "./background/dynamic-inject-content-script.js";
import config, { GLOBAL_DEFAULT_OPTIONS } from './config.js';
import { sendToDB } from './sendToDB.js';
console.log('Background script loaded');
/*global chrome*/
const submissionPageUrlStandard = "https://www.reddit.com/r/";
const submissionPageUrlNew = "https://new.reddit.com/r/";
const submissionPageUrlOld = "https://old.reddit.com/r/";
const SERVER_ENDPOINT = config.SERVER_ENDPOINT;
// src/background.js

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status === "complete" && tab.url) {
        const redditUrls = ["https://www.reddit.com/", "https://new.reddit.com/", "https://old.reddit.com/"];
        if (redditUrls.some(url => tab.url.startsWith(url))) {
            const postUUID = generatePostUUID();
            try{
                chrome.tabs.sendMessage(tabId, { 
                    action: "resetAndCollectAdData",
                    postUUID: postUUID
            });
            }
            catch(err){
                console.log(err)
            }
        }
    }
});

// function to compare the current url with the reddit comment page url
function isRedditCommentsPage(url) {
    const urlPattern = /^https?:\/\/(www|old)\.reddit\.com\/r\/[^\/]+\/comments\/[^\/]+\/.+/;
    return urlPattern.test(url);
}

/* Function to generate a universally identifying ID of user */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
}

function generatePostUUID() {
    return 'post-' + generateUUID();
}

/* Function that is called when the reddit page is loaded. It shows a popup that the
comment has been copied to the clipboard when it receives message from content.js
*/
function BackgroundFunc(message) {
    function showNotification(message) {
        // Create a container for the notification
        let container = document.createElement("div");
        container.style.cssText = `
            position: fixed;
            top: 10px;
            left: 0;
            right: 0;
            display: flex;
            justify-content: center;
            z-index: 10000;
        `;
    
        // Create the notification element
        let notification = document.createElement("div");
        notification.textContent = message;
        notification.style.cssText = `
            background-color: #BF3429;
            color: white;
            padding: 15px 30px;
            border-radius: 5px;
            font-size: 16px;
            font-weight: bold;
            box-shadow: 0px 4px 8px rgba(0,0,0,0.5);
        `;
    
        // Append the notification to the container
        container.appendChild(notification);
    
        // Append the container to the body
        document.body.appendChild(container);
    
        // Remove the notification and container after 5 seconds
        setTimeout(() => {
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }
        }, 4500);
    }
    
    showNotification(message);
}

/* sends a message to content.js to scrap the content from the webpage to
* and send a request to GPT for AI generated comment
*/
// chrome.tabs.onUpdated.addListener(function(_tabId, changeInfo, tab) {
//     if (changeInfo.status === "complete" && tab.active && tab.url) {
//         const submissionPageUrls = [submissionPageUrlStandard, submissionPageUrlNew, submissionPageUrlOld];
//         const twitterStatusRegex = /^https:\/\/x\.com\/\w+\/status\/\d+$/;
//         if (submissionPageUrls.some(url => tab.url.startsWith(url)) || twitterStatusRegex.test(tab.url)) {
//             chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
//                 try {
//                     chrome.tabs.sendMessage(tabs[0].id, ({ message: "page-load" }));
//                 }
//                 catch(err) {
//                     console.log(err);
//                 }
//             });
//         }
//     }
// });
/* message listener to receive message from content.js when the AI suggested comment
* has been generated
*/
chrome.runtime.onMessage.addListener(function (request) {
    if (request.message) {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs && tabs.length > 0) {
                const currentTab = tabs[0];
                try{
                    // Execute the textBoxEditor function in the currently active tab
                    chrome.scripting.executeScript({
                    target: { tabId: currentTab.id },
                    func: BackgroundFunc,
                        args: [request.message]
                    });
                }
                catch(err){
                    console.log(err)
                }
            }
        });
    }
});

function setupUUID() {
    const userId = generateUUID();
    const extensionSetupTime = Date.now();
    chrome.storage.sync.set({
        userId: userId, 
        extensionSetupTime: extensionSetupTime,
    });

    return [userId, extensionSetupTime];
}

// We want to update the treatment status of the user every browser reload and
// also on install. extensionSetupTime is null if the extension was not just installed
function updateTreatment(userId, extensionSetupTime) {
    console.log("updating treatment", userId, extensionSetupTime);
    fetch(config.SERVER_ENDPOINT + '/fetch_functionality', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ UUID: userId })
    })
        .then(response => response.json())
        .then(data => {
            console.log("fetch_functionality response: ", data);
            // Extract functionality and treatment from the response
            let functionality = data.functionality;
            let treatment = data.treatment;
            let autocomplete = data.autocomplete;
            let suggest = data.suggest;
            if (extensionSetupTime) {
                sendToDB({
                    UUID: userId,
                    ExtensionInstallTime: getFormattedDateTime(extensionSetupTime),
                    treatment_status: treatment,
                    table: 'Usernames'
                });
            }
            chrome.storage.sync.set({
                functionality,
                treatment,
                autocomplete,
                suggest
            }, () => {
                console.log('Functionality received:', functionality);
                console.log('Treatment received:', treatment);
            });
        })
        .catch(error => {
            console.error('Error fetching toggle data:', error);
            // Handle the error by using the default functionality (but only
            // if the extension was just installed, otherwise we trust that
            // storage sync already contains the correct functionality).
            if (extensionSetupTime) {
                let functionality = GLOBAL_DEFAULT_OPTIONS.functionality;
                let treatment = GLOBAL_DEFAULT_OPTIONS.treatment;
                let autocomplete = GLOBAL_DEFAULT_OPTIONS.autocomplete;
                let suggest = GLOBAL_DEFAULT_OPTIONS.suggest;
                sendToDB({
                    UUID: userId,
                    ExtensionInstallTime: getFormattedDateTime(extensionSetupTime),
                    treatment_status: treatment,
                    table: 'Usernames'
                });
                chrome.storage.sync.set({
                    functionality,
                    treatment,
                    autocomplete,
                    suggest
                }, () => {
                    console.log('Using default functionality:', functionality);
                    console.log('Using default treatment:', treatment);
                });
            }
        });


    // Edit From Ryan: added initialAutocompleteLoaded variable initialization
    // chrome.storage.local.set({
    //     initialAutocompleteLoaded: true,
    // }, function() {
    //     console.log('initialAutocompleteLoaded has been set');
    // });
}

/* Assigns each user a unique ID when the extension is installed */
chrome.runtime.onInstalled.addListener(async function(details) {
    if (details.reason === "install") {
        const [userId, extensionSetupTime] = setupUUID();
        updateTreatment(userId, extensionSetupTime);
    }
});

chrome.runtime.onStartup.addListener(function() {
    // chrome.storage.local.set({
    //     initialAutocompleteLoaded: true,
    // });

    chrome.storage.sync.get(['userId'], function(result) {
        if (result.userId) {
            console.log('User ID:', result.userId);
            updateTreatment(result.userId, null);
        } else {
            console.log('No user ID found');
            const [userId, extensionSetupTime] = setupUUID();
            updateTreatment(userId, extensionSetupTime);
        }
    });
});

// Listen for browser/tab reloads
// chrome.webNavigation.onCommitted.addListener(function(details) {
//     if (details.transitionType === 'reload') {
//         chrome.storage.local.set({
//             initialAutocompleteLoaded: true,
//         });
//     }
// });

function getFormattedDateTime(timestamp = Date.now()) {
    const now = new Date(timestamp);
    return now.toISOString();
}
  
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('request: ', request);
    if (request.action === "tab-close-analytics") {
        if (request.data.sessionTotalTime !== '00:00:00') {
            try{
                console.log('sending data to db');
                sendToDB(request.data);
            }
            catch(err){
                console.error(err)
            }
        }
    } else if (request.action === "fetch_twitter_data") {
        fetch(config.SERVER_ENDPOINT + '/fetch_twitter_data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username: request.username })
        })
        .then(response => {
            console.log('Response status:', response.status);
            console.log('Response headers:', response.headers);
            return response.text();
        })
        .then(text => {
            console.log('Raw response:', text);
            try {
                const data = JSON.parse(text);
                if (data.error) {
                    sendResponse({success: false, error: data.error});
                } else {
                    sendResponse({success: true, data: data});
                }
            } catch (error) {
                console.error('JSON parsing error:', error);
                sendResponse({success: false, error: `Parsing error: ${error.message}. Raw response: ${text}`});
            }
        })
        .catch(error => {
            console.error('Fetch error:', error);
            sendResponse({success: false, error: error.toString()});
        });
        return true;  // Will respond asynchronously
    }
});

dynamicInjectContentScript();
