(() => {
  const inputFormatChips = document.getElementById('inputFormatChips');
  const outputFormatChips = document.getElementById('outputFormatChips');
  const inputTextarea = document.getElementById('inputTextarea');
  const inputStatus = document.getElementById('inputStatus');
  const outputStatus = document.getElementById('outputStatus');
  const outputDisplay = document.getElementById('outputDisplay');
  const progressFill = document.getElementById('progressFill');
  const btnPaste = document.getElementById('btnPaste');
  const btnClear = document.getElementById('btnClear');
  const btnSample = document.getElementById('btnSample');
  const themeToggle = document.getElementById('themeToggle');

  const base64Toggle = document.getElementById('base64Toggle');
  const base64Input = document.getElementById('base64Input');
  const base64ResultDisplay = document.getElementById('base64ResultDisplay');
  const base64Status = document.getElementById('base64Status');
  const btnBase64Convert = document.getElementById('btnBase64Convert');
  const btnBase64Clear = document.getElementById('btnBase64Clear');

  const root = document.documentElement;

  let currentInputFormat = 'binary';
  let currentOutputFormat = 'binary';
  let conversionResults = { binary: '', hex: '', decimal: '', text: '' };
  let currentJobId = 0;
  let worker = null;
  let workerReady = false;
  let inputDebounce = null;
  let themeMode = 'system';

  function setStatus(el, msg, type) {
    el.textContent = msg;
    el.className = 'status-msg status-msg--' + type;
  }

  function setProgress(pct) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    progressFill.style.width = clamped + '%';
  }

  function resetProgress() {
    setProgress(0);
  }

  function updateOutputDisplay() {
    const value = conversionResults[currentOutputFormat] || '';
    outputDisplay.textContent = value;
    outputDisplay.classList.remove('output-display-box--empty', 'output-display-box--error');
    if (!value) {
      outputDisplay.textContent = '—';
      outputDisplay.classList.add('output-display-box--empty');
    } else if (String(value).startsWith('Error:')) {
      outputDisplay.classList.add('output-display-box--error');
    }
  }

  function resetOutputs() {
    conversionResults = { binary: '', hex: '', decimal: '', text: '' };
    outputDisplay.textContent = '—';
    outputDisplay.classList.add('output-display-box--empty');
    outputDisplay.classList.remove('output-display-box--error');
    resetProgress();
  }

  function setAllOutputError(msg) {
    const err = 'Error: ' + msg;
    conversionResults = { binary: err, hex: err, decimal: err, text: err };
    updateOutputDisplay();
    outputDisplay.classList.add('output-display-box--error');
    resetProgress();
  }

  function setChipActive(container, format, activeClass) {
    container.querySelectorAll('.chip, .toggle-pill button').forEach(btn => {
      const isActive = btn.dataset.format === format || btn.dataset.mode === format;
      btn.classList.toggle(activeClass, isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function queueConvert(immediate = false) {
    clearTimeout(inputDebounce);
    const delay = immediate ? 0 : 180;
    inputDebounce = setTimeout(handleConversion, delay);
  }

  function validateInput(input, format) {
    const trimmed = input.trim();
    if (!trimmed) return { valid: false, empty: true };

    const patterns = {
      binary: /^[01\s]+$/,
      hex: /^[0-9A-Fa-f\s]+$/,
      decimal: /^[0-9\s]+$/,
      text: /^.*$/s
    };

    if (!patterns[format].test(trimmed)) {
      const messages = {
        binary: 'Binary: only 0 and 1 allowed',
        hex: 'Hex: only 0-9 and A-F allowed',
        decimal: 'Decimal: only digits 0-9 allowed',
        text: ''
      };
      return { valid: false, message: messages[format] || 'Invalid input' };
    }

    return { valid: true };
  }

  function normalizePlaceholder(format) {
    const placeholders = {
      binary: 'Enter binary digits… (e.g. 01001000 01101001)',
      hex: 'Enter hex values… (e.g. 48 65 6C 6C 6F)',
      decimal: 'Enter decimal numbers… (e.g. 72 101 108 108 111)',
      text: 'Enter text… (e.g. Hello 🌍)'
    };
    inputTextarea.placeholder = placeholders[format] || 'Paste text or numbers to begin…';
  }

  function buildWorker() {
    const workerSource = `
      let latestJobId = 0;

      self.onmessage = async (e) => {
        const msg = e.data || {};
        if (msg.type === 'convert') {
          latestJobId = msg.jobId;
          try {
            await streamConvert(msg);
          } catch (err) {
            if (msg.jobId === latestJobId) {
              self.postMessage({ type: 'error', jobId: msg.jobId, error: err && err.message ? err.message : String(err) });
            }
          }
        } else if (msg.type === 'cancel') {
          latestJobId = msg.jobId;
        }
      };

      const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

      async function streamConvert({ jobId, input, format }) {
        const chunks = makeChunks(input, format);
        const total = chunks.length || 1;
        const parts = { binary: [], hex: [], decimal: [], text: [] };
        let reportEvery = Math.max(1, Math.floor(total / 100));
        let textDecoder = new TextDecoder('utf-8', { fatal: false });

        for (let i = 0; i < total; i++) {
          if (jobId !== latestJobId) return;

          const chunk = chunks[i];
          const partial = convertChunk(chunk, format);

          if (partial.binary) parts.binary.push(partial.binary);
          if (partial.hex) parts.hex.push(partial.hex);
          if (partial.decimal) parts.decimal.push(partial.decimal);
          if (partial.textChunkBytes) {
            parts.text.push(textDecoder.decode(partial.textChunkBytes, { stream: true }));
          } else if (partial.text !== undefined) {
            parts.text.push(partial.text);
          }

          const shouldReport = i === total - 1 || (i % reportEvery === 0);

          if (shouldReport) {
            const progress = Math.round(((i + 1) / total) * 100);
            self.postMessage({
              type: 'progress',
              jobId,
              progress,
              partial: {
                binary: joinOutput(parts.binary),
                hex: joinOutput(parts.hex),
                decimal: joinOutput(parts.decimal),
                text: parts.text.join('')
              }
            });
            await yieldToEventLoop();
          }
        }

        const result = {
          binary: joinOutput(parts.binary),
          hex: joinOutput(parts.hex),
          decimal: joinOutput(parts.decimal),
          text: parts.text.join('') + textDecoder.decode()
        };

        if (jobId === latestJobId) {
          self.postMessage({ type: 'done', jobId, result });
        }
      }

      function joinOutput(parts) {
        return parts.join('');
      }

      function yieldToEventLoop() {
        return new Promise(resolve => setTimeout(resolve, 0));
      }

      function isWhitespaceChar(ch) {
        return /\\s/.test(ch);
      }

      function makeChunks(input, format) {
        const trimmed = String(input).trim();

        if (format === 'text') {
          const bytes = new TextEncoder().encode(trimmed);
          const size = bytes.length > 8192 ? 4096 : 1024;
          const chunks = [];
          for (let i = 0; i < bytes.length; i += size) {
            chunks.push(bytes.slice(i, i + size));
          }
          return chunks.length ? chunks : [new Uint8Array()];
        }

        const hasWhitespace = /\\s/.test(trimmed);

        if (format === 'binary') {
          const compact = trimmed.replace(/\\s+/g, '');
          if (!hasWhitespace && compact.length % 8 === 0 && compact.length > 8) {
            const bytes = [];
            for (let i = 0; i < compact.length; i += 8) {
              bytes.push(parseInt(compact.slice(i, i + 8), 2));
            }
            return bytes.map(v => ({ kind: 'byte', value: v }));
          }
          if (hasWhitespace) {
            return trimmed.split(/\\s+/).filter(Boolean).map(t => ({ kind: 'token', value: t }));
          }
          return [{ kind: 'bigint', value: compact }];
        }

        if (format === 'hex') {
          const compact = trimmed.replace(/\\s+/g, '');
          if (!hasWhitespace && compact.length % 2 === 0 && compact.length > 2) {
            const bytes = [];
            for (let i = 0; i < compact.length; i += 2) {
              bytes.push(parseInt(compact.slice(i, i + 2), 16));
            }
            return bytes.map(v => ({ kind: 'byte', value: v }));
          }
          if (hasWhitespace) {
            return trimmed.split(/\\s+/).filter(Boolean).map(t => ({ kind: 'token', value: t }));
          }
          return [{ kind: 'bigint', value: compact }];
        }

        if (format === 'decimal') {
          if (hasWhitespace) {
            return trimmed.split(/\\s+/).filter(Boolean).map(t => ({ kind: 'token', value: t }));
          }
          return [{ kind: 'bigint', value: trimmed }];
        }

        return [];
      }

      function convertChunk(chunk, format) {
        if (format === 'text') {
          const bytes = chunk;
          return {
            binary: bytesToBinary(bytes),
            hex: bytesToHex(bytes),
            decimal: bytesToDecimal(bytes),
            textChunkBytes: bytes
          };
        }

        if (format === 'binary') {
          if (chunk.kind === 'byte') {
            const value = chunk.value >>> 0;
            return {
              binary: padBinary(value, 8) + ' ',
              hex: padHex(value, 2) + ' ',
              decimal: String(value) + ' ',
              textChunkBytes: new Uint8Array([value])
            };
          }

          if (chunk.kind === 'token') {
            const bits = chunk.value.replace(/\\s+/g, '');
            const value = parseBigIntSafe('0b' + bits);
            const textBytes = tokenToTextBytes(bits, 'binary');
            return {
              binary: normalizeBinary(bits) + ' ',
              hex: valueToHex(value) + ' ',
              decimal: value.toString(10) + ' ',
              textChunkBytes: textBytes
            };
          }

          if (chunk.kind === 'bigint') {
            const bits = chunk.value.replace(/\\s+/g, '');
            const value = parseBigIntSafe('0b' + bits);
            const bytes = bigIntToBytes(value);
            return {
              binary: normalizeBinary(bits),
              hex: value.toString(16).toUpperCase(),
              decimal: value.toString(10),
              textChunkBytes: bytes
            };
          }
        }

        if (format === 'hex') {
          if (chunk.kind === 'byte') {
            const value = chunk.value >>> 0;
            return {
              binary: padBinary(value, 8) + ' ',
              hex: padHex(value, 2) + ' ',
              decimal: String(value) + ' ',
              textChunkBytes: new Uint8Array([value])
            };
          }

          if (chunk.kind === 'token') {
            const clean = chunk.value.replace(/\\s+/g, '');
            const value = parseBigIntSafe('0x' + clean);
            const textBytes = tokenToTextBytes(clean, 'hex');
            return {
              binary: value.toString(2) + ' ',
              hex: normalizeHex(clean) + ' ',
              decimal: value.toString(10) + ' ',
              textChunkBytes: textBytes
            };
          }

          if (chunk.kind === 'bigint') {
            const clean = chunk.value.replace(/\\s+/g, '');
            const value = parseBigIntSafe('0x' + clean);
            const bytes = bigIntToBytes(value);
            return {
              binary: value.toString(2),
              hex: normalizeHex(clean),
              decimal: value.toString(10),
              textChunkBytes: bytes
            };
          }
        }

        if (format === 'decimal') {
          if (chunk.kind === 'token') {
            const raw = chunk.value.trim();
            const value = parseBigIntSafe(raw);
            const num = Number(value);
            const text = decimalTokenToText(raw);
            return {
              binary: value.toString(2) + ' ',
              hex: value.toString(16).toUpperCase() + ' ',
              decimal: normalizeDecimal(raw) + ' ',
              text: text
            };
          }

          if (chunk.kind === 'bigint') {
            const raw = chunk.value.trim();
            const value = parseBigIntSafe(raw);
            const text = decimalBigToText(value);
            return {
              binary: value.toString(2),
              hex: value.toString(16).toUpperCase(),
              decimal: normalizeDecimal(raw),
              text: text
            };
          }
        }

        return { binary: '', hex: '', decimal: '', text: '' };
      }

      function tokenToTextBytes(token, mode) {
        if (mode === 'binary') {
          if (token.length % 8 !== 0) {
            return bigIntToBytes(parseBigIntSafe('0b' + token));
          }
          const bytes = [];
          for (let i = 0; i < token.length; i += 8) {
            bytes.push(parseInt(token.slice(i, i + 8), 2));
          }
          return new Uint8Array(bytes);
        }

        if (mode === 'hex') {
          if (token.length % 2 !== 0) {
            return bigIntToBytes(parseBigIntSafe('0x' + token));
          }
          const bytes = [];
          for (let i = 0; i < token.length; i += 2) {
            bytes.push(parseInt(token.slice(i, i + 2), 16));
          }
          return new Uint8Array(bytes);
        }

        return new Uint8Array();
      }

      function decimalTokenToText(token) {
        const n = Number(token);
        if (Number.isFinite(n) && Number.isInteger(n)) {
          if (n >= 0 && n <= 255) {
            return utf8Decoder.decode(new Uint8Array([n]));
          }
          if (n >= 0 && n <= 0x10FFFF && !isSurrogate(n)) {
            try {
              return String.fromCodePoint(n);
            } catch (e) {}
          }
        }
        const big = parseBigIntSafe(token);
        return utf8Decoder.decode(bigIntToBytes(big));
      }

      function decimalBigToText(big) {
        if (big <= 255n) {
          return utf8Decoder.decode(new Uint8Array([Number(big)]));
        }
        if (big <= 0x10ffffn && !isSurrogateBig(big)) {
          try {
            return String.fromCodePoint(Number(big));
          } catch (e) {}
        }
        return utf8Decoder.decode(bigIntToBytes(big));
      }

      function normalizeBinary(bits) {
        return bits.replace(/\\s+/g, '').replace(/^0+(?=\\d)/, '') || '0';
      }

      function normalizeHex(hex) {
        const clean = hex.replace(/\\s+/g, '').toUpperCase().replace(/^0+(?=[0-9A-F])/, '');
        return clean || '0';
      }

      function normalizeDecimal(dec) {
        const clean = dec.replace(/\\s+/g, '').replace(/^0+(?=\\d)/, '');
        return clean || '0';
      }

      function valueToHex(value) {
        return value.toString(16).toUpperCase();
      }

      function bytesToBinary(bytes) {
        return Array.from(bytes, b => padBinary(b, 8)).join(' ');
      }

      function bytesToHex(bytes) {
        return Array.from(bytes, b => padHex(b, 2)).join(' ');
      }

      function bytesToDecimal(bytes) {
        return Array.from(bytes, b => String(b)).join(' ');
      }

      function padBinary(n, len) {
        return n.toString(2).padStart(len, '0');
      }

      function padHex(n, len) {
        return n.toString(16).toUpperCase().padStart(len, '0');
      }

      function parseBigIntSafe(raw) {
        const s = String(raw).trim();
        if (!s) return 0n;
        if (s.startsWith('0b') || s.startsWith('0B')) return BigInt(s);
        if (s.startsWith('0x') || s.startsWith('0X')) return BigInt(s);
        return BigInt(s);
      }

      function bigIntToBytes(big) {
        let n = big;
        if (n < 0n) n = -n;
        if (n === 0n) return new Uint8Array([0]);
        const bytes = [];
        while (n > 0n) {
          bytes.push(Number(n & 255n));
          n >>= 8n;
        }
        bytes.reverse();
        return new Uint8Array(bytes);
      }

      function isSurrogate(n) {
        return n >= 0xD800 && n <= 0xDFFF;
      }

      function isSurrogateBig(n) {
        return n >= 0xD800n && n <= 0xDFFFn;
      }
    `;

    const blob = new Blob([workerSource], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }

  function ensureWorker() {
    if (!worker) {
      worker = buildWorker();
      worker.onmessage = handleWorkerMessage;
      worker.onerror = (err) => {
        setAllOutputError(err.message || 'Worker failed');
        setStatus(inputStatus, 'Worker error', 'err');
        setStatus(outputStatus, 'Cannot convert', 'err');
      };
      workerReady = true;
    }
  }

  function handleWorkerMessage(e) {
    const data = e.data || {};
    if (data.jobId !== currentJobId) return;

    if (data.type === 'progress') {
      conversionResults = data.partial || conversionResults;
      updateOutputDisplay();
      setProgress(data.progress || 0);
      setStatus(inputStatus, 'Input OK', 'ok');
      setStatus(outputStatus, 'Processing ' + (data.progress || 0) + '%', 'empty');
      return;
    }

    if (data.type === 'done') {
      conversionResults = data.result || conversionResults;
      updateOutputDisplay();
      setProgress(100);
      setStatus(inputStatus, 'Input OK', 'ok');
      setStatus(outputStatus, 'Conversion complete', 'ok');
      return;
    }

    if (data.type === 'error') {
      setAllOutputError(data.error || 'Unknown error');
      setStatus(inputStatus, 'Invalid format detected', 'err');
      setStatus(outputStatus, 'Cannot convert — check input', 'err');
    }
  }

  function handleConversion() {
    const rawInput = inputTextarea.value;

    if (!rawInput.trim()) {
      resetOutputs();
      setStatus(inputStatus, 'Awaiting input', 'empty');
      setStatus(outputStatus, 'Ready', 'empty');
      return;
    }

    const validation = validateInput(rawInput, currentInputFormat);
    if (!validation.valid) {
      if (validation.empty) {
        resetOutputs();
        setStatus(inputStatus, 'Awaiting input', 'empty');
        setStatus(outputStatus, 'Ready', 'empty');
      } else {
        setAllOutputError(validation.message);
        setStatus(inputStatus, 'Invalid format detected', 'err');
        setStatus(outputStatus, 'Cannot convert — check input', 'err');
      }
      return;
    }

    setStatus(inputStatus, 'Processing…', 'empty');
    setStatus(outputStatus, 'Working…', 'empty');
    setProgress(0);
    updateOutputDisplay();

    ensureWorker();
    currentJobId += 1;

    worker.postMessage({
      type: 'convert',
      jobId: currentJobId,
      input: rawInput,
      format: currentInputFormat
    });
  }

  function copyTextToClipboard(text) {
    if (!text || text === '—' || String(text).startsWith('Error:')) return Promise.resolve(false);

    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(String(text)).then(() => true).catch(() => fallbackCopy(String(text)));
    }
    return fallbackCopy(String(text));
  }

  function fallbackCopy(text) {
    return new Promise((resolve) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      textarea.style.width = '1px';
      textarea.style.height = '1px';
      textarea.style.border = '0';
      textarea.style.padding = '0';
      textarea.style.margin = '0';

      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      let success = false;
      try {
        success = document.execCommand('copy');
      } catch (e) {
        success = false;
      }

      document.body.removeChild(textarea);
      resolve(success);
    });
  }

  function handleCopyButtonClick(copyBtn, targetId) {
    const targetEl = document.getElementById(targetId);
    if (!targetEl) return;
    const textToCopy = targetEl.textContent;
    if (!textToCopy || textToCopy === '—' || String(textToCopy).startsWith('Error:')) return;

    if (!copyBtn.dataset.originalText) {
      copyBtn.dataset.originalText = copyBtn.textContent;
    }

    copyTextToClipboard(textToCopy).then((ok) => {
      if (!ok) {
        copyBtn.textContent = 'Failed';
        setTimeout(() => {
          copyBtn.textContent = copyBtn.dataset.originalText || 'Copy';
        }, 1200);
        return;
      }

      copyBtn.classList.add('btn-copy--copied');
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => {
        copyBtn.classList.remove('btn-copy--copied');
        copyBtn.textContent = copyBtn.dataset.originalText || 'Copy';
      }, 1500);
    });
  }

  function toUtf8Bytes(text) {
    return new TextEncoder().encode(text);
  }

  function utf8BytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function base64ToUtf8Text(base64) {
    const clean = String(base64).replace(/\s+/g, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function encodeBase64(text) {
    return utf8BytesToBase64(toUtf8Bytes(text));
  }

  function decodeBase64(text) {
    return base64ToUtf8Text(text);
  }

  function handleBase64Convert() {
    const input = base64Input.value.trim();
    if (!input) {
      base64ResultDisplay.textContent = '—';
      base64ResultDisplay.classList.add('output-display-box--empty');
      base64ResultDisplay.classList.remove('output-display-box--error');
      setStatus(base64Status, 'No input provided', 'empty');
      return;
    }

    const mode = base64Toggle.querySelector('.active-toggle')?.dataset.mode || 'encode';
    try {
      const result = mode === 'encode' ? encodeBase64(input) : decodeBase64(input);
      base64ResultDisplay.textContent = result;
      base64ResultDisplay.classList.remove('output-display-box--empty', 'output-display-box--error');
      setStatus(base64Status, mode === 'encode' ? 'Encoding complete' : 'Decoding complete', 'ok');
    } catch (err) {
      base64ResultDisplay.textContent = 'Error: Invalid input';
      base64ResultDisplay.classList.remove('output-display-box--empty');
      base64ResultDisplay.classList.add('output-display-box--error');
      setStatus(base64Status, 'Invalid format detected', 'err');
    }
  }

  function setTheme(mode) {
    themeMode = mode;
    if (mode === 'light') {
      root.setAttribute('data-theme', 'light');
      themeToggle.textContent = 'Theme: Light';
      themeToggle.setAttribute('aria-pressed', 'false');
    } else if (mode === 'dark') {
      root.setAttribute('data-theme', 'dark');
      themeToggle.textContent = 'Theme: Dark';
      themeToggle.setAttribute('aria-pressed', 'true');
    } else {
      root.setAttribute('data-theme', 'light');
      themeToggle.textContent = 'Theme: Auto';
      themeToggle.setAttribute('aria-pressed', 'false');
      applySystemTheme(true);
    }
    localStorage.setItem('devconvert-theme', mode);
  }

  function applySystemTheme(fromSet = false) {
    const saved = localStorage.getItem('devconvert-theme') || 'system';
    if (saved !== 'system' && !fromSet) return;
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  function initTheme() {
    const saved = localStorage.getItem('devconvert-theme') || 'system';
    themeMode = saved;
    if (saved === 'dark' || saved === 'light') {
      root.setAttribute('data-theme', saved);
      themeToggle.textContent = 'Theme: ' + saved.charAt(0).toUpperCase() + saved.slice(1);
      themeToggle.setAttribute('aria-pressed', saved === 'dark' ? 'true' : 'false');
    } else {
      applySystemTheme(true);
      themeToggle.textContent = 'Theme: Auto';
      themeToggle.setAttribute('aria-pressed', 'false');
    }

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if ((localStorage.getItem('devconvert-theme') || 'system') === 'system') {
          root.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  function cycleTheme() {
    const current = localStorage.getItem('devconvert-theme') || 'system';
    const next = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
    setTheme(next);
  }

  inputFormatChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const format = chip.dataset.format;
    if (!format) return;
    currentInputFormat = format;
    inputFormatChips.querySelectorAll('.chip').forEach(btn => {
      const active = btn.dataset.format === format;
      btn.classList.toggle('chip--active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    normalizePlaceholder(format);
    queueConvert(true);
  });

  outputFormatChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const format = chip.dataset.format;
    if (!format) return;
    currentOutputFormat = format;
    outputFormatChips.querySelectorAll('.chip').forEach(btn => {
      const active = btn.dataset.format === format;
      btn.classList.toggle('chip--active-output', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    updateOutputDisplay();
  });

  base64Toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !btn.dataset.mode) return;
    base64Toggle.querySelectorAll('button').forEach(b => {
      const active = b === btn;
      b.classList.toggle('active-toggle', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    base64Input.placeholder = btn.dataset.mode === 'encode'
      ? 'Enter text to encode to Base64…'
      : 'Enter Base64 string to decode…';
    base64ResultDisplay.textContent = '—';
    base64ResultDisplay.classList.add('output-display-box--empty');
    base64ResultDisplay.classList.remove('output-display-box--error');
    setStatus(base64Status, 'Ready', 'empty');
  });

  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.btn-copy');
    if (!copyBtn) return;
    const targetId = copyBtn.dataset.target;
    if (targetId) handleCopyButtonClick(copyBtn, targetId);
  });

  inputTextarea.addEventListener('input', () => queueConvert(false));
  inputTextarea.addEventListener('paste', () => setTimeout(() => queueConvert(true), 0));

  btnClear.addEventListener('click', () => {
    inputTextarea.value = '';
    resetOutputs();
    setStatus(inputStatus, 'Awaiting input', 'empty');
    setStatus(outputStatus, 'Ready', 'empty');
    inputTextarea.focus();
  });

  btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        inputTextarea.value = text;
        queueConvert(true);
        setStatus(inputStatus, 'Pasted from clipboard', 'ok');
      }
    } catch (err) {
      setStatus(inputStatus, 'Clipboard access denied', 'err');
    }
  });

  btnSample.addEventListener('click', () => {
    const samples = {
      binary: '01001000 01100101 01101100 01101100 01101111',
      hex: '48 65 6C 6C 6F',
      decimal: '72 101 108 108 111',
      text: 'Hello 🌍'
    };
    inputTextarea.value = samples[currentInputFormat] || 'Hello';
    queueConvert(true);
    setStatus(inputStatus, 'Sample loaded', 'ok');
  });

  btnBase64Convert.addEventListener('click', handleBase64Convert);
  btnBase64Clear.addEventListener('click', () => {
    base64Input.value = '';
    base64ResultDisplay.textContent = '—';
    base64ResultDisplay.classList.add('output-display-box--empty');
    base64ResultDisplay.classList.remove('output-display-box--error');
    setStatus(base64Status, 'Ready', 'empty');
    base64Input.focus();
  });

  base64Input.addEventListener('input', () => {
    if (base64Input.value.trim() === '') {
      base64ResultDisplay.textContent = '—';
      base64ResultDisplay.classList.add('output-display-box--empty');
      base64ResultDisplay.classList.remove('output-display-box--error');
      setStatus(base64Status, 'Ready', 'empty');
    }
  });

  themeToggle.addEventListener('click', cycleTheme);

  window.addEventListener('beforeunload', () => {
    if (worker) {
      try { worker.terminate(); } catch (e) {}
    }
  });

  normalizePlaceholder('binary');
  initTheme();
  resetOutputs();
  setStatus(inputStatus, 'Awaiting input', 'empty');
  setStatus(outputStatus, 'Ready', 'empty');
  setStatus(base64Status, 'Ready', 'empty');
  base64ResultDisplay.textContent = '—';
  base64ResultDisplay.classList.add('output-display-box--empty');
  inputTextarea.focus({ preventScroll: true });
})();
