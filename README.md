# AGR 대시보드 — 사용 가이드

5탭 대시보드입니다. `npm install` 한 번, `npm run dev` 한 번이면 브라우저에서 바로 볼 수
있고, 데이터는 `public/data/` 폴더의 JSON만 채우면 코드를 다시 건드리지 않아도 화면에
자동으로 반영됩니다.

## 0. 처음 실행하기

1. 압축을 풀어 폴더로 들어갑니다.
   ```
   cd agr-dashboard
   ```
2. 필요한 패키지를 설치합니다 (최초 1회, 인터넷 필요).
   ```
   npm install
   ```
3. 개발 서버를 켭니다.
   ```
   npm run dev
   ```
4. 터미널에 뜨는 주소(보통 `http://localhost:5173`)를 브라우저에서 엽니다.
5. 다 봤으면 터미널에서 `Ctrl + C`로 끄면 됩니다.

Node.js가 없다면 [nodejs.org](https://nodejs.org)에서 LTS 버전을 먼저 설치하세요.

탭1·2·4(작목별 수익성/내 농가 경영진단/공공데이터)에는 아직 "예시 데이터만 있다"는 안내와
함께 빈 틀만 보일 겁니다. 정상입니다 — 2번 항목에서 실제 데이터를 채우면 됩니다. 탭3(판매경로
진단)은 폼 입력만으로 점수까지는 바로 보이고, AI 분석 버튼은 1번 항목을 마쳐야 동작합니다.

## 1. AI 분석(판매경로 진단) 연결하기

브라우저가 Anthropic API를 직접 부르지 않고, 같은 프로젝트 안의 작은 백엔드 서버
(`server.js`)를 거치도록 만들어 두었습니다. API 키는 그 서버에만 두기 때문에 브라우저
(화면) 쪽 코드에는 절대 노출되지 않습니다.

1. `.env.example` 파일을 복사해서 이름을 `.env`로 바꿉니다. (탐색기에서 복사 → 붙여넣기 →
   이름 바꾸기.)
2. `.env` 파일을 메모장으로 열어서 `ANTHROPIC_API_KEY=여기에_본인의_API_키를_붙여넣으세요`
   부분의 `여기에_본인의_API_키를_붙여넣으세요`를 지우고 실제 키로 바꿔서 저장합니다.
3. `npm run dev`를 실행하면 화면(클라이언트)과 AI 분석 서버가 **동시에** 켜집니다. 터미널에
   초록색 `CLIENT`, 청록색 `SERVER` 두 줄이 같이 나오면 정상입니다.
4. 판매경로 진단 탭에서 "포트폴리오 분석 시작" 버튼을 누르면 실제 AI 분석 결과가 나옵니다.

`.env`는 `.gitignore`에 포함돼 있어 깃에 올라가지 않습니다. 키는 절대 채팅이나 공개된
곳에 붙여넣지 마세요. (실행 중 오류가 나면 .env에 키를 제대로 붙였는지, `npm run dev`
실행 중인 터미널에 SERVER 쪽도 같이 떠 있는지부터 확인하면 됩니다.)

## 2. 데이터를 나중에 일괄로 넣는 방법

1. **공공데이터 카탈로그** → `public/data/public-datasets.json`의 `datasets` 배열에
   항목을 추가하고, `_example` 항목은 지웁니다. 필드 의미는 `public/data/SCHEMA.md` 참고.
2. **작목별 소득자료** → 농사로에서 받은 원본 CSV/XLSX를 그대로
   ```
   pip install pandas openpyxl --break-system-packages   # 최초 1회
   python scripts/ingest_income_data.py 파일경로.xlsx
   ```
   로 돌리면 `public/data/income-data.json`이 자동 생성됩니다.
3. **가상 농가 케이스** → `public/data/rda-cases.json`에 케이스를 추가하면 판매경로
   진단 탭의 "사례 선택" 드롭다운에 자동으로 나타납니다.
4. 다 채운 뒤 점검:
   ```
   python scripts/validate_data.py
   ```
   형식·중복id·필수값 누락을 한 번에 확인해줍니다.
5. 개발 서버가 켜져 있다면 **브라우저 새로고침만 하면** 반영됩니다. 컴포넌트 코드는
   다시 건드릴 필요 없습니다.

## 3. 폴더 구조

```
agr-dashboard/
  package.json / vite.config.js / index.html   ← 실행에 필요한 설정 (안 건드려도 됨)
  server.js                    ← AI 분석 백엔드 (API 키는 여기서만 사용)
  .env.example / .env          ← API 키 설정 (.env는 직접 만들어야 함)
  public/data/                 ← 자동연동되는 데이터 저장 공간 (여기만 채우면 끝)
    public-datasets.json       공공데이터 카탈로그
    income-data.json           작목별 소득자료 (농사로)
    rda-cases.json             판매경로 진단용 가상 농가 케이스
    SCHEMA.md                  각 필드 설명
  scripts/
    ingest_income_data.py      농사로 CSV/XLSX → income-data.json 일괄 변환
    validate_data.py           데이터 형식 점검
  src/
    main.jsx                   진입점 (안 건드려도 됨)
    theme.js                   다크 네이비 색상 토큰
    App.jsx                    5탭 셸 (탭 전환만 담당)
    lib/dataLoader.js          public/data/*.json을 읽어오는 공용 함수
    components/
      PublicDataCatalog.jsx    탭4: 공공데이터 (검색·필터 포함)
      CropProfitability.jsx    탭1: 작목별 수익성 비교 (정렬 차트+표)
      FarmDiagnosis.jsx        탭2: 내 농가 경영진단 (입력→전국평균 비교)
      PortfolioDiagnosis.jsx   탭3: 판매경로 진단 (v8 로직 그대로 + 사례선택 + AI 분석)
      Guide.jsx                탭5: 가이드 (정적 설명)
```

## 4. 배포하기 (선택)

```
npm run build
```
하면 `dist/` 폴더에 정적 파일(HTML/JS + `dist/data/*.json`)이 만들어집니다. 이 폴더를
정적 호스팅에 올리고, `server.js`는 별도로(예: 같은 서버에서 `node server.js`) 계속
실행해 두면 됩니다.

## 5. 기존 프로젝트와 합치는 법

지금은 독립 실행 가능한 프로젝트로 만들었지만, 이미 만들어두신 `농가판매경로_AI시스템.jsx`
+ Express 서버 쪽으로 옮기실 수도 있습니다. 그때는 `src/` 안의 파일들을 기존 React
프로젝트의 `src/`로, `public/data/`를 기존 프로젝트가 정적으로 서빙하는 위치로 옮기면
됩니다. 위치가 달라지면 `src/lib/dataLoader.js`의 `DATA_BASE` 한 줄만 그 경로로 고치면
됩니다. `server.js`의 `/api/analyze` 로직은 기존 Express 서버에 라우트 하나로 합칠 수도
있습니다.

## 5-1. 다른 PC에서 이어서 작업하기

> 같은 Claude 계정으로 로그인해도 **프로젝트 파일·API 키·Claude 작업기억은 자동으로 따라오지 않습니다.** Claude Code는 이를 모두 로컬 PC 파일로 저장합니다. 아래대로 옮기세요.

1. **코드 가져오기** — git clone(권장) 또는 폴더 복사(`node_modules` 제외) 후 `npm install`
2. **`.env` 재작성** — `.env.example` 복사 후 키 입력 (git에 안 올라감)
   - `ANTHROPIC_API_KEY`(console.anthropic.com) / `KAMIS_API_KEY`(kamis.or.kr) / `MAFRA_API_KEY`(data.mafra.go.kr)
3. **PDF 원문** — `public/data/guides/` 폴더가 함께 따라가면 공공데이터 탭에서 "원문 열기"가 동작합니다. (git에 포함됨)
4. **Claude 작업기억 이어가기** — 이 프로젝트의 맥락을 다른 PC의 Claude Code도 기억하게 하려면 기억 폴더를 옮기세요.
   - 원본: `~/.claude/projects/C--Users-user-Desktop-agr-dashboard/memory/`
   - 백업본: 이 저장소 [`docs/claude-memory/`](docs/claude-memory/)
   - **기억 폴더명은 프로젝트 절대경로를 인코딩**합니다. 다른 PC에서도 프로젝트를 `C:\Users\user\Desktop\agr-dashboard` 에 두면 그대로 연결됩니다. 경로가 다르면 폴더명도 그에 맞춰 변경하세요.

> 참고: 현재 탭은 7개입니다(작목별 수익성 / 내 농가 경영진단 / 판매경로 진단 / 도매시장 가격 / 소비 트렌드 / 공공데이터 / 가이드). 진단 연계 데이터 매핑은 `src/lib/cropRegistry.js` 가 단일 공급원입니다.

## 6. 기술 스택 메모

React + Vite, 별도 차트 라이브러리 없이 div 기반 커스텀 바 차트(기존 v8과 동일한 방식)만
사용했습니다. AI 호출은 작은 Express 서버(`server.js`) 하나가 전담하고, 데이터 변환은
Python(`scripts/`)을 씁니다.
