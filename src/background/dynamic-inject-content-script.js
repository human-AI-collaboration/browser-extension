import config from "../config";

const ALLOWED_CONTENT_DOMAINS = [
  "https://www.reddit.com/r",
  "https://new.reddit.com/r",
  "https://old.reddit.com/r",
  "https://www.reddit.com",
  "https://new.reddit.com",
  "https://old.reddit.com",
  "https://www.reddit.com/",
  "https://new.reddit.com/",
  "https://old.reddit.com/"

];
const ALLOWED_TWITTER_CONTENT_DOMAINS = ["https://x.com/"];

export async function fetchToggleData() {
  const userId = await chrome.storage.sync.get('userId');
  const response = await fetch(
    `${config.SERVER_ENDPOINT}/fetch_functionality`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ UUID: userId.userId })
    }
  );
  const data = await response.json();
  return data;
}

export function dynamicInjectContentScript() {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url) {
      chrome.storage.local.get(["functionality"], (result) => {
        if (!result.functionality) {
          // Fetch from server if not already set for the session
          fetchToggleData().then((res) => {
            if (res && res.functionality) {
              chrome.storage.local.set({ functionality: res.functionality });
              applyFunctionality(res.functionality, tabId, tab.url);
            }
          });
        } else {
          // Use stored session-based functionality
          applyFunctionality(result.functionality, tabId, tab.url);
        }
      });
    }
  });

  // It used for SPA page
  // chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  //   if (details.frameId === 0) {
  //     fetchToggleData().then((res) => {
  //       if (res && res.functionality) options = res;

  //       console.log("[onHistoryStateUpdated.url]", details.url)

  //       if (options.functionality === "comment_suggestion") {
  //         injectScriptsForSuggestion(details.tabId, details.url);
  //       } else if (options.functionality === "proofread") {
  //         injectScriptsForProofread(details.tabId, details.url);
  //       }
  //     });
  //   }
  // });
}

function applyFunctionality(functionality, tabId, url) {
  if (functionality === "comment_suggestion") {
    debouncedInjectScriptsForSuggestion(tabId, url);
  } else if (functionality === "proofread") {
    debouncedInjectScriptsForProofread(tabId, url);
  }
}

function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Wrapping your inject functions with debounce
const debouncedInjectScriptsForSuggestion = debounce(injectScriptsForSuggestion, 1000);
const debouncedInjectScriptsForProofread = debounce(injectScriptsForProofread, 1000);


async function injectScriptsForSuggestion(tabId, url) {
  if (ALLOWED_CONTENT_DOMAINS.some((item) => url.startsWith(item))) {
    let options = null;
    try {
        options = await chrome.storage.sync.get(['functionality', 'treatment', 'autocomplete', 'suggest']);
    } catch (e) {
        console.error('Error fetching options:', e);
    }
    chrome.scripting
      .executeScript({
        target: { tabId: tabId },
        files: ["dist/reddit_content.bundle.js"],
      })
      .then(() => {
        chrome.tabs.sendMessage(tabId, {
          message: "page-load",
          options,
        });
      });
  } else if (
    ALLOWED_TWITTER_CONTENT_DOMAINS.some((item) => url.startsWith(item))
  ) {
    let options = null;
    try {
        options = await chrome.storage.sync.get(['functionality', 'treatment', 'autocomplete', 'suggest']);
    } catch (e) {
        console.error('Error fetching options:', e);
    }
    chrome.scripting
      .executeScript({
        target: { tabId: tabId },
        files: ["dist/twitter_content.bundle.js"],
      })
      .then(() => {
        chrome.tabs.sendMessage(tabId, {
          message: "page-load",
          options,
        });
      });
  }
}

async function injectScriptsForProofread(tabId, url) {
  if (ALLOWED_CONTENT_DOMAINS.some((item) => url.startsWith(item))) {
    let options = null;
    try {
        options = await chrome.storage.sync.get(['functionality', 'treatment', 'autocomplete', 'suggest']);
    } catch (e) {
        console.error('Error fetching options:', e);
    }
    chrome.scripting
      .executeScript({
        target: { tabId: tabId },
        files: ["dist/proofread_reddit.bundle.js"],
      })
      .then(() => {
        chrome.tabs.sendMessage(tabId, {
          message: "content-injected",
          options, // XXX: should use session storage options
        });
      });
  } else if (
    ALLOWED_TWITTER_CONTENT_DOMAINS.some((item) => url.startsWith(item))
  ) {
    let options = null;
    try {
        options = await chrome.storage.sync.get(['functionality', 'treatment', 'autocomplete', 'suggest']);
    } catch (e) {
        console.error('Error fetching options:', e);
    }
    chrome.scripting
      .executeScript({
        target: { tabId: tabId },
        files: ["dist/proofread_twitter.bundle.js"],
      })
      .then(() => {
        chrome.tabs.sendMessage(tabId, {
          message: "content-injected",
          options,
        });
      });
  }
}
