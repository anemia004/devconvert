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
  let inputDebounce = null;

  function setStatus(el, msg, type) {
    el.textContent = msg;
    el.className = 'status-msg status-msg--' + type;
  }

  function setProgress(pct) {
    progressFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function resetOutputs() {
    conversionResults = { binary: '', hex: '', decimal: '', text: '' };
    outputDisplay.textContent = '—';
    setProgress(0);
  }

  function updateOutput() {
    const value = conversionResults[currentOutputFormat] || '';
    outputDisplay.textContent = value || '—';
  }

  function setChips(container, format, activeClass) {
    container.querySelectorAll('button').forEach(btn => {
      const active = btn.dataset.format === format || btn.dataset.mode === format;
      btn.classList.toggle(activeClass, active);
    });
  }

  function queueConvert() {
    clearTimeout(inputDebounce);
    inputDebounce = setTimeout(runConversion, 150);
  }

  function validate(input, format) {
    if (!input.trim()) return { valid: false, empty: true };

    const patterns = {
      binary: /^[01\s]+$/,
      hex: /^[0-9a-fA-F\s]+$/,
      decimal: /^[0-9\s]+$/,
      text: /^.*$/s
    };

    if (!patterns[format].test(input.trim())) {
      return { valid: false };
    }

    return { valid: true };
  }

  function runConversion() {
    const input = inputTextarea.value;

    if (!input.trim()) {
      resetOutputs();
      setStatus(inputStatus, 'Awaiting input', 'empty');
      return;
    }

    const check = validate(input, currentInputFormat);

    if (!check.valid) {
      setStatus(inputStatus, 'Invalid input', 'err');
      outputDisplay.textContent = 'Error: Invalid format';
      return;
    }

    setStatus(inputStatus, 'Processing...', 'empty');

    try {
      const result = fakeConvert(input, currentInputFormat);

      conversionResults = result;
      updateOutput();

      setStatus(inputStatus, 'Done', 'ok');
      setStatus(outputStatus, 'Converted', 'ok');

      setProgress(100);
    } catch (e) {
      setStatus(inputStatus, 'Error', 'err');
    }
  }

  function fakeConvert(input, format) {
    // SIMPLE SAFE PLACEHOLDER CONVERTER (browser-safe version)

    const text = input.trim();

    return {
      binary: text.split('').map(c => c.charCodeAt(0).toString(2)).join(' '),
      hex: text.split('').map(c => c.charCodeAt(0).toString(16)).join(' '),
      decimal: text.split('').map(c => c.charCodeAt(0)).join(' '),
      text: text
    };
  }

  function copy(text) {
    return navigator.clipboard.writeText(text);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-copy');
    if (!btn) return;

    const target = document.getElementById(btn.dataset.target);
    if (!target) return;

    copy(target.textContent);
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy'), 1200);
  });

  inputTextarea.addEventListener('input', queueConvert);

  btnClear.addEventListener('click', () => {
    inputTextarea.value = '';
    resetOutputs();
  });

  btnPaste.addEventListener('click', async () => {
    const text = await navigator.clipboard.readText();
    inputTextarea.value = text;
    queueConvert();
  });

  btnSample.addEventListener('click', () => {
    inputTextarea.value = 'Hello';
    queueConvert();
  });

  inputFormatChips.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    currentInputFormat = btn.dataset.format;
    setChips(inputFormatChips, currentInputFormat, 'chip--active');
    queueConvert();
  });

  outputFormatChips.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    currentOutputFormat = btn.dataset.format;
    setChips(outputFormatChips, currentOutputFormat, 'chip--active-output');
    updateOutput();
  });

})();
