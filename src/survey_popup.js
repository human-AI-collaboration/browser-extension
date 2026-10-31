import config  from './config.js';

const SERVER_ENDPOINT = config.SERVER_ENDPOINT;

let SURVEYS_CONFIG = null;

async function fetchSurveysConfig() {
    try {
        const response = await fetch(`${SERVER_ENDPOINT}/get_surveys_config`);
        if (!response.ok) {
            throw new Error(`Error fetching survey config. status: ${response.status}`);
        }
        SURVEYS_CONFIG = await response.json();
    } catch (error) {
        console.error('Failed to fetch survey configuration:', error);
    }
}

// Function to check if surveys should be shown
async function checkAndShowSurveys() {
    // If surveys are disabled, don't show anything
    if (!SURVEYS_CONFIG) {
        await fetchSurveysConfig();
    }

    if (!SURVEYS_CONFIG?.enabled) return;

    // Get all survey data from storage
    chrome.storage.sync.get(['extensionSetupTime', 'surveyData'], (result) => {
        if (!result.extensionSetupTime) return;

        // Initialize surveyData if it doesn't exist
        const surveyData = result.surveyData || {};

        // First, check for regular (non-follow-up) surveys
        for (const survey of SURVEYS_CONFIG.surveys) {
            // Skip follow-up surveys in this loop
            if (survey.followUpTo) continue;

            const surveyId = survey.id;
            const surveyInfo = surveyData[surveyId] || {
                completed: false,
                declined: false,
                reminderIndex: 0,
                nextReminder: null,
                completedDate: null
            };

            // Calculate time elapsed since extension installation
            const timeElapsed = Date.now() - result.extensionSetupTime;

            // Check if this survey should be shown
            if (timeElapsed >= survey.timeToShow && 
                !surveyInfo.completed && 
                !surveyInfo.declined && 
                (!surveyInfo.nextReminder || Date.now() >= surveyInfo.nextReminder)) {

                // Show this survey
                createSurveyPopup(survey, surveyData);

                // Only show one survey at a time
                return;
            }
        }

        // Then, check follow-up surveys only if no regular surveys were shown
        for (const survey of SURVEYS_CONFIG.surveys) {
            // Only process follow-up surveys in this loop
            if (!survey.followUpTo) continue;

            const surveyId = survey.id;
            const parentId = survey.followUpTo;
            const surveyInfo = surveyData[surveyId] || {
                completed: false,
                declined: false,
                reminderIndex: 0,
                nextReminder: null,
                completedDate: null
            };

            const parentInfo = surveyData[parentId];

            // Skip if parent survey doesn't exist in data or hasn't been completed
            if (!parentInfo || (survey.onlyIfCompleted !== false && !parentInfo.completed)) {
                continue;
            }

            // Skip if this follow-up has been completed or declined
            if (surveyInfo.completed || surveyInfo.declined) {
                continue;
            }

            // Skip if there's a pending reminder
            if (surveyInfo.nextReminder && Date.now() < surveyInfo.nextReminder) {
                continue;
            }

            // Calculate the time to wait after the parent survey was completed
            const waitTime = survey.daysAfterPrevious * 24 * 60 * 60 * 1000;

            // Check if enough time has passed since the parent survey was completed
            if (parentInfo.completedDate && (Date.now() - parentInfo.completedDate >= waitTime)) {
                // Show this follow-up survey
                createSurveyPopup(survey, surveyData);

                // Only show one survey at a time
                return;
            }
        }
    });
}

