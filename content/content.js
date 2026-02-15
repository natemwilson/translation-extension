(() => {
  'use strict';

  // ─── Settings ────────────────────────────────────────────────────
  let settings = {
    sourceLang: 'es',
    targetLang: 'en',
    triggerMode: 'modifier',
  };

  function loadSettings() {
    chrome.storage.local.get('settings', ({ settings: s }) => {
      if (s) updateSettings(s);
    });
  }

  function updateSettings(s) {
    const langChanged = s.sourceLang !== settings.sourceLang || s.targetLang !== settings.targetLang;
    settings = s;
    if (langChanged) {
      cache.clear();
      translator = null;
    }
  }

  loadSettings();
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'settingsUpdated') updateSettings(msg.settings);
  });

  // ─── LRU Cache ───────────────────────────────────────────────────
  class LRUCache {
    constructor(max = 500) {
      this.max = max;
      this.map = new Map();
    }
    get(key) {
      if (!this.map.has(key)) return undefined;
      const val = this.map.get(key);
      // refresh position
      this.map.delete(key);
      this.map.set(key, val);
      return val;
    }
    set(key, val) {
      if (this.map.has(key)) this.map.delete(key);
      this.map.set(key, val);
      if (this.map.size > this.max) {
        this.map.delete(this.map.keys().next().value);
      }
    }
    clear() { this.map.clear(); }
  }

  const cache = new LRUCache(500);

  // ─── Translator Manager ──────────────────────────────────────────
  let translator = null;
  let translatorCreating = false;
  let banner = null;

  async function getTranslator() {
    if (translator) return translator;
    if (translatorCreating) {
      // Wait for the in-progress creation
      return new Promise((resolve) => {
        const id = setInterval(() => {
          if (translator) { clearInterval(id); resolve(translator); }
        }, 100);
      });
    }
    translatorCreating = true;
    try {
      if (typeof Translator === 'undefined') {
        // Try page-context fallback
        showBanner('Translator API not available — requires Chrome 138+');
        translatorCreating = false;
        return null;
      }
      translator = await Translator.create({
        sourceLanguage: settings.sourceLang,
        targetLanguage: settings.targetLang,
      });
      hideBanner();
      translatorCreating = false;
      return translator;
    } catch (e) {
      translatorCreating = false;
      if (e.name === 'NotAllowedError') {
        showBanner('Click anywhere to activate translator');
        return null;
      }
      showBanner('Translator error: ' + e.message);
      return null;
    }
  }

  async function translate(text) {
    const trimmed = text.trim();
    if (!trimmed) return text;
    const cached = cache.get(trimmed);
    if (cached) return cached;
    const t = await getTranslator();
    if (!t) return null;
    const result = await t.translate(trimmed);
    cache.set(trimmed, result);
    return result;
  }

  // ─── Banner ──────────────────────────────────────────────────────
  function showBanner(msg) {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'll-banner';
      document.documentElement.appendChild(banner);
      banner.addEventListener('click', async () => {
        hideBanner();
        translator = null;
        translatorCreating = false;
        await getTranslator();
      });
    }
    banner.textContent = msg;
    banner.classList.remove('hidden');
  }

  function hideBanner() {
    if (banner) banner.classList.add('hidden');
  }

  // ─── Segmenters ──────────────────────────────────────────────────
  function wordSegmenter() {
    return new Intl.Segmenter(settings.sourceLang, { granularity: 'word' });
  }

  function sentenceSegmenter() {
    return new Intl.Segmenter(settings.sourceLang, { granularity: 'sentence' });
  }

  // ─── DOM Helpers ─────────────────────────────────────────────────
  const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG']);
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3',
    'H4', 'H5', 'H6', 'ARTICLE', 'SECTION', 'HEADER', 'FOOTER', 'MAIN', 'DD', 'DT', 'FIGCAPTION',
  ]);

  function shouldSkip(node) {
    if (!node) return true;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.closest('.ll-translated, .ll-banner')) return true;
    return false;
  }

  function getBlockAncestor(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && !BLOCK_TAGS.has(el.tagName) && el !== document.body) {
      el = el.parentElement;
    }
    return el || document.body;
  }

  function getTextNodesIn(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // ─── Word Under Cursor ──────────────────────────────────────────
  function getWordAtPoint(x, y) {
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return null;
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return null;
    if (shouldSkip(textNode)) return null;

    const text = textNode.textContent;
    const offset = range.startOffset;
    const seg = wordSegmenter();
    const segments = [...seg.segment(text)];
    for (const s of segments) {
      if (!s.isWordLike) continue;
      const start = s.index;
      const end = start + s.segment.length;
      if (offset >= start && offset < end) {
        return { textNode, start, end, text: s.segment };
      }
    }
    return null;
  }

  // ─── Sentence Under Cursor ──────────────────────────────────────
  function getSentenceAtPoint(x, y) {
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return null;
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return null;
    if (shouldSkip(textNode)) return null;

    const block = getBlockAncestor(textNode);
    const textNodes = getTextNodesIn(block);
    if (textNodes.length === 0) return null;

    // Build concatenated text with offset map
    let fullText = '';
    const nodeMap = []; // { node, startInFull, endInFull }
    for (const tn of textNodes) {
      const start = fullText.length;
      fullText += tn.textContent;
      nodeMap.push({ node: tn, startInFull: start, endInFull: fullText.length });
    }

    // Find cursor offset in full text
    const cursorNodeEntry = nodeMap.find(e => e.node === textNode);
    if (!cursorNodeEntry) return null;
    const cursorInFull = cursorNodeEntry.startInFull + range.startOffset;

    // Segment into sentences
    const seg = sentenceSegmenter();
    const sentences = [...seg.segment(fullText)];
    let sentenceSegment = null;
    for (const s of sentences) {
      const start = s.index;
      const end = start + s.segment.length;
      if (cursorInFull >= start && cursorInFull < end) {
        sentenceSegment = { start, end, text: s.segment };
        break;
      }
    }
    if (!sentenceSegment) return null;

    // Map sentence range back to text nodes
    const affected = [];
    for (const entry of nodeMap) {
      const overlapStart = Math.max(sentenceSegment.start, entry.startInFull);
      const overlapEnd = Math.min(sentenceSegment.end, entry.endInFull);
      if (overlapStart < overlapEnd) {
        affected.push({
          node: entry.node,
          localStart: overlapStart - entry.startInFull,
          localEnd: overlapEnd - entry.startInFull,
        });
      }
    }

    return { text: sentenceSegment.text, affected };
  }

  // ─── Inline Replacer ────────────────────────────────────────────
  let activeReplacement = null;

  function revertActive() {
    if (!activeReplacement) return;
    const r = activeReplacement;
    activeReplacement = null;

    if (r.type === 'word') {
      revertWord(r);
    } else {
      revertSentence(r);
    }
  }

  function replaceWord(info, translated) {
    const { textNode, start, end } = info;

    // Split the text node to isolate the word
    const before = textNode.textContent.substring(0, start);
    const after = textNode.textContent.substring(end);
    const parent = textNode.parentNode;

    const span = document.createElement('span');
    span.className = 'll-translated';
    span.textContent = translated;

    const beforeNode = document.createTextNode(before);
    const afterNode = document.createTextNode(after);

    parent.insertBefore(beforeNode, textNode);
    parent.insertBefore(span, textNode);
    parent.insertBefore(afterNode, textNode);
    parent.removeChild(textNode);

    activeReplacement = {
      type: 'word',
      span,
      beforeNode,
      afterNode,
      originalText: before + info.text + after,
      parent,
    };
  }

  function revertWord(r) {
    const { span, beforeNode, afterNode, originalText, parent } = r;
    if (!span.parentNode) return; // already reverted
    const restored = document.createTextNode(originalText);
    parent.insertBefore(restored, beforeNode);
    parent.removeChild(beforeNode);
    parent.removeChild(span);
    parent.removeChild(afterNode);
    parent.normalize();
  }

  function replaceSentence(info, translated) {
    const { affected } = info;

    // Save original content
    const saved = affected.map(a => ({
      node: a.node,
      original: a.node.textContent,
      localStart: a.localStart,
      localEnd: a.localEnd,
    }));

    // Insert translated span at the position of the first affected node
    const firstNode = affected[0].node;
    const span = document.createElement('span');
    span.className = 'll-translated';
    span.textContent = translated;

    // For the first node, keep text before the sentence start
    const beforeText = firstNode.textContent.substring(0, affected[0].localStart);
    // For the last node, keep text after the sentence end
    const lastEntry = affected[affected.length - 1];
    const afterText = lastEntry.node.textContent.substring(lastEntry.localEnd);

    // Clear sentence portions from all affected nodes
    for (let i = 0; i < affected.length; i++) {
      const a = affected[i];
      if (i === 0 && i === affected.length - 1) {
        a.node.textContent = beforeText;
      } else if (i === 0) {
        a.node.textContent = beforeText;
      } else if (i === affected.length - 1) {
        a.node.textContent = afterText;
      } else {
        a.node.textContent = '';
      }
    }

    // Insert span after the first text node
    firstNode.parentNode.insertBefore(span, firstNode.nextSibling);

    // Track extra nodes we create so revert can remove them
    const createdNodes = [];

    // If last node is different from first, afterText is already set on last node.
    // For single node, we need a separate text node for the after-text.
    if (affected.length === 1 && afterText) {
      const afterNode = document.createTextNode(afterText);
      span.parentNode.insertBefore(afterNode, span.nextSibling);
      createdNodes.push(afterNode);
    }

    activeReplacement = { type: 'sentence', span, saved, createdNodes };
  }

  function revertSentence(r) {
    const { span, saved, createdNodes } = r;
    if (!span.parentNode) return;

    // Remove any extra nodes we created
    for (const n of createdNodes) {
      if (n.parentNode) n.parentNode.removeChild(n);
    }

    // Remove the translated span
    span.parentNode.removeChild(span);

    // Restore all saved node contents
    for (const s of saved) {
      s.node.textContent = s.original;
    }

    // Normalize to merge adjacent text nodes
    saved[0].node.parentNode.normalize();
  }

  // ─── Modifier Key Tracking ──────────────────────────────────────
  let altDown = false;
  let metaDown = false;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') altDown = true;
    if (e.key === 'Meta') metaDown = true;
    // Trigger translation at current cursor position when modifier pressed
    if (e.key === 'Alt' || e.key === 'Meta') {
      currentKey = null;
      handleMove(lastMouseX, lastMouseY);
    }
  }, true);

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') altDown = false;
    if (e.key === 'Meta') metaDown = false;
    // Revert translations when modifier released in modifier mode
    if (settings.triggerMode === 'modifier') {
      revertActive();
    }
  }, true);

  window.addEventListener('blur', () => {
    altDown = false;
    metaDown = false;
    revertActive();
  });

  // ─── Hover Controller ───────────────────────────────────────────
  let currentKey = null;
  let debounceTimer = null;
  let lastMouseX = 0;
  let lastMouseY = 0;

  function getGranularity() {
    const mode = settings.triggerMode;
    if (mode === 'word-hover') return 'word';
    if (mode === 'sentence-hover') return 'sentence';
    // modifier mode
    if (altDown && metaDown) return 'sentence';
    if (altDown) return 'word';
    return null; // no modifier held
  }

  async function handleMove(x, y) {
    const granularity = getGranularity();
    if (!granularity) {
      revertActive();
      currentKey = null;
      return;
    }

    // If cursor is over the active translated span, keep it — don't oscillate
    if (activeReplacement) {
      const el = document.elementFromPoint(x, y);
      if (el && (el === activeReplacement.span || activeReplacement.span.contains(el))) {
        return;
      }
    }

    // Revert BEFORE querying the DOM so we get clean text node references
    revertActive();

    let info, key;
    if (granularity === 'word') {
      info = getWordAtPoint(x, y);
      if (!info) { currentKey = null; return; }
      key = `w:${info.textNode.textContent}:${info.start}`;
    } else {
      info = getSentenceAtPoint(x, y);
      if (!info) { currentKey = null; return; }
      key = `s:${info.text.substring(0, 60)}`;
    }

    if (key === currentKey) return;
    currentKey = key;

    const translated = await translate(info.text);
    if (!translated) return;
    // Check key hasn't changed while awaiting
    if (key !== currentKey) return;

    if (granularity === 'word') {
      replaceWord(info, translated);
    } else {
      replaceSentence(info, translated);
    }
  }

  document.addEventListener('mousemove', (e) => {
    // Update modifier state from event as fallback
    altDown = e.altKey;
    metaDown = e.metaKey;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => handleMove(e.clientX, e.clientY), 80);
  }, { passive: true });

  document.addEventListener('mouseleave', () => {
    revertActive();
    currentKey = null;
  });

})();
