const DEFAULT_SETTINGS = {
  sourceLang: 'es',
  targetLang: 'en',
  triggerMode: 'modifier' // 'word-hover', 'sentence-hover', 'modifier'
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('settings', ({ settings }) => {
    if (!settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
  });
});

// Relay messages between popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'settingsUpdated') {
    // Broadcast to all tabs
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    });
  }
  return false;
});
