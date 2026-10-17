// 모듈 import
import { decodeText, isImageBase64 } from './modules/base64/index.js';
import { isMermaidCode, renderMermaidChart } from './modules/mermaid/index.js';
import { translateText, detectLanguage, getTargetLanguage } from './modules/translation/index.js';
import { saveMemo } from './modules/memo/index.js';

// Storage API 헬퍼 함수
async function getSync(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (result) => resolve(result));
  });
}

async function setSync(data) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(data, () => resolve());
  });
}

// 이미지를 새 탭에서 여는 함수
function openImageInNewTab(dataUrl) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Base64 Image</title>
      <style>
        body {
          margin: 0;
          padding: 20px;
          background: #2b2b2b;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        img {
          max-width: 100%;
          max-height: 100vh;
          object-fit: contain;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
      </style>
    </head>
    <body>
      <img src="${dataUrl}" alt="Decoded Image">
    </body>
    </html>
  `;
  
  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  chrome.tabs.create({ url: blobUrl });
}

// 컨텍스트 메뉴 생성 함수
function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "decode-selection",
      title: "선택한 텍스트 Base64 디코딩 (복사)",
      contexts: ["selection"]
    });
  });
}

// 확장 프로그램이 처음 설치될 때 실행
chrome.runtime.onInstalled.addListener(async () => {
  await setSync({ isEnabled: true });
  createContextMenu();
});

// service worker 시작될 때마다 메뉴 생성
createContextMenu();

// Base64 처리 공통 함수
function processBase64Selection(text, tabId) {
  const imageCheck = isImageBase64(text);

  if (imageCheck.isImage) {
    openImageInNewTab(imageCheck.dataUrl);
  } else {
    const decodedText = decodeText(text);
    if (decodedText && !decodedText.startsWith("오류:")) {
      chrome.tabs.sendMessage(tabId, { action: "copy_to_clipboard", text: decodedText })
        .catch(err => console.error('복사 메시지 전송 실패:', err));
    } else {
      chrome.tabs.sendMessage(tabId, { action: "show_error", text: "디코딩 실패" })
        .catch(err => console.error('에러 메시지 표시 실패:', err));
    }
  }
}

// 오른쪽 클릭 메뉴가 클릭되었을 때 실행될 리스너
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "decode-selection" && info.selectionText) {
    const result = await getSync(['isEnabled']);
    if (result.isEnabled) {
      const selectedText = info.selectionText.trim();
      processBase64Selection(selectedText, tab.id);
    }
  }
});

// Content script 재주입 함수
async function ensureContentScript(tabId) {
  try {
    // 먼저 메시지 전송 시도
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return true;
  } catch (error) {
    // 실패하면 content script 재주입
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      return true;
    } catch (injectError) {
      console.error('Content script 주입 실패:', injectError);
      return false;
    }
  }
}

// 단축키 명령어 리스너
chrome.commands.onCommand.addListener(async (command) => {
  // EPUB 리더는 웹 페이지와 무관한 확장 탭이므로 팝업 버튼처럼 On/Off·content script 확인 없이 연다.
  // 기본 단축키는 4개 제한이 다 차서 지정하지 않음 → chrome://extensions/shortcuts 에서 직접 지정
  if (command === "open-epub-reader") {
    chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') });
    return;
  }

  const result = await getSync(['isEnabled']);
  if (!result.isEnabled) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const ready = await ensureContentScript(tab.id);
  if (!ready) return;

  if (command === "decode-base64") {
    chrome.tabs.sendMessage(tab.id, { action: "get_selection_and_process" })
      .catch(err => console.error('Base64 디코딩 메시지 전송 실패:', err));
  } else if (command === "show-mermaid") {
    chrome.tabs.sendMessage(tab.id, { action: "get_selection_for_mermaid" })
      .catch(err => console.error('Mermaid 메시지 전송 실패:', err));
  } else if (command === "translate-selection") {
    chrome.tabs.sendMessage(tab.id, { action: "get_selection_for_translation" })
      .catch(err => console.error('번역 메시지 전송 실패:', err));
  } else if (command === "save-memo") {
    chrome.tabs.sendMessage(tab.id, { action: "get_selection_for_memo" })
      .catch(err => console.error('메모 저장 메시지 전송 실패:', err));
  }
});




// content.js로부터의 메시지를 처리하는 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.action) {
      // Base64 처리 요청 - 공통 함수 사용
      case "process_base64":
        processBase64Selection(request.text, sender.tab.id);
        break;

      // Mermaid 처리 요청
      case "process_mermaid":
        if (isMermaidCode(request.text)) {
          chrome.tabs.sendMessage(sender.tab.id, { action: "showMermaidOverlay", mermaidCode: request.text })
            .catch(err => console.error('Mermaid 오버레이 표시 실패:', err));
        } else {
          chrome.tabs.sendMessage(sender.tab.id, { action: "show_error", text: "Mermaid 코드가 아닙니다" })
            .catch(err => console.error('에러 메시지 표시 실패:', err));
        }
        break;

      // Mermaid 라이브러리 지연 주입: content script와 같은 isolated world에 넣어 `mermaid` 전역을 공유한다
      case "inject_mermaid":
        try {
          await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
            files: ['libs/mermaid.min.js']
          });
          sendResponse({ success: true });
        } catch (error) {
          console.error('Mermaid 라이브러리 주입 실패:', error);
          sendResponse({ success: false, error: error.message });
        }
        break;

      // 번역 처리 요청
      case "process_translation":
        try {
          const sourceLang = detectLanguage(request.text);
          const targetLang = getTargetLanguage(sourceLang);
          const result = await translateText(request.text, sourceLang, targetLang);

          if (result.success) {
            chrome.tabs.sendMessage(sender.tab.id, {
              action: "show_translation_result",
              originalText: request.text,
              translatedText: result.translatedText,
              sourceLang: result.sourceLang,
              targetLang: result.targetLang,
              fromCache: result.fromCache || false
            }).catch(err => console.error('번역 결과 표시 실패:', err));
          } else {
            chrome.tabs.sendMessage(sender.tab.id, {
              action: "show_error",
              text: result.error
            }).catch(err => console.error('에러 메시지 표시 실패:', err));
          }
        } catch (error) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "show_error",
            text: `번역 오류: ${error.message}`
          }).catch(err => console.error('에러 메시지 표시 실패:', err));
        }
        break;

      // 메모 저장 처리 요청
      case "save_new_memo":
        try {
          const success = await saveMemo(request.title, request.text);
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "show_notification",
            text: success ? "✓ 메모가 저장되었습니다." : "✗ 메모 저장 실패"
          }).catch(err => console.error('알림 메시지 표시 실패:', err));
        } catch (error) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "show_error",
            text: "메모 저장 중 오류 발생"
          }).catch(err => console.error('에러 메시지 표시 실패:', err));
        }
        break;
    }
  })();

  return true; // 비동기 응답을 위해 true 반환
});