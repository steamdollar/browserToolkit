// Base64 디코딩 함수
function base64ToUtf8(base64) {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  } catch (e) {
    return "오류: 디코딩에 실패했습니다.";
  }
}

// 백그라운드 스크립트로부터 메시지를 수신 대기
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "ping") {
    // Content script 로드 확인용
    sendResponse({ status: "ready" });
    return true;
  } else if (request.action === "copy_to_clipboard") {
    // 클립보드에 복사
    navigator.clipboard.writeText(request.text).then(() => {
      showNotification("✓ 복사 완료!");
    }).catch(() => {
      showNotification("✗ 복사 실패");
    });
  } else if (request.action === "show_error") {
    // 에러 메시지 표시 (복사 없음)
    showNotification("✗ " + request.text);
  } else if (request.action === "get_selection_and_process") {
    // 선택된 텍스트 가져오기
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      // background.js로 선택된 텍스트 전달
      chrome.runtime.sendMessage({
        action: "process_base64",
        text: selectedText
      });
    }
  } else if (request.action === "showMermaidOverlay") {
    // 머메이드 차트 오버레이 표시 (클라이언트 사이드 렌더링)
    showMermaidOverlay(request.mermaidCode);
    sendResponse({ success: true });
    return true; // 비동기 응답을 위해 true 반환
  } else if (request.action === "get_selection_for_mermaid") {
    // 선택된 텍스트 가져오기 (Mermaid용)
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      // background.js로 선택된 텍스트 전달
      chrome.runtime.sendMessage({
        action: "process_mermaid",
        text: selectedText
      });
    }
  } else if (request.action === "get_selection_for_translation") {
    // 선택된 텍스트 가져오기 (번역용)
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      // background.js로 선택된 텍스트 전달
      chrome.runtime.sendMessage({
        action: "process_translation",
        text: selectedText
      });
    }
  } else if (request.action === "get_selection_for_memo") {
    // 선택된 텍스트 가져오기 (메모용)
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      showMemoModal(selectedText);
    } else {
      showNotification("✗ 저장할 텍스트를 먼저 선택해주세요.");
    }
  } else if (request.action === "show_notification") {
    // 범용 알림 표시
    showNotification(request.text);
  } else if (request.action === "show_translation_result") {
    // 번역 결과 토스트 표시
    showTranslationToast(request.originalText, request.translatedText, request.fromCache);
  }
});

// Mac 환경에서 Option+Q (Alt+Q) 단축키가 특수기호(œ) 등 입력기로 전용되어 
// chrome.commands 가 무시되는 이슈를 해결하기 위한 전역 Fallback 로직
document.addEventListener('keydown', (e) => {
  // 사용자가 폼 요소에 타이핑 중일 때는 단축키 무시
  const activeTag = document.activeElement ? document.activeElement.tagName : '';
  const isEditable = document.activeElement ? document.activeElement.isContentEditable : false;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || isEditable) {
    return;
  }

  // Alt(Option) 키가 눌린 상태에서 키 코드가 'KeyQ' 또는 문자 'q', 'œ' 가 입력된 경우
  if (e.altKey && (e.code === 'KeyQ' || e.key.toLowerCase() === 'q' || e.key === 'œ')) {
    e.preventDefault();
    
    // 선택된 텍스트 가져오기
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      chrome.runtime.sendMessage({
        action: "process_mermaid",
        text: selectedText
      });
    }
  }
});

// 알림 메시지 표시 함수
function showNotification(message) {
  const oldNotification = document.getElementById('base64-decoder-notification');
  if (oldNotification) {
    oldNotification.remove();
  }

  const notification = document.createElement('div');
  notification.id = 'base64-decoder-notification';
  notification.textContent = message;

  Object.assign(notification.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    color: 'white',
    padding: '12px 20px',
    borderRadius: '8px',
    boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
    zIndex: '2147483647',
    fontFamily: 'sans-serif',
    fontSize: '14px',
    fontWeight: 'bold'
  });

  document.body.appendChild(notification);

  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 1500);
}

