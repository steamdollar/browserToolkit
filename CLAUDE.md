# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Context Decoder - 개발자용 Chrome 확장 프로그램 (Manifest V3)

**핵심 기능:**
- Base64 인코딩/디코딩 (JWT 자동 파싱, 이미지 감지)
- HTTP API 테스트 (GET, POST, PUT, DELETE, PATCH)
- Mermaid 차트 시각화 (클라이언트 사이드 렌더링)
- 메모 관리 (K-V 저장소)

## 개발 환경

**설치 및 실행:**
```bash
# chrome://extensions 에서 개발자 모드 활성화
# "압축해제된 확장 프로그램을 로드합니다" → 프로젝트 폴더 선택
```

**코드 변경 반영:**
- `chrome://extensions`에서 확장 프로그램 새로고침 버튼 클릭

**배포:**
- `.git`, `node_modules`, `*.txt` 제외 후 ZIP 압축
- Chrome Web Store에 업로드

## 아키텍처

```
popup.js (메인 UI 로직)
    ↓ chrome.runtime.sendMessage
background.js (서비스 워커)
    ↓ chrome.tabs.sendMessage
content.js (웹 페이지 상호작용)
```

**모듈 구조:**
- `modules/base64/` - Base64 인코딩/디코딩, UI 유틸리티
- `modules/http/` - Fetch API 래퍼
- `modules/mermaid/` - Mermaid.js SVG 렌더링
- `modules/settings.js` - Chrome Storage 관리 (SettingsManager 클래스)
- `libs/mermaid.min.js` - Mermaid 라이브러리 (번들 포함)
- `libs/epub.min.js`, `libs/jszip.min.js` - EPUB 리더용 (번들 포함, 갱신: `npm run build:epub`)

**스토리지:**
- Chrome Storage API 사용 (sync: 설정, local: 메모)

## 새 기능 추가 시

1. `modules/`에 새 폴더/파일 생성
2. `popup.html`에 탭 UI 추가
3. `popup.js`에 탭 이벤트 핸들러 추가
4. 필요시 `background.js`, `content.js`에 메시지 핸들러 추가
5. `manifest.json` 권한 확인

## 코드 컨벤션

- ES6 import/export 사용
- 함수명: camelCase, 클래스명: PascalCase
- 비동기: async/await
- 에러 메시지: 한국어

## 단축키

| 기능 | 단축키 |
|------|--------|
| Base64 디코딩 | `Alt+Shift+D` |
| Mermaid 오버레이 | `Alt+Q` |
| 페이지 메모 저장 | `Alt+Shift+S` |
| EPUB 리더 열기 | 기본키 없음 (직접 지정, 권장 `Alt+Shift+E`) |
| 팝업 폼 저장 | `Ctrl+S` |
| 팝업 내 실행 | `Ctrl+Enter` |

변경: `chrome://extensions/shortcuts`

`suggested_key`는 최대 4개, `Ctrl+Alt` 조합 불가 (위반 시 확장 로드 실패). 4칸이 차 있으므로 새 명령은 기본키 없이 추가한다.

## 디버깅

- **팝업**: `chrome://extensions` → 확장 아이콘 우클릭 → 검사
- **Service Worker**: `chrome://extensions` → "서비스 워커" 링크 클릭
- **Content Script**: 일반 DevTools (F12)
