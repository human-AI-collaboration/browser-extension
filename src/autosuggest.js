import config from "./config";
const SERVER_ENDPOINT = config.SERVER_ENDPOINT;

let autoCompleteSuggestion = "";
let autoCompleteData = {};

// Define a JSON object for shared styles
const redditStyle = {
  position: "absolute",
  color: "gray",
  zIndex: "9999",
  background: "transparent", // Match the Reddit text box background
  padding: "0 2px", // Adjust padding to align with text
  whiteSpace: "pre-wrap", // Allow wrapping
  wordBreak: "break-word", // Break long words
  border: "none", // Remove borders
};

const oldRedditStyle = {
  position: "absolute",
  color: "gray",
  zIndex: "9999",
  background: "transparent",
  padding: "0 2px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  border: "none",
  fontSize: "14px",
  lineHeight: "20px",
};

const twitterStyle = {
  position: "absolute",
  color: "#8899a6", // Twitter's grey text color
  zIndex: "9999",
  background: "transparent", // Match the Twitter text box background
  padding: "0 2px", // Adjust padding to align with text
  whiteSpace: "pre-wrap", // Allow wrapping
  wordBreak: "break-word", // Break long words
  border: "none", // Remove borders
  fontSize: "20px", // Match Twitter's default font size
  lineHeight: "24px", // Match Twitter's line height
  fontFamily:
    'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', // Match Twitter's font family
};

// Function to apply styles from the JSON object to an element
function applyStyles(element, styles) {
  for (const [key, value] of Object.entries(styles)) {
    element.style[key] = value;
  }
}

export function getAutoCompleteSuggestion() {
  return autoCompleteSuggestion;
}

export function getAutoCompleteData() {
  return autoCompleteData;
}

export function removeAutoCompleteSuggestion(textBox) {
  autoCompleteSuggestion = "";

  const existingFirstSuggestion = document.getElementById(
    "autocomplete-suggestion-first"
  );
  const existingSecondSuggestion = document.getElementById(
    "autocomplete-suggestion-second"
  );

  if (existingFirstSuggestion) {
    existingFirstSuggestion.remove();
  }
  if (existingSecondSuggestion) {
    existingSecondSuggestion.remove();
  }

  if (textBox) resetTextBoxHeight(textBox);
}