// 번역 결과 토스트 표시 함수
function showTranslationToast(originalText, translatedText, fromCache = false) {
  // 기존 토스트 제거
  const oldToast = document.getElementById('translation-toast');
  if (oldToast) {
    oldToast.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'translation-toast';

  // 텍스트 길이에 따라 최대 너비 조정
  const maxWidth = Math.min(400, window.innerWidth * 0.8);

  // 캐시 여부에 따라 배경색 변경
  const bgColor = fromCache
    ? 'rgba(27, 94, 32, 0.92)'  // 초록색 (캐시)
    : 'rgba(0, 0, 0, 0.92)';    // 검은색 (API)

  Object.assign(toast.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: bgColor,
    color: 'white',
    padding: '16px 20px',
    paddingRight: '32px', // 닫기 버튼 공간
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    zIndex: '2147483647',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '14px',
    maxWidth: maxWidth + 'px',
    minWidth: '200px',
    wordBreak: 'break-word',
    transition: 'opacity 0.5s ease-out',
    opacity: '1'
  });

  // 닫기 버튼
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '8px',
    right: '8px',
    background: 'transparent',
    border: 'none',
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '4px',
    transition: 'color 0.2s, background-color 0.2s'
  });
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.color = 'white';
    closeBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.color = 'rgba(255, 255, 255, 0.5)';
    closeBtn.style.backgroundColor = 'transparent';
  });
  closeBtn.addEventListener('click', () => {
    toast.style.opacity = '0';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  });

  // 원문 (짧게 표시)
  const originalDiv = document.createElement('div');
  const displayOriginal = originalText.length > 50 ? originalText.substring(0, 50) + '...' : originalText;
  originalDiv.textContent = displayOriginal;
  Object.assign(originalDiv.style, {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '12px',
    marginBottom: '8px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
    paddingBottom: '8px'
  });

  // 번역문
  const translatedDiv = document.createElement('div');
  translatedDiv.textContent = translatedText;
  Object.assign(translatedDiv.style, {
    color: '#4FC3F7',
    fontSize: '15px',
    fontWeight: '500',
    lineHeight: '1.5'
  });

  toast.appendChild(closeBtn);
  toast.appendChild(originalDiv);
  toast.appendChild(translatedDiv);
  document.body.appendChild(toast);

  // 마우스 호버 시 타이머 정지
  let fadeOutTimer = null;
  let isHovered = false;

  const startFadeOutTimer = () => {
    if (fadeOutTimer) clearTimeout(fadeOutTimer);
    fadeOutTimer = setTimeout(() => {
      if (!isHovered) {
        toast.style.opacity = '0';
        setTimeout(() => {
          if (toast.parentNode) {
            toast.remove();
          }
        }, 500);
      }
    }, 5000);
  };

  toast.addEventListener('mouseenter', () => {
    isHovered = true;
    if (fadeOutTimer) clearTimeout(fadeOutTimer);
  });

  toast.addEventListener('mouseleave', () => {
    isHovered = false;
    startFadeOutTimer();
  });

  // 최초 타이머 시작
  startFadeOutTimer();
}

// ===== 메모 저장 모달 관련 =====

