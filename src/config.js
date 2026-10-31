const config = {
  // Address of the research server. The default points to a server running
  // locally (see README, "Running the server"). For a deployed study, replace it
  // with your own server's URL and rebuild with `npx webpack`.
  SERVER_ENDPOINT: 'http://127.0.0.1:5000'
};

export default config;

export const GLOBAL_DEFAULT_OPTIONS = {
  autocomplete: true,
  suggest: true,
  // functionality: 'comment_suggestion' or 'proofread'
  functionality: 'comment_suggestion',
  treatment: 'default_treatment',
};