// Function to show auto-complete suggestion as an absolutely positioned element within the input box
export function showAutoCompleteSuggestion(
  suggestion,
  editor,
  twitter = false,
  isOldReddit = false,
  dataObj = null,
) {
  const suggestionStyles = isOldReddit
    ? oldRedditStyle
    : twitter
    ? twitterStyle
    : redditStyle;

  autoCompleteData = dataObj;

  // Extract the actual suggestion text from the object.
  if (typeof suggestion === 'object' && suggestion.autoCompleteSuggestion) {
    suggestion = suggestion.autoCompleteSuggestion;
  }

  // Get the text that the user has already typed in editor.
  const currentText = editor.innerText || editor.textContent;

  // Find part of the suggestion that hasn't been typed yet
  let remainingSuggestion = suggestion.trim();
  // if (suggestion.toLowerCase().startsWith(currentText.toLowerCase())) {
  //   remainingSuggestion = suggestion.slice(currentText.length);
  // }

  // Add space before the remaining suggestion if necessary
  console.log("Current text:", currentText);
  console.log("Remaining suggestion:", remainingSuggestion);
  if (remainingSuggestion && !currentText.endsWith(' ')) {
    if (!remainingSuggestion.startsWith(' ')) {
      remainingSuggestion = ' ' + remainingSuggestion;
    }
  }

  // Calculate available space after the caret
  const caretPos = getCaretCoordinates(editor);
  const rect = editor.getBoundingClientRect();
  const editorStyles = window.getComputedStyle(editor);
  const lineHeight = parseInt(editorStyles.lineHeight);
  const paddingLeft = parseInt(editorStyles.paddingLeft);
  const paddingRight = parseInt(editorStyles.paddingRight);

  // Create suggestion elements
  const firstSuggestionElement = document.createElement("div");
  const secondSuggestionElement = document.createElement("div");

  firstSuggestionElement.id = "autocomplete-suggestion-first";
  secondSuggestionElement.id = "autocomplete-suggestion-second";

  // Apply shared styles
  applyStyles(firstSuggestionElement, suggestionStyles);
  applyStyles(secondSuggestionElement, suggestionStyles);

  // Create a temporary span to measure text width
  const tempSpan = document.createElement("span");
  document.body.appendChild(tempSpan);
  applyStyles(tempSpan, suggestionStyles);
  tempSpan.style.position = "fixed";
  tempSpan.style.visibility = "hidden";
  tempSpan.style.whiteSpace = "pre";

  // Calculate available width for the first line
  const availableWidth = rect.width - caretPos.left - paddingRight;
  
  // Find where to split the text
  let firstPart = '';
  let secondPart = '';
  let currentLine = '';
  let lastFitWidth = 0;
  
  // Test the entire suggestion first
  tempSpan.textContent = remainingSuggestion;
  if (tempSpan.offsetWidth <= availableWidth) {
    // If entire suggestion fits, no need to split
    firstPart = remainingSuggestion;
  } else {
    // Need to split text - test character by character
    for (let i = 0; i < remainingSuggestion.length; i++) {
      currentLine = remainingSuggestion.substring(0, i + 1);
      tempSpan.textContent = currentLine;
      
      if (tempSpan.offsetWidth > availableWidth) {
        // Found split point - backtrack to last space if possible
        let lastSpace = currentLine.lastIndexOf(' ');
        if (lastSpace > 0) {
          firstPart = remainingSuggestion.substring(0, lastSpace);
          secondPart = remainingSuggestion.substring(lastSpace + 1);
        } else {
          // No space found, split at last character that fit
          firstPart = remainingSuggestion.substring(0, i);
          secondPart = remainingSuggestion.substring(i);
        }
        break;
      }
    }
    
    // If we didn't find a split point but processed the whole string
    if (!firstPart && !secondPart) {
      firstPart = remainingSuggestion;
    }
  }

  document.body.removeChild(tempSpan);

  firstSuggestionElement.textContent = firstPart;
  secondSuggestionElement.textContent = secondPart;

  adjustTextBoxHeight(editor, remainingSuggestion, twitter, isOldReddit);
  removeAutoCompleteSuggestion(editor);

  document.body.appendChild(firstSuggestionElement);
  document.body.appendChild(secondSuggestionElement);

  // Position the first suggestion at caret position
  firstSuggestionElement.style.left = `${rect.left + caretPos.left}px`;
  firstSuggestionElement.style.top = `${
    rect.top + window.scrollY + caretPos.top
  }px`;
  firstSuggestionElement.style.maxWidth = `${availableWidth}px`;
  firstSuggestionElement.style.marginTop =
    twitter || isOldReddit ? "0px" : "-2px";
  firstSuggestionElement.style.marginLeft = "0px";

  // Position the second suggestion at the start of the next line
  if (secondPart) {
    secondSuggestionElement.style.left = `${rect.left}px`;
    secondSuggestionElement.style.top = `${
      rect.top + window.scrollY + caretPos.top + lineHeight
    }px`;
    secondSuggestionElement.style.maxWidth = `${rect.width - paddingRight}px`;
    secondSuggestionElement.style.marginLeft = "0px";
    secondSuggestionElement.style.marginRight = "0px";
    secondSuggestionElement.style.paddingLeft = `${paddingLeft}px`;
  }

  autoCompleteSuggestion = remainingSuggestion;
}

// Function to get the caret position within the contenteditable element
export function getCaretCoordinates(editor) {
  if (editor.nodeName === "TEXTAREA" || editor.nodeName === "INPUT") {
    return getTextAreaCaretCoordinates(editor);
  } else {
    return getContentEditableCaretCoordinates(editor);
  }
}

function getTextAreaCaretCoordinates(textarea) {
  const { selectionEnd } = textarea;

  const div = document.createElement("div");
  document.body.appendChild(div);

  const style = getComputedStyle(textarea);
  const properties = [
    "borderWidth",
    "padding",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "whiteSpace",
    "lineHeight",
    "letterSpacing",
    "textTransform",
    "textAlign",
    "direction",
    "boxSizing",
    "width",
  ];
  properties.forEach((prop) => {
    div.style[prop] = style[prop];
  });

  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.top = `${textarea.getBoundingClientRect().top + window.scrollY}px`;
  div.style.left = `${
    textarea.getBoundingClientRect().left + window.scrollX
  }px`;

  const textContent = textarea.value.slice(0, selectionEnd);
  const beforeCaretText = textContent.replace(/\n$/, "\n\u200b");
  div.textContent = beforeCaretText;

  const span = document.createElement("span");
  span.textContent = "\u200b";
  div.appendChild(span);

  const rect = span.getBoundingClientRect();

  document.body.removeChild(div);

  const textareaRect = textarea.getBoundingClientRect();
  const top = rect.top - textareaRect.top;
  const left = rect.left - textareaRect.left;

  const remainingText = textarea.value.slice(selectionEnd);

  return {
    left: left + textarea.scrollLeft,
    top: top + textarea.scrollTop,
    remainingText,
  };
}

function getContentEditableCaretCoordinates(editor) {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) {
    return { left: 0, top: 0, remainingText: "" };
  }

  const range = selection.getRangeAt(0).cloneRange();
  const rect = range.getBoundingClientRect();

  const editorRect = editor.getBoundingClientRect();

  const top = rect.top - editorRect.top + editor.scrollTop;
  const left = rect.left - editorRect.left + editor.scrollLeft;

  const rangeEnd = range.endOffset;
  const textContent = editor.innerText || editor.textContent;
  const remainingText = textContent.slice(rangeEnd);

  return { left, top, remainingText };
}