function showMemoModal(content) {
  const oldModal = document.getElementById('memo-save-overlay');
  if (oldModal) oldModal.remove();

  const overlay = document.createElement('div');
  overlay.id = 'memo-save-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: '2147483647',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backdropFilter: 'blur(3px)'
  });

  const modal = document.createElement('div');
  Object.assign(modal.style, {
    backgroundColor: '#fff',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    width: '320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  });

  const titleRow = document.createElement('div');
  Object.assign(titleRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
  
  const title = document.createElement('h3');
  title.textContent = '메모 저장';
  Object.assign(title.style, { margin: '0', fontSize: '18px', color: '#333', fontWeight: '600' });

  const contentPreview = document.createElement('div');
  contentPreview.textContent = content.length > 50 ? content.substring(0, 50) + '...' : content;
  Object.assign(contentPreview.style, {
    fontSize: '13px', color: '#666', backgroundColor: '#f5f5f5', 
    padding: '8px 12px', borderRadius: '6px', fontStyle: 'italic',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
  });

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '메모 이름을 입력하세요';
  Object.assign(input.style, {
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s'
  });
  input.addEventListener('focus', () => input.style.borderColor = '#2196F3');
  input.addEventListener('blur', () => input.style.borderColor = '#ddd');

  const btnContainer = document.createElement('div');
  Object.assign(btnContainer.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '취소';
  Object.assign(cancelBtn.style, {
    padding: '8px 16px', border: 'none', background: '#f5f5f5', color: '#444',
    borderRadius: '6px', cursor: 'pointer', transition: 'background 0.2s',
    fontWeight: '500', fontSize: '14px'
  });
  cancelBtn.onclick = () => overlay.remove();
  cancelBtn.onmouseenter = () => cancelBtn.style.background = '#e0e0e0';
  cancelBtn.onmouseleave = () => cancelBtn.style.background = '#f5f5f5';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '저장';
  Object.assign(saveBtn.style, {
    padding: '8px 16px', border: 'none', background: '#2196F3', color: '#fff',
    borderRadius: '6px', cursor: 'pointer', transition: 'background 0.2s',
    fontWeight: '500', fontSize: '14px'
  });
  saveBtn.onmouseenter = () => saveBtn.style.background = '#1976D2';
  saveBtn.onmouseleave = () => saveBtn.style.background = '#2196F3';

  const doSave = () => {
    const memoTitle = input.value.trim();
    if (!memoTitle) {
      input.style.borderColor = '#f44336';
      input.style.animation = 'shake 0.4s';
      setTimeout(() => input.style.animation = '', 400);
      return;
    }
    chrome.runtime.sendMessage({
      action: "save_new_memo",
      title: memoTitle,
      text: content
    });
    overlay.remove();
  };

  saveBtn.onclick = doSave;
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // Stop document level shortcuts
    if (e.key === 'Enter') {
      e.preventDefault();
      doSave();
    }
    if (e.key === 'Escape') {
      overlay.remove();
    }
  });

  titleRow.append(title);
  btnContainer.append(cancelBtn, saveBtn);
  modal.append(titleRow, contentPreview, input, btnContainer);
  overlay.append(modal);

  // Click outside to close
  overlay.addEventListener('mousedown', e => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
  
  // Add simple shake animation for empty input validation
  if (!document.getElementById('memo-shake-style')) {
    const style = document.createElement('style');
    style.id = 'memo-shake-style';
    style.textContent = `
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }
    `;
    document.head.appendChild(style);
  }

  // Set focus with slight delay to ensure rendering
  setTimeout(() => input.focus(), 10);
}

// ===== Mermaid 오버레이 관련 상수 및 헬퍼 함수들 =====

const OVERLAY_Z_INDEX = 2147483646;
const BUTTON_Z_INDEX = 2147483647;

const COLORS = {
  closeButton: '#ff4444',
  closeButtonHover: '#cc0000',
  downloadButton: '#2196F3',
  downloadButtonHover: '#1976D2',
  error: 'red'
};

// 오버레이 요소 생성
function createOverlayElement() {
  const overlay = document.createElement('div');
  overlay.id = 'mermaid-chart-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    zIndex: String(OVERLAY_Z_INDEX),
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backdropFilter: 'blur(5px)'
  });
  return overlay;
}

// 차트 컨테이너 생성
function createChartContainer() {
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'relative',
    maxWidth: '75vw',
    maxHeight: '75vh',
    minWidth: '750px',
    minHeight: '600px',
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '70px 40px 40px 40px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    overflow: 'auto',
    fontFamily: 'Arial, sans-serif',
    fontSize: '20px',
    fontWeight: 'bold',
    boxSizing: 'border-box'
  });
  return container;
}

// Mermaid 렌더링 영역 생성
function createChartDiv() {
  const chartDiv = document.createElement('div');
  chartDiv.className = 'mermaid-chart-content';
  Object.assign(chartDiv.style, {
    width: 'max-content',
    minWidth: '100%',
    minHeight: '100%',
    display: 'flex',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    padding: '20px',
    boxSizing: 'border-box'
  });
  return chartDiv;
}

// 오버레이 버튼 생성 (공용)
function createOverlayButton(config) {
  const button = document.createElement('button');
  button.textContent = config.text;
  Object.assign(button.style, {
    position: 'absolute',
    top: '10px',
    border: 'none',
    color: 'white',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    ...config.style
  });

  button.addEventListener('mouseenter', () => {
    button.style.backgroundColor = config.hoverColor;
  });
  button.addEventListener('mouseleave', () => {
    button.style.backgroundColor = config.color;
  });

  return button;
}

