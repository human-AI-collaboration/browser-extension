import { sendToDB } from "./src/sendToDB.js";

console.log('Popup Script Loaded');
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');
    initPopup();
});
let userPreferences = {
    length: 'Medium',
    tone: 'None',
    humor: 'None',
    instructions: '',
    sampleComments: '',
    UUID: 'N/A',
    fewShot: 'Option 1'
}
function initPopup() {
    // const lengthButtons = document.getElementById('lengthButtons').getElementsByTagName('button');
    // const toneButtons = document.getElementById('toneButtons').getElementsByTagName('button');
    // const humorButtons = document.getElementById('humorButtons').getElementsByTagName('button');
    // const instructions = document.getElementById('instructions');
    // const sampleComments = document.getElementById('sampleComments');
    // const saveButton = document.getElementById('saveButton');
    const feedbackButton = document.getElementById('feedbackButton');
    // const fewShotButton = document.getElementById('fewShotButton').getElementsByTagName('button');

    // Load and set the slider value from Chrome storage
    // chrome.storage.sync.get(['selectedLength', 'selectedTone', 'selectedHumor', 'instructions', 'sampleComments', 'userId', 'extensionSetupTime', 'fewShot'], function(result) {
    //     if (result.selectedLength) {
    //         Array.from(lengthButtons).forEach(button => {
    //             if (button.textContent === result.selectedLength) {
    //                 userPreferences.length = result.selectedLength;
    //                 button.classList.add('active');
    //             }
    //         });
    //     } else {
    //         // Set default to "Medium"
    //         Array.from(lengthButtons).forEach(button => {
    //             if (button.textContent === 'Medium') {
    //                 button.classList.add('active');
    //             }
    //         });
    //     }
    //     if (result.selectedTone) {
    //         Array.from(toneButtons).forEach(button => {
    //             if (button.textContent === result.selectedTone) {
    //                 userPreferences.tone = result.selectedTone;
    //                 button.classList.add('active');
    //             }
    //         });
    //     }
    //     if (result.selectedHumor) {
    //         Array.from(humorButtons).forEach(button => {
    //             if (button.textContent === result.selectedHumor) {
    //                 userPreferences.humor = result.selectedHumor;
    //                 button.classList.add('active');
    //             }
    //         });
    //     }
    //     if (result.instructions) {
    //         userPreferences.instructions = result.instructions;
    //         instructions.value = result.instructions;
    //     }
    //     if (result.sampleComments) {
    //         userPreferences.sampleComments = result.sampleComments;
    //         sampleComments.value = result.sampleComments;
    //     }
    //     if (result.userId) {
    //         userPreferences.UUID = result.userId;
    //     }
    //     if (result.fewShot) {
    //         Array.from(fewShotButton).forEach(button => {
    //             if (button.textContent === result.fewShot) {
    //                 userPreferences.fewShot = result.fewShot;
    //                 button.classList.add('active');
    //             }
    //         });
    //     }
    //     sendToDB({PreferenceID: userPreferences.UUID + '-' + Date.now(), UUID: userPreferences.UUID, Time: getFormattedDateTime(), Tone: result.selectedTone, Humor: result.selectedHumor, Length: result.selectedLength, AdditionalInstructions: result.instructions, SampleComments: result.sampleComments, fewShot: result.fewShot, table: 'User Preferences'});
    // });

    // Add length button listeners
    // attachButtonListeners(lengthButtons, 'selectedLength');
    // saveButton.addEventListener('click', () => {
    //     handleSave();
    //     userPreferences.instructions = instructions.value;
    //     userPreferences.sampleComments = sampleComments.value;
    //     userPreferences.fewShot = fewShotButton.value;
    //     sendToDB({PreferenceID: userPreferences.UUID + '-' + Date.now(), UUID: userPreferences.UUID, Time: getFormattedDateTime(), Tone: userPreferences.tone, Humor: userPreferences.humor, Length: userPreferences.length, AdditionalInstructions: userPreferences.instructions, SampleComments: userPreferences.sampleComments, fewShot: userPreferences.fewShot, table: 'User Preferences'});
    //     chrome.storage.sync.set({ 'instructions': instructions.value, 'sampleComments': sampleComments.value });
    // });
    feedbackButton.addEventListener('click', () => {
        window.open('https://forms.gle/imAfQaRH89a6p8QE8', '_blank');
    });

    // Attach event listeners to the tone and humor buttons
    attachButtonListeners(toneButtons, 'selectedTone');
    attachButtonListeners(humorButtons, 'selectedHumor');
    attachButtonListeners(fewShotButton, 'fewShot');
}

function attachButtonListeners(buttons, storageKey) {
    Array.from(buttons).forEach(button => {
        button.addEventListener('click', () => {
            toggleButton(button, storageKey, buttons);
        });
    });
}

function toggleButton(selectedButton, storageKey, buttons) {
    Array.from(buttons).forEach(button => {
        if (button !== selectedButton) {
            button.classList.remove('active');
        }
    });

    // For length buttons, always keep one selected
    if (storageKey === 'selectedLength') {
        Array.from(buttons).forEach(button => button.classList.remove('active'));
        selectedButton.classList.add('active');
        userPreferences.length = selectedButton.textContent;
        chrome.storage.sync.set({ [storageKey]: selectedButton.textContent });
    } else {
        if (selectedButton.classList.contains('active')) {
            selectedButton.classList.remove('active');
            if (storageKey === 'selectedTone') {
                userPreferences.tone = 'None';
            } else if (storageKey === 'selectedHumor') {
                userPreferences.humor = 'None';
            }
            else if (storageKey === 'fewShot') {
                userPreferences.fewShot = 'Option 1';
            }
            sendToDB({PreferenceID: userPreferences.UUID + '-' + Date.now(), UUID: userPreferences.UUID, Time: getFormattedDateTime(), Tone: userPreferences.tone, Humor: userPreferences.humor, Length: userPreferences.length, AdditionalInstructions: userPreferences.instructions, SampleComments: userPreferences.sampleComments, fewShot: userPreferences.fewShot, table: 'User Preferences'});
            chrome.storage.sync.set({ [storageKey]: null });
        } else {
            selectedButton.classList.add('active');
            if (storageKey === 'selectedTone') {
                userPreferences.tone = selectedButton.textContent;
            } else if (storageKey === 'selectedHumor') {
                userPreferences.humor = selectedButton.textContent;
            }
            else if (storageKey === 'fewShot') {
                userPreferences.fewShot = selectedButton.textContent;
            }
            sendToDB({PreferenceID: userPreferences.UUID + '-' + Date.now(), UUID: userPreferences.UUID, Time: getFormattedDateTime(), Tone: userPreferences.tone, Humor: userPreferences.humor, Length: userPreferences.length, AdditionalInstructions: userPreferences.instructions, SampleComments: userPreferences.sampleComments,  fewShot: userPreferences.fewShot, table: 'User Preferences'});
            chrome.storage.sync.set({ [storageKey]: selectedButton.textContent });
        }
    }
}

function handleSave() {
    const saveButton = document.getElementById('saveButton');
    saveButton.textContent = 'Saved';
    saveButton.classList.add('active');
    setTimeout(() => {
        saveButton.textContent = 'Save Settings';
        saveButton.classList.remove('active');
    }, 1500); // Change back to "Save Settings" after 2 seconds
}

function debounce(func, delay) {
    let debounceTimer;
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(context, args), delay);
    };
}

function getFormattedDateTime(timestamp = Date.now()) {
    const now = new Date(timestamp);
    
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(6, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function formatTimeInterval(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