export async function suggestAutoComplete(
  title,
  currentText,
  writtenText,
  imageSource,
  platform,
  signal, // Edit from Ryan: added autocomplete abortion signal
) {
  const flaskEndpoint = `${SERVER_ENDPOINT}/get_comment`;
  let fewShots = [];

  try {
    if (platform === "reddit") {
      const fewShotEndpoint = `${SERVER_ENDPOINT}/get_few_shot`;

      // Extract username from Reddit
      const usernameElement = document.querySelector('a[href^="/user/"]');
      let username = usernameElement ? usernameElement.textContent.trim() : 'N/A';

      // Use regex to capture just the username after "u/"
      const match = username.match(/u\/(\w+)/);
      username = match ? match[1] : 'N/A';
      console.log("Cleaned Username:", username);

      // Get the fewShot limit from Chrome storage
      const result = await new Promise((resolve, reject) => {
        chrome.storage.sync.get(['fewShot'], (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(result);
          }
        });
      });

      const limit = result.fewShot || 0;
      console.log("Few shot limit:", limit);

      // Fetch few shot data
      const fewShotResponse = await fetch(fewShotEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: username, limit: limit }),
      });

      if (!fewShotResponse.ok) {
        throw new Error(`Few shot API call failed with status ${fewShotResponse.status}`);
      }

      const fewShotData = await fewShotResponse.json();
      console.log("Few shot data received:", fewShotData);

      fewShots = fewShotData.comments || [];
    }

    // Fetch user settings
    const {
      selectedLength,
      selectedTone,
      selectedHumor,
      instructions,
      sampleComments,
      treatment,
    } = await getStorageData([
      "selectedLength",
      "selectedTone",
      "selectedHumor",
      "instructions",
      "sampleComments",
      "treatment",
    ]);

    // Prepare request data
    const requestData = {
      text: currentText.trim().replace(/\s+/g, " "),
      writtenText: writtenText,
      title: title,
      imageSource: imageSource,
      suggest: true,
      tone: selectedTone,
      humor: selectedHumor,
      length: selectedLength,
      fewShot: fewShots,
      instructions: instructions,
      sampleComments: sampleComments,
      treatment: treatment,
    };

    console.log("Request data prepared for Flask:", requestData);

    // Call Flask API
    const flaskResponse = await fetch(flaskEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestData),
      signal: signal // Edit from Ryan: added autocomplete abortion signal
    });

    if (!flaskResponse.ok) {
      throw new Error(`Flask API call failed with status ${flaskResponse.status}`);
    }

    const responseData = await flaskResponse.json();
    console.log("Flask response received:", responseData);

    return {
      autoCompleteSuggestion: responseData.comment,
      prompt: responseData.prompt,
      prompt_category: responseData.prompt_category,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    if (error === "suggest") throw error;
    console.error('Error making request to Flask server:', error, typeof error);
    return null;
  }
}


function adjustTextBoxHeight(textBox, suggestedText, twitter, isOldReddit) {
  // Create a temporary element to measure text height
  const tempElement = document.createElement("div");
  tempElement.style.position = "absolute";
  tempElement.style.visibility = "hidden";
  tempElement.style.whiteSpace = "pre-wrap";
  tempElement.style.wordBreak = "break-word";
  tempElement.style.width = `${textBox.clientWidth}px`;
  tempElement.style.fontSize = window.getComputedStyle(textBox).fontSize;
  tempElement.style.lineHeight = window.getComputedStyle(textBox).lineHeight;
  tempElement.style.fontFamily = window.getComputedStyle(textBox).fontFamily;
  tempElement.style.padding = "0";
  tempElement.style.margin = "0";

  // Set the text content to the existing text and suggested text
  tempElement.textContent = textBox.innerText + " " + suggestedText;
  document.body.appendChild(tempElement);

  // Get the combined height of the existing text and suggested text
  const combinedTextHeight = tempElement.offsetHeight;

  document.body.removeChild(tempElement);

  // Use requestAnimationFrame for smoother height adjustment
  requestAnimationFrame(() => {
    textBox.style.height = `${
      combinedTextHeight + (twitter ? 0 : !isOldReddit ? 34 : 50)
    }px`;
  });
}

// Function to reset the height of the text box based on its current content
function resetTextBoxHeight(textBox) {
  if (textBox.nodeName === "TEXTAREA" || textBox.nodeName === "INPUT") {
    return;
  }

  // Set the height to 'auto' to allow it to shrink or grow based on content
  textBox.style.height = "auto";
  //textBox.style.height = textBox.scrollHeight + 'px'; // Force a reflow to ensure the new height is applied //this cause bugs on twitter
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