// SVG 스타일 처리
function processSvgElement(svgElement, chartContainer) {
  const originalWidth = svgElement.getAttribute('width');
  const originalHeight = svgElement.getAttribute('height');

  // viewBox에서 실제 픽셀 차원 추출 (Mermaid가 width="100%"를 적용하는 경우 대비)
  const viewBox = svgElement.getAttribute('viewBox');
  let viewWidth = originalWidth;
  let viewHeight = originalHeight;

  if (viewBox) {
    const pts = viewBox.split(/[\s,]+/);
    if (pts.length === 4) {
      viewWidth = pts[2];
      viewHeight = pts[3];
    }
  }

  // 컨테이너 높이에 맞춰 비례 확대로 세로 공간 채우기
  if (chartContainer && viewHeight) {
    const containerHeight = chartContainer.clientHeight - 120; // 패딩(70+40) 및 여유분 고려
    const vHeight = parseFloat(viewHeight);
    const vWidth = parseFloat(viewWidth);

    // 차트가 컨테이너보다 작을 경우에만 확대
    if (vHeight < containerHeight) {
      const ratio = containerHeight / vHeight;
      viewHeight = containerHeight;
      viewWidth = vWidth * ratio;
    }
  }

  // 계산된 크기(px)를 스타일로 적용하여 자동 축소 방지 (!important로 강제 적용)
  if (viewHeight) {
    const heightVal = String(viewHeight).endsWith('px') ? viewHeight : `${viewHeight}px`;
    svgElement.style.setProperty('height', heightVal, 'important');
  }
  if (viewWidth) {
    const widthVal = String(viewWidth).endsWith('px') ? viewWidth : `${viewWidth}px`;
    svgElement.style.setProperty('width', widthVal, 'important');
    svgElement.style.setProperty('min-width', widthVal, 'important');
  }

  svgElement.style.display = 'block';
  svgElement.style.setProperty('max-width', 'none', 'important'); // 가로 제한 강제 해제
  svgElement.style.flexShrink = '0'; // Flexbox 환경에서 축소 방지

  const style = document.createElement('style');
  style.textContent = `
    #mermaid-chart-overlay svg * { overflow: visible !important; }
    #mermaid-chart-overlay .nodeLabel,
    #mermaid-chart-overlay .edgeLabel,
    #mermaid-chart-overlay text { overflow: visible !important; }
    #mermaid-chart-overlay foreignObject { overflow: visible !important; }
    #mermaid-chart-overlay foreignObject > div {
      overflow: visible !important;
      white-space: nowrap !important;
      text-overflow: clip !important;
    }
    #mermaid-chart-overlay .nodeLabel > span,
    #mermaid-chart-overlay .edgeLabel > span { white-space: nowrap !important; }
  `;
  chartContainer.appendChild(style);
}

// Mermaid 라이브러리(약 2.7MB)는 모든 페이지에 넣지 않고 오버레이를 처음 열 때 background에 주입을 요청한다.
// 실패하면 renderMermaidToDiv가 "라이브러리를 찾을 수 없습니다"를 오버레이에 표시한다.
async function ensureMermaidLoaded() {
  if (typeof mermaid !== 'undefined') return;
  try {
    await chrome.runtime.sendMessage({ action: "inject_mermaid" });
  } catch (error) {
    console.error('Mermaid 라이브러리 주입 요청 실패:', error);
  }
}

// Mermaid 차트 렌더링
function renderMermaidToDiv(mermaidCode, chartDiv, chartContainer) {
  if (typeof mermaid === 'undefined') {
    chartDiv.innerHTML = `<p style="color: ${COLORS.error};">Mermaid 라이브러리를 찾을 수 없습니다.</p>`;
    return;
  }

  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      flowchart: { htmlLabels: true, curve: 'basis' }
    });

    const id = 'mermaid-' + Date.now();

    try {
      mermaid.render(id, mermaidCode, (svgCode) => {
        chartDiv.innerHTML = svgCode;
        const svgElement = chartDiv.querySelector('svg');
        if (svgElement) {
          processSvgElement(svgElement, chartContainer);
        }
      });
    } catch (renderError) {
      chartDiv.innerHTML = `<p style="color: ${COLORS.error};">렌더링 오류: ${renderError.message}</p>`;
      console.error('Mermaid 렌더링 오류:', renderError);
    }
  } catch (error) {
    chartDiv.innerHTML = `<p style="color: ${COLORS.error};">초기화 오류: ${error.message}</p>`;
    console.error('Mermaid 초기화 오류:', error);
  }
}

