import {
  showAutoCompleteSuggestion,
  removeAutoCompleteSuggestion,
  getAutoCompleteSuggestion,
} from "../autosuggest";
import config, { GLOBAL_DEFAULT_OPTIONS } from "../config";
import { sendToDB } from "../sendToDB";
import { debounce } from "./utils";

// When deployed, replace it with real server api prefix
const API_PREFIX = config.SERVER_ENDPOINT;

const oldRedditPattern = /^https:\/\/old\.reddit\.com\/.*$/;
const newRedditPattern = /^https:\/\/new\.reddit\.com\/.*$/;
const redditPattern = /^https:\/\/www\.reddit\.com\/.*$/;

const url = location.href;

let editorWrapper = null;
let editor = null;
let checkGrammarButton = null;
// let hasBeenSetup = false;

let globalOptions = GLOBAL_DEFAULT_OPTIONS;

let isInAutoSuggestionChanged = false;

const showSpinnerForNewViewButton = (buttonId) => {
  if (buttonId.includes("NewView")) {
    document
      .querySelector(`#${buttonId} [slot="spinner"]`)
      .classList.remove("hidden");
    document.querySelector(`#${buttonId} [slot="content"]`).style.opacity = "0";
    const btn = document.querySelector(`#${buttonId}`);
    if (btn) {
        btn.disabled = true;
        btn.classList.remove("cursor-pointer");
        btn.classList.add("cursor-wait");
    }
    return;
  }

  const loader = document.querySelector(`#${buttonId} .dot-flashing`);
  const divInner = document.querySelector(`#${buttonId} span[slot='text']`);

  if (loader) loader.style.display = "inline-block";
  if (divInner) divInner.style.opacity = "0";
};

const hideSpinnerForNewViewButton = (buttonId) => {
  if (buttonId.includes("NewView")) {
    document
      .querySelector(`#${buttonId} [slot="spinner"]`)
      .classList.add("hidden");
    document.querySelector(`#${buttonId} [slot="content"]`).style.opacity = "1";
    return;
  }
  const loader = document.querySelector(`#${buttonId} .dot-flashing`);
  const divInner = document.querySelector(`#${buttonId} span[slot='text']`);

  if (loader) loader.style.display = "none";
  if (divInner) divInner.style.opacity = "1";
};

const fetchGrammarData = async (currentComment) => {
  try {
    const response = await fetch(`${API_PREFIX}/check_spelling`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: currentComment }),
    });

    const responseData = await response.json();
    if (responseData.error) {
      return currentComment;
    }

    return responseData;
  } catch (e) {
    return currentComment;
  }
};

const handleKeydown = (event) => {
  const keycode = event.key.toLowerCase();
  if (keycode === "escape") {
    event.stopPropagation();
    editor.focus();
  }

  if (keycode === "tab") {
    event.stopPropagation();
    event.preventDefault();

    isInAutoSuggestionChanged = true;

    const correctText = getAutoCompleteSuggestion();
    if (correctText) {
      injectTextCore(correctText);
      removeAutoCompleteSuggestion(editor);
      return;
    }
  } else {
    isInAutoSuggestionChanged = false;

    removeAutoCompleteSuggestion(editor);
  }
};

const handleInput = debounce((event) => {
  if (!isInAutoSuggestionChanged) {
    checkGrammar(true);
  }
}, 1000);

if (!window.hasProofreadScriptExecuted) {
  window.hasProofreadScriptExecuted = true;

  chrome.runtime.onMessage.addListener(function (data, sender, sendResponse) {
    if (data.message === "content-injected") {
      if (data.options) globalOptions = data.options;

      if (redditPattern.test(url)) {
        setupInRedditPattern();
      } else if (newRedditPattern.test(url)) {
        // It seems the new domain also swap the editor into the www reddit domain
        setupInRedditPattern();
      } else if (oldRedditPattern.test(url)) {
        setupInOldRedditPattern();
      }
    }
  });
}

function setupInRedditPattern() {
  const setupEditor = () => {
    editor = editorWrapper.querySelector('div[contenteditable="true"]');
    if (!editor) return;

    editor.addEventListener("keydown", handleKeydown);

    if (globalOptions.autocomplete) {
      editor.addEventListener("input", handleInput);
    }

    if (globalOptions.suggest) {
      const previousButton = editorWrapper.querySelector(
        '[id^="CheckGrammarNewView"]'
      );
      if (!previousButton) {
        checkGrammarButton = createCheckGrammarButton();
        editorWrapper.appendChild(checkGrammarButton);

        checkGrammarButton.addEventListener("click", () => checkGrammar(false));
      }
    }
  };

  const initializeCommentBox = () => {
    editorWrapper = document.querySelector("shreddit-composer");
    if (
      editorWrapper &&
      editorWrapper.querySelector('div[contenteditable="true"]')
    ) {
      setupEditor();
      return true;
    }
    return false;
  };

  const observer = new MutationObserver((mutations, obs) => {
    if (initializeCommentBox()) {
      obs.disconnect();
    }
  });

  if (!initializeCommentBox()) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
}

