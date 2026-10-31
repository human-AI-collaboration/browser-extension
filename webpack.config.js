const path = require('path');

module.exports = {
  entry: {
    reddit_content: './src/reddit_content.js',
    twitter_content: './src/twitter_content.js',
    proofread_reddit: './src/proofread/reddit.js',
    proofread_twitter: './src/proofread/twitter.js',
    background: './src/background.js',
    activity_tracker: './src/activity_tracker.js',
    inject_main: './src/injectMain.js',
    inject_twitter: './src/inject_twitter.js',
    adCollector: './src/adCollector.js', 
    welcome_popup: './src/welcome_popup.js',
    popup: './popup.js',
    survey_popup: './src/survey_popup.js'
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
};