// SVG 다운로드
function downloadSvg(chartDiv) {
  const svgElement = chartDiv.querySelector('svg');
  if (svgElement) {
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mermaid-chart-${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }
}

// 현재 열린 Mermaid 오버레이의 닫기 함수.
// 모든 닫기 경로(ESC·닫기 버튼·바깥 클릭·새 오버레이로 교체)가 이 함수를 거쳐야
// document의 ESC keydown 리스너가 제거된 오버레이 DOM을 붙잡고 남지 않는다.
let closeMermaidOverlay = null;

// 오버레이 이벤트 설정
function setupOverlayEvents(overlay, chartContainer, closeButton) {
  const handleEscape = (e) => {
    if (e.key === 'Escape') closeOverlay();
  };
  const closeOverlay = () => {
    overlay.remove();
    document.removeEventListener('keydown', handleEscape);
    if (closeMermaidOverlay === closeOverlay) closeMermaidOverlay = null;
  };
  closeMermaidOverlay = closeOverlay;

  // 오버레이 바깥 클릭, 닫기 버튼, ESC 키로 닫기
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });
  closeButton.addEventListener('click', closeOverlay);
  document.addEventListener('keydown', handleEscape);

  // 마우스 휠로 가로 스크롤 가능하게 처리 (세로 스크롤이 없을 때만)
  if (chartContainer) {
    chartContainer.addEventListener('wheel', (e) => {
      const isHorizontalOverflow = chartContainer.scrollWidth > chartContainer.clientWidth;
      const isVerticalOverflow = chartContainer.scrollHeight > chartContainer.clientHeight;

      // 수직 스크롤이 없고 가로 스크롤만 있을 때만 휠을 가로로 전환
      if (e.deltaY !== 0 && isHorizontalOverflow && !isVerticalOverflow) {
        e.preventDefault();
        chartContainer.scrollLeft += e.deltaY;
      }
      // 세로 스크롤이 있는 경우에는 브라우저 기본 동작(수직 스크롤)을 따름
    }, { passive: false });
  }
}

// 머메이드 차트 오버레이 표시 함수 (메인)
async function showMermaidOverlay(mermaidCode) {
  // 기존 오버레이 제거 (리스너까지 정리). getElementById는 이전 content script 인스턴스가 남긴 오버레이용
  closeMermaidOverlay?.();
  document.getElementById('mermaid-chart-overlay')?.remove();

  // 요소 생성
  const overlay = createOverlayElement();
  const chartContainer = createChartContainer();
  const chartDiv = createChartDiv();

  // Mermaid 렌더링
  await ensureMermaidLoaded();
  renderMermaidToDiv(mermaidCode, chartDiv, chartContainer);

  // 닫기 버튼
  const closeButton = createOverlayButton({
    text: '✕',
    color: COLORS.closeButton,
    hoverColor: COLORS.closeButtonHover,
    style: {
      right: '10px',
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      backgroundColor: COLORS.closeButton,
      fontSize: '18px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  });

  // 다운로드 버튼
  const downloadButton = createOverlayButton({
    text: '💾 다운로드',
    color: COLORS.downloadButton,
    hoverColor: COLORS.downloadButtonHover,
    style: {
      left: '10px',
      padding: '8px 16px',
      borderRadius: '6px',
      backgroundColor: COLORS.downloadButton,
      fontSize: '14px'
    }
  });
  downloadButton.addEventListener('click', () => downloadSvg(chartDiv));

  // 요소 조립
  chartContainer.appendChild(closeButton);
  chartContainer.appendChild(downloadButton);
  chartContainer.appendChild(chartDiv);
  overlay.appendChild(chartContainer);
  document.body.appendChild(overlay);

  // 이벤트 설정
  setupOverlayEvents(overlay, chartContainer, closeButton);
}