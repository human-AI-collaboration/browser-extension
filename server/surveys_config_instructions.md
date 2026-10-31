```javascript
/**
 * SURVEY CONFIGURATION
 * 
 * This section allows researchers to configure multiple surveys with different URLs and timing.
 * 
 * Instructions for researchers:
 * 1. To add a new survey, copy an existing survey object and modify its properties
 * 2. To disable all surveys, set 'enabled' to false
 * 3. To modify when surveys appear, adjust the 'timeToShow' value
 * 4. Each survey must have a unique 'id'
 * 5. For follow-up surveys, set the 'followUpTo' property to the ID of the parent survey
 * 
 * Survey object properties:
 * - id: A unique identifier for the survey (required)
 * - title: The title displayed in the popup (required)
 * - description: A brief description of the survey (required)
 * - url: The URL to the survey (required)
 * - timeToShow: When to show the survey after extension installation, in milliseconds (required)
 *   Common values:
 *   - 10 * 1000 = 10 seconds (for testing)
 *   - 24 * 60 * 60 * 1000 = 1 day
 *   - 7 * 24 * 60 * 60 * 1000 = 1 week
 *   - 30 * 24 * 60 * 60 * 1000 = 30 days
 * - reminders: Array of reminder configurations (required)
 *   Each reminder has:
 *   - delay: Time to wait before showing this reminder, in milliseconds
 *   - message: Optional custom message for this reminder (if not provided, the default message is used)
 * - maxReminders: Maximum number of reminders to show (default: show all configured reminders)
 * - showOnce: If true, the survey will only be shown once if completed or declined (required)
 * - showDeclineButton: If true, shows a "No Thanks" button that allows users to decline the survey (default: true)
 * 
 * Follow-up survey options:
 * - followUpTo: ID of the survey this one follows up (optional)
 * - daysAfterPrevious: Number of days to wait after the previous survey was completed (required for follow-ups)
 * - onlyIfCompleted: Only show this follow-up if the previous survey was completed, not just shown (default: true)
 * 
 * You can include the user's ID in the survey URL by adding a placeholder:
 * Example: 'https://your-survey-link.com/survey?participant_id={userId}'
 * The {userId} will be replaced with the actual user ID when the survey is opened.
 */
 ```
