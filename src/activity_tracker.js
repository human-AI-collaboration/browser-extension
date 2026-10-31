// Function to normalize hostname
function normalizeHostname(hostname) {
    return hostname.replace(/^www\./, '');
}

// Function to check if the current URL's hostname matches any in the hostname list
function isMatchingHostname(hostnameList, currentUrl) {
    const currentHostname = new URL(currentUrl).hostname;
    return hostnameList.includes(currentHostname) || hostnameList.includes(normalizeHostname(currentHostname));
}

// Function to get formatted date time
function getFormattedDateTime(timestamp = Date.now()) {
    const now = new Date(timestamp);
    return now.toISOString();
}

// Function to format time interval
function formatTimeInterval(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Main function to initialize and run the tracking
async function initializeTracking() {
    try {
        // Fetch the UUID
        const { userId: UUID } = await new Promise((resolve) => chrome.storage.sync.get("userId", resolve));
        
        if (!UUID) {
            console.error("UUID not found");
            return;
        }

        // Fetch the hostname list
        const response = await fetch(chrome.runtime.getURL('urls.json'));
        if (!response.ok) {
            throw new Error('Failed to fetch hostname list');
        }
        const hostnameList = await response.json();

        const currentUrl = window.location.href;

        // Check if the current URL's hostname matches any in the list
        if (isMatchingHostname(hostnameList, currentUrl)) {
            let startTime = Date.now();
            let clickCounter = 0;
            let scrollCounter = 0;
            let keypressCounter = 0;

            function logEvent(eventType) {
                switch(eventType) {
                    case 'click': clickCounter++; break;
                    case 'scroll': scrollCounter++; break;
                    case 'keypress': keypressCounter++; break;
                }
            }

            // Attach event listeners
            const eventListeners = {
                'click': () => logEvent('click'),
                'scroll': () => logEvent('scroll'),
                'keypress': () => logEvent('keypress')
            };

            Object.entries(eventListeners).forEach(([event, listener]) => {
                window.addEventListener(event, listener);
            });

            async function calculateTime() {
                const endTime = Date.now();
                const data = {'UUIDxStart': UUID + '-' + startTime, 'UUID': UUID, 'Platform': window.location.hostname, 'sessionStart': getFormattedDateTime(startTime), 'sessionEnd': getFormattedDateTime(endTime), 'sessionTotalTime': formatTimeInterval(endTime - startTime), 'postsOpened': 'N/A', 'clicks': clickCounter, 'scrolls': scrollCounter, 'keypresses': keypressCounter, 'table': 'UserActivity'}

                try {
                    chrome.runtime.sendMessage({action: "tab-close-analytics", data: data});
                } catch (error) {
                    console.error('Failed to send data:', error);
                    // Implement a fallback method here if needed
                }

                // Reset counters
                clickCounter = scrollCounter = keypressCounter = 0;
                startTime = Date.now();
            }

            // Set up interval to periodically send data (e.g., every 5 minutes)
            const intervalId = setInterval(calculateTime, 5 * 60 * 1000);

            // Event listeners for page unload and visibility change
            window.addEventListener('beforeunload', calculateTime);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    calculateTime();
                } else {
                    startTime = Date.now();
                }
            });

            // Cleanup function
            function cleanup() {
                clearInterval(intervalId);
                Object.entries(eventListeners).forEach(([event, listener]) => {
                    window.removeEventListener(event, listener);
                });
                window.removeEventListener('beforeunload', calculateTime);
                document.removeEventListener('visibilitychange', calculateTime);
            }

            // Call cleanup when necessary (e.g., when navigating away from the page)
            window.addEventListener('unload', cleanup);
        }
    } catch (error) {
        console.error('Error in tracking initialization:', error);
    }
}

// Initialize tracking
initializeTracking();
