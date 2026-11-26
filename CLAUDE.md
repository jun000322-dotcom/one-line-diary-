# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

"한 줄 일기" — 빌드 도구·의존성·서버 없이 `index.html` 한 파일(HTML + `<style>` + `<script>`)로 된 브라우저 앱이다. UI 문구와 코드 주석은 모두 한국어로 쓴다.

폰 홈 화면 설치(PWA)용 파일만 따로 있다: `manifest.webmanifest`, `sw.js`(서비스 워커), `icons/`. 앱 코드는 계속 `index.html`에만 둔다.
- `sw.js`는 같은 출처 파일만 네트워크 우선 + 캐시 대체로 처리한다. 캐시 파일 목록(`FILES`)을 바꾸면 `CACHE` 버전을 올린다.
- 서비스 워커는 http(s)에서만 등록된다. `open index.html`(file://)로 열면 PWA 기능 없이 그대로 동작한다.
- 저장 데이터는 기기·브라우저마다 따로라서, 기기 간 이동은 내보내기/가져오기로 한다.

## 실행과 검사

- 실행: `open index.html` (파일을 브라우저로 직접 연다. 로컬 서버 불필요)
- 이 Mac에는 Node가 없다. JS 문법 검사는 macOS에 내장된 JavaScriptCore `jsc`의 `checkSyntax`로 한다:
  ```sh
  JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
  python3 -c "import re;s=open('index.html',encoding='utf-8').read();open('/tmp/app.js','w',encoding='utf-8').write(re.search(r'<script>(.*)</script>',s,re.S).group(1))"
  echo 'try{checkSyntax(arguments[0]);print("JS syntax OK")}catch(e){print("ERROR: "+e)}' > /tmp/syn.js
  $JSC /tmp/syn.js -- /tmp/app.js
  ```
- 테스트 프레임워크는 없다. 로직을 검증할 때는 `<script>`에서 필요한 구간(예: `// ---------- 한국 공휴일` ~ `// ---------- 달력`)을 잘라 `jsc`로 실행한다. `jsc`에는 DOM·`fetch`·`localStorage`가 없으므로 순수 함수 구간만 실행할 수 있다.
- 코드를 고친 뒤에는 함께 확인할 것: 태그 짝, 중복 id, `$('id')`로 참조하는 id가 HTML에 실제로 있는지.

## 구조

스크립트는 `// ---------- 이름 ----------` 주석으로 구역이 나뉜다. 모든 렌더링은 DOM을 직접 만든다(프레임워크 없음). 사용자 입력과 외부 텍스트는 `textContent`로만 넣는다.

**데이터와 렌더링 흐름**
- 일기는 `localStorage['one-line-diary']`에 `{ 'YYYY-MM-DD': { text, weather, mood, news } }` 형태로 저장된다. 날짜 키는 로컬 시간 기준 `keyOf()`로 만든다.
- 옛 형식(값이 문자열)은 `normalize()`가 읽을 때 변환한다. 저장 형식을 바꿀 때는 `normalize()`와 가져오기(import) 경로를 함께 고친다.
- 변경은 항상 `save()` → `persist()` + `renderAll()`(`renderToday`, `renderCalendar`, 연속 기록 표시) 순서로 반영한다.
- 백업 알림 상태는 `localStorage['one-line-diary-backup']`(`{ last, sig, snooze }`)에 따로 저장한다. `backupMessage()`가 마지막 내보내기 후 7일이 지났고 내용이 바뀌었을 때(`sigOf` 해시 비교) 알림 문구를 만든다.
- "지난 오늘" 카드는 `lookbacks()`가 같은 월·일의 지난해 일기와 한 달 전 일기를 최대 3개 고른다.
- 일기 쓰기는 오늘 날짜만 된다. 지난 일기는 달력에서 날짜를 눌렀을 때 나오는 일기 카드(`renderCalDiary`)에서 보고, `startEdit`로 수정·삭제한다.

**기분 맞춤 뉴스** (`뉴스`, `번역` 구역)
- 저장할 때 기분이 정해져 있으면 `pickNews()`가 실행된다: `getFeedItems()` → `rankForMood()` → `translateNews()` → 결과를 `entries[k].news`에 저장.
- 피드 원본은 CORS를 허용하지 않아서 `api.rss2json.com`을 거친다. 이 서비스는 키 없이 쓰면 **새 피드 URL 등록을 짧은 시간에 여러 번 하면 막는다**(rate limit 60회). 받은 피드는 `FEED_CACHE_KEY`에 3시간 동안 캐시한다. `FEEDS` 목록을 바꾸면 캐시 키 버전(`-v2`)을 올려야 새 목록이 반영된다.
- 번역은 `translate.googleapis.com`(`client=gtx`)을 먼저 쓰고, 실패하면 MyMemory(요청당 500자 제한)로 넘어간다. 둘 다 실패하면 원문을 보여준다.
- 뉴스 선택은 키워드 점수로 한다. 기분별 `MOODS[].kw`, 공통 가산 `UPLIFT`, 단어 단위 감점 `HEAVY`, 피드별 가산 `FEEDS[].bonus`, 그날 나온 기사 가산점을 합산한다. 좋은 기분은 '유지', 나쁜 기분은 '전환'이 목표다.

**달력** (`한국 공휴일`, `미국 경제 일정`, `달력` 구역)
- `holidaysFor(y)`가 고정 공휴일 + `LUNAR` 표(음력 공휴일의 양력 날짜, 현재 2025–2030) + `SPECIAL_HOLIDAYS`(선거일·임시공휴일)로 공휴일을 만들고, 대체공휴일 규칙을 적용한다.
  - 설·추석은 일요일이나 다른 공휴일과 겹칠 때 대체공휴일이 생긴다.
  - 그 밖의 대상 공휴일은 토·일요일이나 다른 공휴일과 겹칠 때 생긴다.
  - 신정과 현충일에는 대체공휴일이 없다.
  - 노동절과 제헌절은 2026년부터 공휴일이다.
- 경제 일정은 모두 하드코딩된 배열(`CPI_DATES`, `PPI_DATES`, `PCE_DATES`, `JOBS_DATES`, `GDP_DATES`, `RETAIL_DATES`, `FOMC_DATES`, `BOK_DATES`, `NYSE_*`)이다. 이 배열들을 합쳐 `ECON[날짜] = [{cls, chip, title, desc, time?, flag?}]`를 만든다.
  - 미국 일정의 날짜와 시각은 미국 동부시간(ET) 기준이다. `etToKst()`가 미국 서머타임을 반영해 한국시간으로 바꾼다.
  - 범위: `ECON_YEARS`는 2026–2027년, `BOK_YEARS`는 2026년만 있다(2027년 금통위 일정은 아직 발표 전). 범위 밖의 달을 보면 달력 아래에 안내 문구가 나온다.
  - 칩 색상 클래스는 `price`, `jobs`, `growth`, `fomc`, `market` 다섯 가지다. 새 클래스를 추가하면 라이트/다크 색상 토큰과 모바일 미디어쿼리(칩을 색 점으로 바꾸는 규칙)에도 함께 추가해야 한다.

## 데이터를 갱신할 때

- 경제 일정과 음력·특별 공휴일은 기억에 의존하지 말고 공식 출처에서 확인해 넣는다.
  - 경제 일정 출처: BLS(CPI·PPI·고용보고서), BEA(PCE·GDP), Census(소매판매), federalreserve.gov(FOMC), nyse.com(휴장), 한국은행(금통위).
  - BLS 페이지는 `curl`로 받으면 403이 나므로 웹 페치 도구를 쓴다.
- 한국 설날 날짜는 한국시간 기준 음력 초하루라서 중국과 다를 수 있다(예: 2028년 한국 1/27, 중국 1/26).
- 공휴일 대조용으로 `date.nager.at` API를 쓸 수 있지만, 주말과 겹친 공휴일 당일을 빼고 대체공휴일 날짜에 원래 이름을 붙이는 등 정확하지 않으니 참고만 한다.

## 스타일

- 색상은 `:root` CSS 변수로 정의하고, 다크 모드 값은 `prefers-color-scheme: dark`에서 다시 정의한다.
- 달력 칸의 기분 색은 `MOODS[].id`로 `m-<id>` 클래스를 붙이고, `--m-<id>` 색 토큰(라이트/다크)으로 칠한다. 기분을 추가하면 토큰과 `button.day.m-<id>` 규칙도 함께 추가한다.
- 좁은 화면(480px 이하) 레이아웃은 파일 끝의 미디어쿼리 한 곳에 모여 있다.
