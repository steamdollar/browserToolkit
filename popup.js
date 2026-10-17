// 모듈 import
import { base64ToUtf8, utf8ToBase64, isImageBase64, decodeText } from './modules/base64/index.js';
import { sendHttpRequest } from './modules/http/index.js';
import { openImageInNewTab, showResult, switchTab } from './modules/base64/ui.js';
import { SettingsManager } from './modules/settings.js';
import { renderMermaidChart, showMermaidOverlay, MERMAID_EXAMPLES } from './modules/mermaid/index.js';
import { getSync, setSync, getLocal, setLocal } from './modules/storage.js';
import { getAllMemos, getMemo, saveMemo as saveMemoToStorage, deleteMemo as deleteMemoFromStorage } from './modules/memo/index.js';
import { COLORS, TIMING } from './modules/constants.js';
import { showStatusMessage } from './modules/ui-utils.js';
import { calculateTPSL, formatPrice, validateInputs } from './modules/leverage/index.js';
import { translateText, detectLanguage, getTargetLanguage } from './modules/translation/index.js';

document.addEventListener('DOMContentLoaded', () => {
  // EPUB은 읽기 화면이 넓어야 하므로 팝업 대신 별도 확장 프로그램 탭으로 엽니다.
  document.getElementById('openEpubReader')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') });
  });

  // 설정 관리자 초기화
  const settingsManager = new SettingsManager();

  // DOM 요소들 가져오기
  const toggleSwitch = document.getElementById('toggleSwitch');
  const statusText = document.getElementById('statusText');
  const base64Input = document.getElementById('base64Input');
  const decodeButton = document.getElementById('decodeButton');
  const encodeButton = document.getElementById('encodeButton');
  const requestMethod = document.getElementById('requestMethod');
  const requestUrl = document.getElementById('requestUrl');
  const requestHeaders = document.getElementById('requestHeaders');
  const requestBody = document.getElementById('requestBody');
  const sendRequestButton = document.getElementById('sendRequestButton');
  const resultDiv = document.getElementById('result');
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabPanels = document.querySelectorAll('.tab-panel');

  // 설정 관련 DOM 요소들
  const defaultUrl = document.getElementById('defaultUrl');
  const defaultMethod = document.getElementById('defaultMethod');
  const defaultHeaders = document.getElementById('defaultHeaders');
  const accessToken = document.getElementById('accessToken');
  const tokenName = document.getElementById('tokenName');
  const saveTokenButton = document.getElementById('saveTokenButton');
  const toggleTokenVisibility = document.getElementById('toggleTokenVisibility');
  const savedTokensList = document.getElementById('savedTokensList');
  const saveSettingsButton = document.getElementById('saveSettingsButton');
  const resetSettingsButton = document.getElementById('resetSettingsButton');

  // 메모 관련 DOM 요소들
  const memoTitle = document.getElementById('memoTitle');
  const memoContent = document.getElementById('memoContent');
  const saveMemoButton = document.getElementById('saveMemoButton');
  const savedMemosList = document.getElementById('savedMemosList');
  const memoStatus = document.getElementById('memoStatus');

  // 머메이드 관련 DOM 요소들
  const mermaidCode = document.getElementById('mermaidCode');
  const renderMermaidButton = document.getElementById('renderMermaidButton');
  const showOverlayButton = document.getElementById('showOverlayButton');
  const mermaidExamples = document.getElementById('mermaidExamples');
  const mermaidPreview = document.getElementById('mermaidPreview');
  const mermaidImage = document.getElementById('mermaidImage');
  const mermaidStatus = document.getElementById('mermaidStatus');
  const clearMermaidPreview = document.getElementById('clearMermaidPreview');

  // 설정 로드 및 초기화
  async function loadSettings() {
    const settings = await settingsManager.loadSettings();
    defaultUrl.value = settings.defaultUrl || '';
    defaultMethod.value = settings.defaultMethod || 'GET';
    defaultHeaders.value = settings.defaultHeaders || '{"Content-Type": "application/json"}';
    await loadSavedTokens();
    await applySettingsToFetch();
  }

  // 저장된 토큰 목록 로드
  async function loadSavedTokens() {
    const tokens = await settingsManager.getAllTokens();
    const defaultToken = await settingsManager.getDefaultToken();
    savedTokensList.innerHTML = '';

    for (const [name, token] of Object.entries(tokens)) {
      const tokenItem = document.createElement('div');
      tokenItem.className = 'token-item';
      const isDefault = name === defaultToken;
      tokenItem.innerHTML = `
        <span>${name} ${isDefault ? '(Default)' : ''}</span>
        <div>
          <button class="use-token-btn" data-token-name="${name}">Use</button>
          ${!isDefault ? `<button class="set-default-token-btn" data-token-name="${name}">Set Default</button>` : ''}
          <button class="delete-token-btn" data-token-name="${name}">Delete</button>
        </div>
      `;
      savedTokensList.appendChild(tokenItem);
    }
  }

  // 토큰 삭제 이벤트 위임
  savedTokensList.addEventListener('click', async (e) => {
    if (e.target.classList.contains('delete-token-btn')) {
      const tokenName = e.target.getAttribute('data-token-name');
      if (confirm(`Are you sure you want to delete the "${tokenName}" token?`)) {
        const success = await settingsManager.deleteToken(tokenName);
        if (success) {
          await loadSavedTokens();
          showResult(resultDiv, `✓ "${tokenName}" token has been deleted.`);
        } else {
          showResult(resultDiv, '✗ Failed to delete token.');
        }
      }
    } else if (e.target.classList.contains('use-token-btn')) {
      const tokenName = e.target.getAttribute('data-token-name');
      await useTokenInFetch(tokenName);
    } else if (e.target.classList.contains('set-default-token-btn')) {
      const tokenName = e.target.getAttribute('data-token-name');
      const success = await settingsManager.setDefaultToken(tokenName);
      if (success) {
        await loadSavedTokens();
        await applySettingsToFetch();
        showResult(resultDiv, `✓ "${tokenName}" token has been set as default.`);
      } else {
        showResult(resultDiv, '✗ Failed to set default token.');
      }
    }
  });

  // 토큰을 Fetch 탭에서 사용
  async function useTokenInFetch(tokenName) {
    const tokens = await settingsManager.getAllTokens();
    const tokenValue = tokens[tokenName];

    if (tokenValue) {
      // Fetch 탭으로 전환
      switchTab('fetch', tabButtons, tabPanels);

      // Authorization 헤더에 토큰 추가
      const formattedToken = settingsManager.formatTokenForHeader(tokenValue);
      const currentHeaders = requestHeaders.value.trim();

      let headers = {};
      if (currentHeaders) {
        try {
          headers = JSON.parse(currentHeaders);
        } catch (e) {
          headers = {};
        }
      }

      headers['Authorization'] = formattedToken;
      requestHeaders.value = JSON.stringify(headers, null, 2);

      showResult(resultDiv, `✓ "${tokenName}" token has been added to Authorization header.`);
    }
  }

  // 설정을 Fetch 탭에 적용
  async function applySettingsToFetch() {
    const settings = await settingsManager.loadSettings();
    if (settings.defaultUrl) {
      requestUrl.value = settings.defaultUrl;
    }
    if (settings.defaultMethod) {
      requestMethod.value = settings.defaultMethod;
    }

    // 기본 헤더와 기본 토큰을 결합
    let headers = {};
    if (settings.defaultHeaders) {
      try {
        headers = JSON.parse(settings.defaultHeaders);
      } catch (e) {
        headers = {};
      }
    }

    // 기본 토큰이 있으면 Authorization 헤더에 추가
    const defaultTokenValue = await settingsManager.getDefaultTokenValue();
    if (defaultTokenValue) {
      headers['Authorization'] = settingsManager.formatTokenForHeader(defaultTokenValue);
    }

    requestHeaders.value = JSON.stringify(headers, null, 2);
  }

  // 토글 스위치 초기화
  (async () => {
    const result = await getSync(['isEnabled']);
    const isEnabled = result.isEnabled !== undefined ? result.isEnabled : true;
    toggleSwitch.checked = isEnabled;
    statusText.textContent = isEnabled ? 'On' : 'Off';
  })();

  toggleSwitch.addEventListener('change', async () => {
    const isEnabled = toggleSwitch.checked;
    await setSync({ isEnabled: isEnabled });
    statusText.textContent = isEnabled ? 'On' : 'Off';
  });

  // 설정 로드 실행
  loadSettings();

  // 마지막 사용 탭 복원
  (async () => {
    const result = await getLocal(['lastActiveTab']);
    const lastTab = result.lastActiveTab || 'base64';
    switchTab(lastTab, tabButtons, tabPanels);
  })();

  // 탭 전환 기능
  tabButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const targetTab = button.getAttribute('data-tab');
      switchTab(targetTab, tabButtons, tabPanels);
      // 마지막 사용 탭 저장
      await setLocal({ lastActiveTab: targetTab });
    });
  });

  // 디코딩 버튼 클릭
  decodeButton.addEventListener('click', () => {
    const inputText = base64Input.value.trim();

    if (!inputText) {
      showResult(resultDiv, '⚠️ Please enter Base64 text.');
      return;
    }

    const imageCheck = isImageBase64(inputText);

    if (imageCheck.isImage) {
      // 이미지인 경우 새 탭에서 열기
      openImageInNewTab(imageCheck.dataUrl);
      showResult(resultDiv, '✓ Image opened in new tab!');
    } else {
      // 일반 텍스트 디코딩 (JWT 자동 감지)
      const decodedText = decodeText(inputText);
      if (decodedText && !decodedText.startsWith("오류:")) {
        showResult(resultDiv, `<strong>Decoded Result:</strong><div class="result-text">${decodedText}</div>`, true);
      } else {
        showResult(resultDiv, '✗ Decoding failed. Invalid Base64 format.');
      }
    }
  });

  // 인코딩 버튼 클릭
  encodeButton.addEventListener('click', () => {
    const inputText = base64Input.value.trim();

    if (!inputText) {
      showResult(resultDiv, '⚠️ Please enter text to encode.');
      return;
    }

    const encodedText = utf8ToBase64(inputText);
    if (encodedText) {
      showResult(resultDiv, `<strong>Encoded Result:</strong><div class="result-text">${encodedText}</div>`, true);
    } else {
      showResult(resultDiv, '✗ Encoding failed.');
    }
  });

  // HTTP 요청 버튼 클릭
  sendRequestButton.addEventListener('click', async () => {
    const url = requestUrl.value.trim();
    const method = requestMethod.value;
    const headersText = requestHeaders.value.trim();
    const bodyText = requestBody.value.trim();

    if (!url) {
      showResult(resultDiv, '⚠️ Please enter URL.');
      return;
    }

    let headers = {};
    if (headersText) {
      try {
        headers = JSON.parse(headersText);
      } catch (e) {
        showResult(resultDiv, '✗ Invalid header JSON format.');
        return;
      }
    }

    let body = null;
    if (bodyText && method !== 'GET') {
      try {
        JSON.parse(bodyText); // JSON 유효성 검사
        body = bodyText;
      } catch (e) {
        showResult(resultDiv, '✗ Invalid request body JSON format.');
        return;
      }
    }

    sendRequestButton.textContent = 'Sending...';
    sendRequestButton.disabled = true;

    const result = await sendHttpRequest(url, method, headers, body);

    sendRequestButton.textContent = 'Send Request';
    sendRequestButton.disabled = false;

    if (result.success) {
      const responseHtml = `
        <strong>Response Result:</strong>
        <div class="result-text">
          <strong>Status:</strong> ${result.status} ${result.statusText}
          <br><strong>Headers:</strong>
          <pre>${JSON.stringify(result.headers, null, 2)}</pre>
          <br><strong>Body:</strong>
          <pre>${result.body}</pre>
        </div>
      `;
      showResult(resultDiv, responseHtml, true);
    } else {
      showResult(resultDiv, `✗ Request failed: ${result.error}`);
    }
  });

  // Enter 키로도 디코딩
  base64Input.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      decodeButton.click();
    }
  });

  // 설정 관련 이벤트 핸들러들

  // 도움말 토글
  const helpToggle = document.querySelector('.help-toggle');
  const helpContent = document.querySelector('.help-content');
  if (helpToggle && helpContent) {
    helpToggle.addEventListener('click', () => {
      const isOpen = helpContent.style.display !== 'none';
      helpContent.style.display = isOpen ? 'none' : 'block';
      helpToggle.classList.toggle('open', !isOpen);
    });
  }

  // 토큰 가시성 토글
  toggleTokenVisibility.addEventListener('click', () => {
    const isPassword = accessToken.type === 'password';
    accessToken.type = isPassword ? 'text' : 'password';
    toggleTokenVisibility.textContent = isPassword ? '🙈' : '👁️';
  });

  // 토큰 저장
  saveTokenButton.addEventListener('click', async () => {
    const tokenNameValue = tokenName.value.trim();
    const tokenValue = accessToken.value.trim();

    if (!tokenNameValue || !tokenValue) {
      showResult(resultDiv, '⚠️ Please enter both token name and value.');
      return;
    }

    const success = await settingsManager.saveToken(tokenNameValue, tokenValue);
    if (success) {
      showResult(resultDiv, `✓ "${tokenNameValue}" token has been saved.`);
      tokenName.value = '';
      accessToken.value = '';
      await loadSavedTokens();
    } else {
      showResult(resultDiv, '✗ Failed to save token.');
    }
  });

  // 설정 저장
  saveSettingsButton.addEventListener('click', async () => {
    const settings = {
      defaultUrl: defaultUrl.value.trim(),
      defaultMethod: defaultMethod.value,
      defaultHeaders: defaultHeaders.value.trim(),
      savedTokens: await settingsManager.getAllTokens()
    };

    const success = await settingsManager.saveSettings(settings);
    if (success) {
      showResult(resultDiv, '✓ Settings have been saved.');
      await applySettingsToFetch();
    } else {
      showResult(resultDiv, '✗ Failed to save settings.');
    }
  });

  // 설정 초기화
  resetSettingsButton.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all settings? All saved tokens will also be deleted.')) {
      const success = await settingsManager.resetSettings();
      if (success) {
        showResult(resultDiv, '✓ Settings have been reset.');
        await loadSettings();
      } else {
        showResult(resultDiv, '✗ Failed to reset settings.');
      }
    }
  });

  // 메모 기능 (K-V 형태)

  // 저장된 메모 리스트 로드
  async function loadSavedMemos() {
    const memos = await getAllMemos();
    savedMemosList.innerHTML = '';

    const memoKeys = Object.keys(memos);
    if (memoKeys.length === 0) {
      savedMemosList.innerHTML = '<div style="color: #999; font-size: 12px; padding: 8px;">No saved memos</div>';
      return;
    }

    for (const title of memoKeys) {
      const memoItem = document.createElement('div');
      memoItem.className = 'token-item';
      memoItem.innerHTML = `
        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${memos[title]}">${title}</span>
        <div style="display: flex; gap: 3px;">
          <button class="copy-memo-btn use-token-btn" data-title="${title}">📋 Copy</button>
          <button class="delete-memo-btn delete-token-btn" data-title="${title}">🗑️</button>
        </div>
      `;
      savedMemosList.appendChild(memoItem);
    }
  }

  // 메모 저장
  saveMemoButton.addEventListener('click', async () => {
    const title = memoTitle.value.trim();
    const content = memoContent.value.trim();

    if (!title || !content) {
      showStatusMessage(memoStatus, '⚠️ Please enter both title and content', 'error');
      return;
    }

    const success = await saveMemoToStorage(title, content);
    if (success) {
      showStatusMessage(memoStatus, `✓ "${title}" saved`, 'success');
      memoTitle.value = '';
      memoContent.value = '';
      loadSavedMemos();
    } else {
      showStatusMessage(memoStatus, '✗ 저장 실패', 'error');
    }
  });

  // 메모 리스트 이벤트 위임 (복사/삭제)
  savedMemosList.addEventListener('click', async (e) => {
    const title = e.target.getAttribute('data-title');
    if (!title) return;

    if (e.target.classList.contains('copy-memo-btn')) {
      const content = await getMemo(title);
      if (content) {
        await navigator.clipboard.writeText(content);
        showStatusMessage(memoStatus, `✓ "${title}" copied to clipboard`, 'success');
      }
    } else if (e.target.classList.contains('delete-memo-btn')) {
      if (confirm(`Delete "${title}"?`)) {
        await deleteMemoFromStorage(title);
        showStatusMessage(memoStatus, `✓ "${title}" deleted`, 'error');
        loadSavedMemos();
      }
    }
  });

  // 자동 저장 (Ctrl+S)
  memoContent.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveMemoButton.click();
    }
  });

  // 초기 메모 로드
  loadSavedMemos();

  // ===== 머메이드 차트 기능 =====

  // 머메이드 예제 선택
  mermaidExamples.addEventListener('change', () => {
    const selectedExample = mermaidExamples.value;
    if (selectedExample && MERMAID_EXAMPLES[selectedExample]) {
      mermaidCode.value = MERMAID_EXAMPLES[selectedExample];
      mermaidPreview.style.display = 'none';
    }
  });

  // 머메이드 차트 렌더링 (popup에서는 미리보기 비활성화)
  renderMermaidButton.addEventListener('click', async () => {
    const code = mermaidCode.value.trim();

    if (!code) {
      showStatusMessage(mermaidStatus, '⚠️ Mermaid 코드를 입력해주세요.', 'error');
      return;
    }

    showStatusMessage(mermaidStatus, '✓ 코드가 확인되었습니다. 오버레이 버튼을 눌러주세요.', 'success');
  });

  // 오버레이로 표시
  showOverlayButton.addEventListener('click', async () => {
    const code = mermaidCode.value.trim();

    if (!code) {
      showStatusMessage(mermaidStatus, '⚠️ Mermaid 코드를 입력해주세요.', 'error');
      return;
    }

    showOverlayButton.textContent = '표시 중...';
    showOverlayButton.disabled = true;

    try {
      // 현재 활성 탭에 메시지 전송
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab && tab.id) {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'showMermaidOverlay',
          mermaidCode: code
        });

        showStatusMessage(mermaidStatus, '✓ 오버레이가 표시되었습니다.', 'success');
      }
    } catch (error) {
      showStatusMessage(mermaidStatus, '✗ 페이지를 새로고침한 후 다시 시도해주세요.', 'error', 3000);
    }

    showOverlayButton.textContent = '📊 오버레이 표시';
    showOverlayButton.disabled = false;
  });

  // Ctrl+Enter로 렌더링
  mermaidCode.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      renderMermaidButton.click();
    }
  });

  // 미리보기 이미지 지우기
  clearMermaidPreview.addEventListener('click', () => {
    mermaidPreview.style.display = 'none';
    mermaidImage.src = '';
  });

  // ===== 레버리지 계산기 기능 =====

  const leverageRows = document.getElementById('leverageRows');
  const addLeverageRow = document.getElementById('addLeverageRow');
  const leverageStatus = document.getElementById('leverageStatus');
  let rowIdCounter = 0;

  // 모든 행 데이터를 스토리지에 저장
  async function saveLeverageData() {
    const rows = leverageRows.querySelectorAll('.leverage-row');
    const data = [];
    rows.forEach(row => {
      data.push({
        position: row.querySelector('.position-select').value,
        entryPrice: row.querySelector('.entry-price').value,
        leverage: row.querySelector('.leverage-input').value,
        lossPercent: row.querySelector('.loss-percent').value
      });
    });
    await setLocal({ leverageData: data });
  }

  // 거래 행 생성
  function createLeverageRow(initialData = null) {
    const rowId = ++rowIdCounter;
    const row = document.createElement('div');
    row.className = 'leverage-row';
    row.id = `leverage-row-${rowId}`;

    const position = initialData?.position || 'long';
    const entryPrice = initialData?.entryPrice || '';
    const leverage = initialData?.leverage || '10';
    const lossPercent = initialData?.lossPercent || '5';

    row.innerHTML = `
      <div class="leverage-row-header">
        <select class="position-select" data-row="${rowId}">
          <option value="long" ${position === 'long' ? 'selected' : ''}>Long</option>
          <option value="short" ${position === 'short' ? 'selected' : ''}>Short</option>
        </select>
        <input type="number" class="entry-price" data-row="${rowId}" placeholder="체결가" step="any" value="${entryPrice}">
        <span>×</span>
        <input type="number" class="leverage-input" data-row="${rowId}" placeholder="레버리지" value="${leverage}" min="1" max="125">
        <span>배</span>
        <input type="number" class="loss-percent" data-row="${rowId}" placeholder="손실율" value="${lossPercent}" min="0.1" max="100" step="0.1">
        <span>%</span>
      </div>
      <div class="leverage-row-result">
        <span>TP: <span class="tp" data-row="${rowId}">-</span></span>
        <span>SL: <span class="sl" data-row="${rowId}">-</span></span>
        <button class="delete-row-btn" data-row="${rowId}">삭제</button>
      </div>
    `;
    leverageRows.appendChild(row);

    // 입력값 변경 시 실시간 계산 + 저장
    const inputs = row.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.addEventListener('input', () => {
        calculateRow(rowId);
        saveLeverageData();
      });
      input.addEventListener('change', () => {
        calculateRow(rowId);
        saveLeverageData();
      });
    });

    // 초기 데이터가 있으면 계산
    if (initialData?.entryPrice) {
      calculateRow(rowId);
    }

    return rowId;
  }

  // 행 계산
  function calculateRow(rowId) {
    const row = document.getElementById(`leverage-row-${rowId}`);
    if (!row) return;

    const position = row.querySelector('.position-select').value;
    const entryPrice = parseFloat(row.querySelector('.entry-price').value);
    const leverage = parseFloat(row.querySelector('.leverage-input').value);
    const lossPercent = parseFloat(row.querySelector('.loss-percent').value);

    const tpSpan = row.querySelector('.tp');
    const slSpan = row.querySelector('.sl');

    const validation = validateInputs(entryPrice, leverage, lossPercent);
    if (!validation.valid) {
      tpSpan.textContent = '-';
      slSpan.textContent = '-';
      return;
    }

    const result = calculateTPSL(entryPrice, leverage, lossPercent, position);

    // 원본 가격의 소수점 자릿수 유지
    const entryStr = entryPrice.toString();
    const decimals = entryStr.includes('.') ? entryStr.split('.')[1].length : 0;

    tpSpan.textContent = formatPrice(result.tp, decimals);
    slSpan.textContent = formatPrice(result.sl, decimals);
  }

  // 거래 추가 버튼
  addLeverageRow.addEventListener('click', () => {
    createLeverageRow();
    saveLeverageData();
  });

  // 행 삭제 + 가격 복사 (이벤트 위임)
  leverageRows.addEventListener('click', async (e) => {
    if (e.target.classList.contains('delete-row-btn')) {
      const rowId = e.target.getAttribute('data-row');
      const row = document.getElementById(`leverage-row-${rowId}`);
      if (row) {
        row.remove();
        await saveLeverageData();
      }
    }

    // TP/SL 가격 클릭 시 복사
    if (e.target.classList.contains('tp') || e.target.classList.contains('sl')) {
      const price = e.target.textContent;
      if (price && price !== '-') {
        // 천단위 구분자 제거 후 복사
        const cleanPrice = price.replace(/,/g, '');
        await navigator.clipboard.writeText(cleanPrice);

        // 복사 피드백
        e.target.classList.add('copied');
        const originalText = e.target.textContent;
        e.target.textContent = '복사됨!';
        setTimeout(() => {
          e.target.textContent = originalText;
          e.target.classList.remove('copied');
        }, 500);
      }
    }
  });

  // 저장된 데이터 로드
  (async () => {
    const result = await getLocal(['leverageData']);
    const savedData = result.leverageData;

    if (savedData && savedData.length > 0) {
      savedData.forEach(data => createLeverageRow(data));
    } else {
      createLeverageRow();
    }
  })();

  // ===== 번역 기능 =====

  const translateInput = document.getElementById('translateInput');
  const translateDirection = document.getElementById('translateDirection');
  const translateButton = document.getElementById('translateButton');
  const translateResult = document.getElementById('translateResult');
  const translateOutput = document.getElementById('translateOutput');
  const translateStatus = document.getElementById('translateStatus');

  // 번역 버튼 클릭
  translateButton.addEventListener('click', async () => {
    const text = translateInput.value.trim();

    if (!text) {
      showStatusMessage(translateStatus, '⚠️ 번역할 텍스트를 입력해주세요.', 'error');
      return;
    }

    translateButton.textContent = '번역 중...';
    translateButton.disabled = true;

    try {
      let sourceLang, targetLang;
      const direction = translateDirection.value;

      if (direction === 'auto') {
        sourceLang = detectLanguage(text);
        targetLang = getTargetLanguage(sourceLang);
      } else {
        [sourceLang, targetLang] = direction.split('-');
      }

      const result = await translateText(text, sourceLang, targetLang);

      if (result.success) {
        translateOutput.textContent = result.translatedText;
        translateResult.style.display = 'block';
        showStatusMessage(translateStatus, `✓ ${sourceLang.toUpperCase()} → ${targetLang.toUpperCase()} 번역 완료`, 'success');
      } else {
        showStatusMessage(translateStatus, `✗ ${result.error}`, 'error');
        translateResult.style.display = 'none';
      }
    } catch (error) {
      showStatusMessage(translateStatus, `✗ 오류: ${error.message}`, 'error');
      translateResult.style.display = 'none';
    }

    translateButton.textContent = '🌐 번역';
    translateButton.disabled = false;
  });

  // Ctrl+Enter로 번역
  translateInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      translateButton.click();
    }
  });

  // 번역 결과 클릭 시 복사
  translateOutput.addEventListener('click', async () => {
    const text = translateOutput.textContent;
    if (text) {
      await navigator.clipboard.writeText(text);
      showStatusMessage(translateStatus, '✓ 클립보드에 복사됨', 'success');
    }
  });

});