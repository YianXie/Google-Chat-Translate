const DEFAULT_PATHS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};

/** The installed (branded) Chrome. Set CHROME_PATH to use another one. */
export const CHROME_PATH = process.env.CHROME_PATH ?? DEFAULT_PATHS[process.platform] ?? 'google-chrome';