function setupInNewRedditPattern() {
  const setupEditor = (editorPanel) => {
    const previousButton = document.querySelector(
      '[id^="CheckGrammarOldView"]'
    );
    if (!previousButton) {
      const checkGrammarButtonWrapper = createCheckGrammarButtonOldView();
      checkGrammarButton = checkGrammarButtonWrapper.querySelector("button");
      editorPanel.appendChild(checkGrammarButtonWrapper);

      const draftEditor = editorWrapper.querySelector(".DraftEditor-root");
      draftEditor.id =
        "DraftEditor" + checkGrammarButton.id.split("CheckGrammarOldView")[1];

      checkGrammarButton.addEventListener("click", () => checkGrammar(false));
    }

    // hasBeenSetup = true;
  };

  const initializeCommentBox = () => {
    editorWrapper = document.querySelector("._3MknXZVbkWU8JL9XGlzASi");
    editor = editorWrapper.querySelector(".public-DraftEditor-content");
    const editorPanel =
      document.querySelector('div[class*="_17TqawK"][class*="RQTXfVRn"]') ||
      document.querySelector('div[class*="_17TqawK"]') ||
      document.querySelector('div[class*="RQTXfVRn"]');

    if (editor && editorPanel) {
      setupEditor(editorPanel);
      return true;
    }
    return false;
  };

  const observer = new MutationObserver((mutations, obs) => {
    if (initializeCommentBox()) {
      obs.disconnect();
    }
  });

  if (!initializeCommentBox()) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
}

function setupInOldRedditPattern() {
  const setupEditor = (editorPanel) => {
    const previousButton = document.querySelector(
      '[id^="CheckGrammarOldRedditView"]'
    );

    editorWrapper = document.querySelector(".usertext-edit");
    editor = editorWrapper.querySelector(".md textarea");

    editor.addEventListener("keydown", handleKeydown);

    if (globalOptions.autocomplete) {
      editor.addEventListener("input", handleInput);
    }

    if (!previousButton && globalOptions.suggest) {
      checkGrammarButton = createButtonWithOldRedditView();
      editorPanel.appendChild(checkGrammarButton);

      checkGrammarButton.addEventListener("click", () => checkGrammar(false));
    }

    // hasBeenSetup = true;
  };

  const initializeCommentBox = () => {
    const editorPanel = document.querySelector(".usertext-buttons");

    if (editorPanel) {
      setupEditor(editorPanel);
      return true;
    }
    return false;
  };

  const observer = new MutationObserver((mutations, obs) => {
    if (initializeCommentBox()) {
      obs.disconnect();
    }
  });

  if (!initializeCommentBox()) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
}

function createCheckGrammarButton() {
  const button = document.createElement("button");
  button.id = "CheckGrammarNewView" + Math.floor(Math.random() * 1000000);
  button.setAttribute("rpl", "");
  button.className =
    "relative button-small px-[var(--rem10)] button-primary items-center justify-center button inline-flex cursor-pointer";
  button.setAttribute("slot", "submit-button");
  button.setAttribute("type", "button");

  const spanOuter = document.createElement("span");
  spanOuter.className = "flex items-center justify-center";

  const spanInner = document.createElement("span");
  spanInner.className = "flex items-center gap-xs";

  const spanBlock = document.createElement("span");
  spanBlock.className = "block relative";

  const spanContent = document.createElement("span");
  spanContent.setAttribute("slot", "content");
  spanContent.style.opacity = "1";
  spanContent.textContent = "Proofread";

  const spanSpinner = document.createElement("span");
  spanSpinner.setAttribute("slot", "spinner");
  spanSpinner.className =
    "absolute inset-0 flex justify-center items-center hidden";
  spanSpinner.setAttribute("aria-hidden", "true ");

  const iconLoad = document.createElement("icon-load");
  iconLoad.setAttribute("size", "md");
  iconLoad.className = "animate-spin leading-[0] absolute";

  spanSpinner.appendChild(iconLoad);
  spanBlock.appendChild(spanContent);
  spanBlock.appendChild(spanSpinner);
  spanInner.appendChild(spanBlock);
  spanOuter.appendChild(spanInner);
  button.appendChild(spanOuter);
  return button;
}

