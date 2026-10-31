import config, { GLOBAL_DEFAULT_OPTIONS } from "../config";

import {
  showAutoCompleteSuggestion,
  removeAutoCompleteSuggestion,
  getAutoCompleteSuggestion,
} from "../autosuggest";
import { sendToDB } from "../sendToDB";
import { debounce } from "./utils";

// When deployed, replace it with real server api prefix
const API_PREFIX = config.SERVER_ENDPOINT;

const buttonId = "check-button";

let editorWrapper = null;
let editor = null;
let checkGrammarButton = null;

let isInAutoSuggestionChanged = false;

let globalOptions = GLOBAL_DEFAULT_OPTIONS;

const showSpinner = () => {
  document.querySelector(`#${buttonId} .dot-flashing`).style.display =
    "inline-block";
  document.querySelector(
    `#${buttonId} .css-1qaijid.r-dnmrzs.r-1udh08x.r-3s2u2q.r-bcqeeo.r-qvutc0.r-poiln3.r-a023e6.r-rjixqe`
  ).style.opacity = "0";
};

const hideSpinner = () => {
  document.querySelector(`#${buttonId} .dot-flashing`).style.display = "none";
  document.querySelector(
    `#${buttonId} .css-1qaijid.r-dnmrzs.r-1udh08x.r-3s2u2q.r-bcqeeo.r-qvutc0.r-poiln3.r-a023e6.r-rjixqe`
  ).style.opacity = "1";
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
    const tweet = await setPostText();
    chrome.storage.sync.get("userId", function(result) {
      const UUID = result.userId
      sendToDB({
        ActionID: UUID + '-' + getFormattedDateTime(),
        TwitterPostID: UUID + '-' + getFormattedDateTime(), 
        UUIDxStart: UUID + "-" + getFormattedDateTime(), 
        UUID: UUID, 
        TwitterPostUrl: window.location.href,
        userTypedComment: currentComment, 
        suggestedComment: responseData.result, 
        suggestedCommentTime: getFormattedDateTime(),
        autoCompleteSuggestion: responseData.result,
        autoCompleteSuggestionTime: getFormattedDateTime(), 
        webpageOpenTime: getFormattedDateTime(), 
        textBoxEntry: tweet,
        table: 'TwitterActivity',
        prompt: responseData.prompt,
        prompt_category:"control"
      })
      const profileLinkElement = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      if (profileLinkElement) {
        var Twitterusername = profileLinkElement.href.split('/').pop();
        chrome.storage.sync.get(["userId", "extensionSetupTime"], function(result) {
            let UUID = result.userId;
            sendToDB({
                UUID: UUID,
                Twitterusername: Twitterusername,
                LoginTime: getFormattedDateTime(),
                table: 'Usernames'
            });
        });
      }
    });
    

    if (responseData.error) {
      return currentComment;
    }

    return responseData.result;
  } catch (e) {
    return currentComment;
  }
};

async function setPostText() {
  const startTimeForPostText = Date.now();
  const maxDurationForPostText = 10000; // 10 seconds
  const attemptIntervalForPostText = 100; // milliseconds

  return new Promise((resolve, reject) => {
      const findPostTextTimer = setInterval(() => {
          const tweetArticle = document.querySelector("article[tabindex='-1']");
          if (tweetArticle) {
              const postElement = tweetArticle.querySelector("div[data-testid=tweetText]");
              if (postElement) {
                  clearInterval(findPostTextTimer);
                  resolve(postElement.innerText); // Resolve the promise with the post text
              }
              else {
                  clearInterval(findPostTextTimer);
                  resolve(''); // Resolve with empty string if the post text is not found
              }
          }
          if (Date.now() - startTimeForPostText > maxDurationForPostText) {
              clearInterval(findPostTextTimer);
              resolve(''); // Resolve with empty string if the time expires
          }
      }, attemptIntervalForPostText);
  });
}

function getFormattedDateTime(timestamp = Date.now()) {
    const now = new Date(timestamp);
    return now.toISOString();
}

