# Language Learning Translator

A Chrome extension that helps language learners by keeping foreign text visible and revealing translations only on demand. Unlike Google Translate which replaces everything, this forces you to try reading the foreign text first.

Uses Chrome's built-in [Translator API](https://developer.chrome.com/docs/ai/translator-api) — no API keys, no cloud costs, fully on-device.

**Requires Chrome 138+**

## How It Works

Hover over foreign text to see an inline translation that reverts when you move away. Three trigger modes:

- **Modifier + hover** (default) — hold Option to translate a word, Option+Cmd for a full sentence
- **Word hover** — plain hover translates the word under cursor
- **Sentence hover** — plain hover translates the full sentence

Translations appear inline with a subtle underline, replacing the original text temporarily. Original text is restored when you move away or release the modifier key.

## Install

1. Clone this repo
2. Open `chrome://extensions` in Chrome 138+
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the repo directory
5. Click the extension icon to pick your source/target languages and trigger mode

## Configuration

Click the extension icon in the toolbar to:

- Set source and target languages (26 languages supported)
- Choose trigger mode
- Check Translator API availability for your language pair
