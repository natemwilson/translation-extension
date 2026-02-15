const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['ru', 'Russian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['tr', 'Turkish'],
  ['pl', 'Polish'],
  ['vi', 'Vietnamese'],
  ['th', 'Thai'],
  ['sv', 'Swedish'],
  ['da', 'Danish'],
  ['fi', 'Finnish'],
  ['uk', 'Ukrainian'],
  ['cs', 'Czech'],
  ['ro', 'Romanian'],
  ['el', 'Greek'],
  ['hu', 'Hungarian'],
  ['id', 'Indonesian'],
];

const sourceEl = document.getElementById('sourceLang');
const targetEl = document.getElementById('targetLang');
const statusEl = document.getElementById('status');
const modeRadios = document.querySelectorAll('input[name="triggerMode"]');

// Populate dropdowns
for (const [code, name] of LANGUAGES) {
  sourceEl.add(new Option(name, code));
  targetEl.add(new Option(name, code));
}

// Load saved settings
chrome.storage.local.get('settings', ({ settings }) => {
  if (!settings) return;
  sourceEl.value = settings.sourceLang;
  targetEl.value = settings.targetLang;
  for (const r of modeRadios) {
    r.checked = r.value === settings.triggerMode;
  }
  checkAvailability(settings.sourceLang, settings.targetLang);
});

function save() {
  const settings = {
    sourceLang: sourceEl.value,
    targetLang: targetEl.value,
    triggerMode: document.querySelector('input[name="triggerMode"]:checked').value,
  };
  chrome.storage.local.set({ settings });
  chrome.runtime.sendMessage({ type: 'settingsUpdated', settings });
  checkAvailability(settings.sourceLang, settings.targetLang);
}

async function checkAvailability(source, target) {
  if (typeof Translator === 'undefined') {
    statusEl.textContent = 'Translator API not available — requires Chrome 138+';
    statusEl.className = 'status error';
    return;
  }
  try {
    const canTranslate = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
    if (canTranslate === 'available') {
      statusEl.textContent = 'Translation model ready';
      statusEl.className = 'status ok';
    } else if (canTranslate === 'downloadable') {
      statusEl.textContent = 'Model will download on first use';
      statusEl.className = 'status warn';
    } else {
      statusEl.textContent = `Language pair not supported (${canTranslate})`;
      statusEl.className = 'status error';
    }
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.className = 'status error';
  }
}

sourceEl.addEventListener('change', save);
targetEl.addEventListener('change', save);
for (const r of modeRadios) r.addEventListener('change', save);