const handleKeydown = (event) => {
  const keycode = event.key.toLowerCase();
  if (keycode === "escape") {
    event.stopPropagation();
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

chrome.runtime.onMessage.addListener(function (data, sender, sendResponse) {
  if (data.message === "content-injected") {
    if (data.options) globalOptions = data.options;

    const setupEditor = (editorPanel) => {
      const previousButton = editorPanel.querySelector(`#${buttonId}`);
      if (!previousButton && window.location.href !== "https://x.com/home") {
        editorWrapper = document.querySelector(".DraftEditor-root");
        editor = editorWrapper.querySelector('[contenteditable="true"]');

        removeAutoCompleteSuggestion(editor);
        editor.addEventListener("keydown", handleKeydown);

        if (globalOptions.autocomplete) {
          editor.addEventListener("input", handleInput);
        }
        if (globalOptions.suggest) {
          checkGrammarButton = createCheckButton();
          editorPanel.appendChild(checkGrammarButton);

          checkGrammarButton.addEventListener("click", () =>
            checkGrammar(false)
          );
        }
      }
    };

    const initializeCommentBox = () => {
      const buttonContainer = document.querySelector(
        ".css-175oi2r.r-1awozwy.r-18u37iz.r-knv0ih"
      );

      if (buttonContainer) {
        !checkGrammarButton && setupEditor(buttonContainer);
        return true;
      }
      return false;
    };

    const observer = new MutationObserver((mutations, obs) => {
      if (initializeCommentBox()) {
        obs.disconnect();
      }
    });

    if (
      !initializeCommentBox() &&
      window.location.href !== "https://x.com/home"
    ) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }
});

function createCheckButton() {
  let button = document.createElement("div");
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.style.backgroundColor = "rgb(29, 155, 240)";
  button.style.borderColor = "rgba(0, 0, 0, 0)";
  button.className =
    "css-175oi2r r-sdzlij r-1phboty r-rs99b7 r-lrvibr r-19u6a5r r-2yi16 r-1qi8awa r-ymttw5 r-1loqt21 r-o7ynqc r-6416eg r-1ny4l3l";
  button.id = buttonId;
  button.style.paddingLeft = "15px";
  button.style.paddingRight = "15px";

  let innerDiv = document.createElement("div");
  innerDiv.setAttribute("dir", "ltr");
  innerDiv.style.color = "rgb(255, 255, 255)";
  innerDiv.style.textOverflow = "unset";
  innerDiv.className =
    "css-1rynq56 r-bcqeeo r-qvutc0 r-37j5jr r-q4m81j r-a023e6 r-rjixqe r-b88u0q r-1awozwy r-6koalj r-18u37iz r-16y2uox r-1777fci";

  // Create the span elements for the button text
  let textSpan = document.createElement("span");
  textSpan.className =
    "css-1qaijid r-dnmrzs r-1udh08x r-3s2u2q r-bcqeeo r-qvutc0 r-poiln3 r-a023e6 r-rjixqe";
  textSpan.style.textOverflow = "unset";
  let innerTextSpan = document.createElement("span");
  innerTextSpan.className = "css-1qaijid r-bcqeeo r-qvutc0 r-poiln3";
  innerTextSpan.textContent = "Proofread";
  textSpan.style.opacity = "1";

  // Assemble the button
  textSpan.appendChild(innerTextSpan);
  innerDiv.appendChild(textSpan);
  button.appendChild(innerDiv);

  const style = document.createElement("style");
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
          background-color: white;
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
          background-color: white;
          animation: dotFlashing 0.5s infinite linear alternate; /* Made faster */
          animation-delay: 0.25s; /* Adjusted for faster animation */
      }
  `;
  document.head.appendChild(style);

  const divDotFlashing = document.createElement("div");
  divDotFlashing.className = "dot-flashing";
  divDotFlashing.setAttribute("role", "status");
  const divDot = document.createElement("div");
  divDotFlashing.appendChild(divDot);
  divDotFlashing.style.display = "none";

  // Center the loader within the button
  const divLoaderWrapper = document.createElement("div");
  divLoaderWrapper.style.display = "flex";
  divLoaderWrapper.style.justifyContent = "center";
  divLoaderWrapper.style.alignItems = "center";
  divLoaderWrapper.style.position = "absolute";
  divLoaderWrapper.style.width = "100%";
  divLoaderWrapper.style.height = "100%";
  divLoaderWrapper.style.inset = "0";
  divLoaderWrapper.appendChild(divDotFlashing);
  button.appendChild(divLoaderWrapper);

  // Append spans to button
  button.style.position = "relative";
  // Find the parent element and append the newly created button
  let parentElement = document.querySelector(
    ".css-175oi2r.r-1awozwy.r-18u37iz.r-knv0ih"
  );
  parentElement.appendChild(button);

  return button;
}

async function checkGrammar(isShownAutoSuggestion = false) {
  let currentText = editor.innerText.trim();

  if (
    currentText === "Post your Reply" ||
    currentText === "Post your reply\n\n"
  ) {
    currentText = "";
  }

  if (!currentText) return;

  removeAutoCompleteSuggestion();

  editor.focus();
  checkGrammarButton && showSpinner();
  const newText = await fetchGrammarData(currentText);

  if (isShownAutoSuggestion) {
    showAutoCompleteSuggestion(newText, editor, true);
  } else {
    injectTextCore(newText);
  }
  checkGrammarButton && hideSpinner();
}

function injectTextCore(message) {
  const event = new CustomEvent("draft-js-twitter-content-update", {
    detail: {
      content: message,
    },
  });
  document.head.dispatchEvent(event);
}