function createCheckGrammarButtonOldView() {
  const divWrapper = document.createElement("div");
  divWrapper.className = "_3SNMf5ZJL_5F1qxcZkD0Cp";
  divWrapper.style.maxWidth = "50%";
  divWrapper.style.maxWidth = "90px";

  const button = document.createElement("button");
  button.id = "CheckGrammarOldView" + Math.floor(Math.random() * 1000000);
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.setAttribute("type", "button");
  button.className =
    "_22S4OsoDdOqiM-hPTeOURa _2iuoyPiKHN3kfOoeIQalDT _10BQ7pjWbeYP63SAPNS8Ts _3uJP0daPEH2plzVEYyTdaH";
  button.style.width = "70%";

  const spanText = document.createElement("span");
  spanText.textContent = "Proofread";
  spanText.setAttribute("slot", "text");
  spanText.style.opacity = "1";

  const style = document.createElement("style");
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

  const divDotFlashing = document.createElement("div");
  divDotFlashing.className = "dot-flashing";
  divDotFlashing.setAttribute("role", "status");
  const divDot = document.createElement("div");
  const spanSrOnly = document.createElement("span");
  spanSrOnly.className = "sr-only";
  spanSrOnly.textContent = "Loading...";
  divDotFlashing.appendChild(divDot);
  divDotFlashing.appendChild(spanSrOnly);
  divDotFlashing.style.display = "none";

  const divLoaderWrapper = document.createElement("div");
  divLoaderWrapper.style.display = "flex";
  divLoaderWrapper.style.justifyContent = "center";
  divLoaderWrapper.style.alignItems = "center";
  divLoaderWrapper.style.position = "absolute";
  divLoaderWrapper.style.width = "100%";
  divLoaderWrapper.style.height = "100%";
  divLoaderWrapper.style.top = "0";
  divLoaderWrapper.appendChild(divDotFlashing);

  button.appendChild(spanText);
  button.appendChild(divLoaderWrapper);

  divWrapper.appendChild(button);

  return divWrapper;
}

function createButtonWithOldRedditView() {
  const button = document.createElement("button");
  button.id = "CheckGrammarOldRedditView" + Math.floor(Math.random() * 1000000);
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.setAttribute("type", "button");
  button.classList.add("save");
  button.classList.add("disable-hover");

  const spanText = document.createElement("span");
  spanText.textContent = "Proofread";
  spanText.setAttribute("slot", "text");
  spanText.style.opacity = "1";

  const style = document.createElement("style");
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

  const divDotFlashing = document.createElement("div");
  divDotFlashing.className = "dot-flashing";
  divDotFlashing.setAttribute("role", "status");
  const divDot = document.createElement("div");
  divDotFlashing.appendChild(divDot);
  divDotFlashing.style.display = "none";

  const divLoaderWrapper = document.createElement("div");
  divLoaderWrapper.style.display = "flex";
  divLoaderWrapper.style.justifyContent = "center";
  divLoaderWrapper.style.alignItems = "center";
  divLoaderWrapper.style.position = "absolute";
  divLoaderWrapper.style.width = "100%";
  divLoaderWrapper.style.height = "100%";
  divLoaderWrapper.style.inset = "0";
  divLoaderWrapper.appendChild(divDotFlashing);

  button.appendChild(spanText);
  button.style.position = "relative";
  button.appendChild(divLoaderWrapper);

  return button;
}
function getUsername() {
  const selectors = [
      "#user-drawer-content > ul:nth-child(1) > faceplate-tracker:nth-child(1) > li > a > span.flex.items-center.gap-xs.min-w-0.shrink > span.flex.flex-col.justify-center.min-w-0.shrink.py-\\[var\\(--rem6\\)\\] > span.text-12.text-secondary-weak",
      '.user',
      '._2BMnTatQ5gjKGK5OWROgaG'
  ];
  for (let selector of selectors) {
      let element = document.querySelector(selector);
      if (element) return element.textContent;
  }
  return null;
}