function createSurveyPopup(survey, allSurveyData) {
    // Remove any existing overlay and popup
    const existingOverlay = document.getElementById('popup-overlay');
    const existingSurvey = document.getElementById('survey-popup');
    if (existingOverlay) existingOverlay.remove();
    if (existingSurvey) existingSurvey.remove();

    // Get the survey info
    const surveyId = survey.id;
    const surveyInfo = allSurveyData[surveyId] || {
        completed: false,
        declined: false,
        reminderIndex: 0,
        nextReminder: null,
        completedDate: null
    };

    // Get custom message if this is a reminder and has a custom message
    let surveyDescription = survey.description;
    if (surveyInfo.reminderIndex > 0 && 
        survey.reminders && 
        survey.reminders[surveyInfo.reminderIndex - 1] && 
        survey.reminders[surveyInfo.reminderIndex - 1].message) {
        surveyDescription = survey.reminders[surveyInfo.reminderIndex - 1].message;
    }

    // Determine whether to show the decline button (default to true if not explicitly set)
    const showDeclineButton = survey.showDeclineButton !== false;

    const overlayHTML = `<div id="popup-overlay"></div>`;
    const popupHTML = `
        <div id="survey-popup" class="welcome-popup" data-survey-id="${survey.id}">
        <div class="popup-header">
        <img src="${chrome.runtime.getURL('icons8-easy-100-bg.png')}" alt="Icon">
        <h2 class="popup-title">${survey.title}</h2>
        </div>
        <p class="popup-welcome">Thanks for using Social Media Assistant!</p>
        <p>${surveyDescription}</p>
        <p>Would you mind taking a quick 5-minute survey? Your feedback helps us improve!</p>
        <div class="popup-actions">
        <button id="take-survey-btn" class="action-btn">Take Survey</button>
        <div class="secondary-actions">
        <button id="remind-later-btn" class="secondary-btn">Remind Me Later</button>
        ${showDeclineButton ? '<button id="no-survey-btn" class="secondary-btn">No Thanks</button>' : ''}
        </div>
        </div>
        </div>
        `;

    document.body.insertAdjacentHTML('beforeend', overlayHTML + popupHTML);

    const overlay = document.getElementById('popup-overlay');
    const popup = document.getElementById('survey-popup');
    const takeSurveyBtn = document.getElementById('take-survey-btn');
    const remindLaterBtn = document.getElementById('remind-later-btn');
    const noSurveyBtn = showDeclineButton ? document.getElementById('no-survey-btn') : null;

    function removePopup() {
        // Remove both elements completely instead of just hiding them
        if (popup && popup.parentNode) {
            popup.parentNode.removeChild(popup);
        }
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    }

    function updateSurveyData(updates) {
        // Get the current survey ID
        const surveyId = survey.id;

        // Update the survey data in storage
        chrome.storage.sync.get(['surveyData'], (result) => {
            const surveyData = result.surveyData || {};
            surveyData[surveyId] = {
                ...(surveyData[surveyId] || {}),
                ...updates
            };

            chrome.storage.sync.set({ 'surveyData': surveyData });
        });
    }

    takeSurveyBtn.addEventListener('click', () => {
        window.open(survey.url, '_blank');
        removePopup();

        // Mark this survey as completed
        updateSurveyData({ 
            completed: true,
            completedDate: Date.now()
        });
    });

    remindLaterBtn.addEventListener('click', () => {
        removePopup();

        // Get the current reminder index
        const reminderIndex = surveyInfo.reminderIndex || 0;

        // Check if we've reached the maximum number of reminders
        const maxReminders = survey.maxReminders || (survey.reminders ? survey.reminders.length : 1);

        if (reminderIndex >= maxReminders) {
            // We've reached the maximum number of reminders, so mark as declined
            updateSurveyData({ declined: true });
            return;
        }

        // Get the next reminder delay
        let nextReminderDelay;
        if (survey.reminders && survey.reminders[reminderIndex]) {
            nextReminderDelay = survey.reminders[reminderIndex].delay;
        } else {
            // Fallback to 3 days if no specific reminder configuration exists
            nextReminderDelay = 3 * 24 * 60 * 60 * 1000;
        }

        // Set the next reminder time and increment the reminder index
        const nextReminder = Date.now() + nextReminderDelay;
        updateSurveyData({ 
            nextReminder,
            reminderIndex: reminderIndex + 1
        });
    });

    // Only add the event listener if the button exists
    if (noSurveyBtn) {
        noSurveyBtn.addEventListener('click', () => {
            removePopup();

            // Mark this survey as declined
            updateSurveyData({ declined: true });
        });
    }

    // Display the popup
    overlay.style.display = 'block';
    popup.style.display = 'block';
}

// Initialize by checking if any surveys should be shown
checkAndShowSurveys();
