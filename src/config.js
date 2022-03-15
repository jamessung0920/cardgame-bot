module.exports = {
  env: process.env.NODE_ENV,
  webhook: {
    line: {
      channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    },
  },
  serviceAccount: {
    gcp: {
      credential: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    },
  },
};