function cleanUsername(username) {
  if (!username) return '';
  username = username.startsWith('u/') ? username.substring(2) : username;
  const match = username.match(/^[\w-]+/);
  return match ? match[0] : '';
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

function getFormattedDateTime(timestamp = Date.now()) {
    const now = new Date(timestamp);
    return now.toISOString();
}


async function checkGrammar(isShownAutoSuggestion = false) {
  const currentComment =
    (oldRedditPattern.test(url)
      ? editor.value.trim()
      : editor.innerText.trim()) ?? "";

  if (!currentComment) return;

  removeAutoCompleteSuggestion();
  checkGrammarButton && showSpinnerForNewViewButton(checkGrammarButton.id);
  let { title, text, imageSource } = getPostInfo();
  const newText = await fetchGrammarData(currentComment);
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
  
            let username = document.querySelector("#overlayScrollContainer > div._1npCwF50X2J7Wt82SZi6J0 > div.u35lf2ynn4jHsVUwPmNU.Dx3UxiK86VcfkFQVHNXNi > div.uI_hDmU5GSiudtABRz_37 > div._1r4smTyOEZFO91uFIdWW6T.aUM8DQ_Nz5wL0EJc_wte6 > div._2kZkQ13N-kvhDEJOBd1S1I > span > a") || document.querySelector("#user-drawer-content > ul:nth-child(1) > faceplate-tracker:nth-child(1) > li > a > span.flex.items-center.gap-xs.min-w-0.shrink > span.flex.flex-col.justify-center.min-w-0.shrink.py-\\[var\\(--rem6\\)\\] > span.text-12.text-secondary-weak");
            if (!username) {
                try {
                    username = document.querySelector('.user') || 'Username failed to fetch'; //document.querySelector("#AppRouter-main-content > div > div > div._3ozFtOe6WpJEMUtxDOIvtU > div._31N0dvxfpsO6Ur5AKx4O5d > div._1OVBBWLtHoSPfGCRaPzpTf._3nSp9cdBpqL13CqjdMr2L_.2udhMC-jldHp_EpAuBeSR1.PaJBYLqPf_Gie2aZntVQ7._2OVNlZuUd8L9v0yVECZ2iA > div.uI_hDmU5GSiudtABRz_37 > div._1r4smTyOEZFO91uFIdWW6T.aUM8DQ_Nz5wL0EJc_wte6 > div._2kZkQ13N-kvhDEJOBd1S1I > span > a")
                } catch (error) {
                    console.error(error);
                }
            }
  
  safeStorageOperation('get', ["userId"], function(result) {
    if (result) {
        const UUID = result.userId;
        sendToDB({
          ActionID: UUID + '-' + getFormattedDateTime(),
          RedditPostID: UUID + '-' + getFormattedDateTime(), 
          UUIDxStart: UUID + "-" + getFormattedDateTime(), 
          UUID: UUID, 
          subTitleElem: title, 
          userTypedComment: currentComment, 
          suggestedComment: newText.result, 
          RedditPostUrl: window.location.href,
          subredditName: subredditName,
          suggestedCommentTime: getFormattedDateTime(), 
          Type: 'Grammar -' + getFormattedDateTime(), 
          webpageOpenTime: getFormattedDateTime(), 
          parentText: text, 
          table: 'RedditActivity',
          prompt: newText.prompt,
          prompt_category:"control"
        })
        if (username && username.textContent) {
          let cleanedUsername = username.textContent.startsWith('u/') ? username.textContent.substring(2) : username.textContent;
          let matchResult = cleanedUsername.match(/^[\w-]+/);
          if (matchResult && matchResult.length > 0) {
              let primaryUsername = matchResult[0];
              sendToDB({UUID: result.userId? result.userId : 'ERROR: UUID not found' + Date.now(), Redditusername: primaryUsername, LoginTime: getFormattedDateTime(), ExtensionInstallTime: getFormattedDateTime(), table: 'Usernames'});
          }
      }
    }
  });

  if (isShownAutoSuggestion) {
    injectContentIntoRedditEditor(newText.result);
  } else {
    removeAutoCompleteSuggestion(editor);
    injectTextCore(newText.result);
  }
  checkGrammarButton && hideSpinnerForNewViewButton(checkGrammarButton.id);
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
  const img = document.querySelector('._2_tDEnGMLxpM6uOa2kaDB3.ImageBox-image.media-element._1XWObl-3b9tPy64oaG6fax') || document.getElementById('post-image');
  let imageSource = 'N/A';
  if (img) {
      imageSource = img.src;
  }
  return { title: title, text: text, imageSource: imageSource };
}

function injectContentIntoRedditEditor(message) {
  if (redditPattern.test(url) || newRedditPattern.test(url)) {
    editor.focus();

    showAutoCompleteSuggestion(message, editor);
    return;
  }

  // currently, it removed, maybe will used later
  // if (newRedditPattern.test(url) && editor) {
  //   const event = new CustomEvent("draft-js-content-update", {
  //     detail: {
  //       buttonNumber: checkGrammarButton.id.split("CheckGrammarOldView")[1],
  //       content: message,
  //     },
  //   });
  //   document.head.dispatchEvent(event);
  // }

  if (oldRedditPattern.test(url)) {
    editor.focus();

    showAutoCompleteSuggestion(message, editor, false, true);

    // editor.value = message;
  }
}

function injectTextCore(message) {
  isInAutoSuggestionChanged = true;
  editor.focus();

  setTimeout(() => {
    document.execCommand("selectAll", false, null);
  }, 0);
  setTimeout(() => {
    document.execCommand("cut", false, null);
  }, 10);
  setTimeout(() => {
    document.execCommand("insertText", false, message);
    editor.focus();
  }, 20);

  setTimeout(() => {
    isInAutoSuggestionChanged = false;
  }, 2000);
}
