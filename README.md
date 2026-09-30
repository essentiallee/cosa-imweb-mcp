# COSA Imweb MCP — read-only MVP

COSA의 아임웹 사이트 정보를 ChatGPT에서 조회하는 Node.js 서버입니다. 고객용 `cosa-bags.com`은 그대로 유지하며 이 서버만 별도로 실행·배포합니다.

현재 구현: Imweb OAuth 승인 → 암호화된 access/refresh token 저장 → 사이트 정보 GET → MCP `get_site_info`.
쓰기 API·쓰기 scope·사이트 수정 도구는 없습니다. OpenAI API key도 필요하지 않습니다.

## 1. 먼저 로컬 설정

Node.js 22 이상을 사용합니다. VS Code에서 이 저장소를 열고 터미널에서:

```sh
npm ci
npm run setup
```

`npm run setup`은 `.env`를 새로 만들고 필요한 로컬 보안 키를 자동 생성합니다. 기존 파일은 덮어쓰지 않습니다. 이번 작업에서는 이미 실행해 두었습니다.

VS Code에서 `.env` 파일을 직접 열어 아래 세 항목을 채우세요. **Secret을 대화·README·GitHub에 붙여넣지 마세요.**

```dotenv
IMWEB_CLIENT_ID=개발자센터의_Client_ID
IMWEB_CLIENT_SECRET=개발자센터의_Client_Secret
IMWEB_SITE_CODE=연결할_사이트_코드
```

사이트 코드는 도메인이 아닌 아임웹의 `S...` 식별자입니다. 개발자센터에서 연결한 테스트 사이트의 코드와 일치해야 합니다. 자동 생성된 `ADMIN_PASSWORD`, `TOKEN_ENCRYPTION_KEY`, `MCP_CLIENT_SECRET`은 유지하세요.

## 2. 아임웹 개발자센터 설정

COSA MCP 앱에서:

1. 사이트 정보 **읽기**(`site-info:read`)만 활성화합니다.
2. 서비스 URL·Redirect URI·API를 저장하면 **앱 테스트** 버튼이 활성화됩니다. 눌러 COSA 사이트를 선택하고, 읽기 권한을 확인한 뒤 **동의**합니다. 로그인한 계정이 소유자이고 이용 기간이 만료되지 않은 사이트만 표시됩니다. [공식 앱 테스트 안내](https://developers-docs.imweb.me/guide/프로세스-확인하기)
3. 서비스 URL을 `http://localhost:3000`으로, Redirect URI를 `http://localhost:3000/oauth/callback`으로 등록합니다.
4. localhost 등록을 허용하지 않는 경우 아래의 임시 HTTPS 배포 주소를 먼저 사용하세요. 등록 URI와 `.env`의 `PUBLIC_BASE_URL` + `/oauth/callback`은 정확히 일치해야 합니다.

공식 가이드상 특정 사이트 전용 앱은 테스트 연동 사이트에서만 API 사용이 가능합니다. 앱스토어의 일반 설치 흐름에서는 `연동완료` 처리에 `site-info:write`가 필요합니다. 이 MVP는 요청대로 그 API를 구현하지 않습니다. `연동중` 상태로 인해 읽기가 거절되면 쓰기 scope를 추가하지 말고 테스트 연결 상태를 확인하세요. 실제 COSA 사이트 사용 가능 여부는 개발자센터 상태와 실호출로 검증해야 합니다.

## 3. 실행 → 승인 → 조회

```sh
npm start
```

1. 브라우저에서 `http://localhost:3000/oauth/start`를 엽니다. `127.0.0.1` 대신 설정과 같은 `localhost` 주소를 사용하세요.
2. `.env`의 `ADMIN_PASSWORD` 값을 화면에 입력합니다. 이것은 이 서버의 소유자 확인용 비밀번호입니다.
3. 아임웹에서 해당 사이트와 **사이트 정보 읽기** 권한을 확인하고 승인합니다.
4. 콜백 완료 화면에서 **사이트 정보 READ 테스트**를 누릅니다.
5. `siteCode`와 `unitList` JSON이 나오면 실제 READ 성공입니다.

토큰은 화면이나 로그에 출력하지 않고 `.data/imweb-tokens.enc`에 AES-256-GCM으로 암호화하여 저장합니다. `.env`와 `.data/`는 Git에서 제외됩니다. 조회 결과에서 소유자 UID와 앱 설정은 제외합니다.

현재 완료한 검증은 모의 Imweb 응답을 이용한 자동 테스트입니다. 실제 계정 승인·API 성공·ChatGPT 연결 완료를 의미하지 않습니다.

## 4. 임시 HTTPS 주소로 배포

인터넷의 ChatGPT는 이 컴퓨터의 localhost에 직접 접속할 수 없습니다. Node.js 22 이상과 **영구 저장 공간**을 지원하는 호스팅에서 단일 인스턴스로 실행하세요. 기본 Dockerfile도 포함되어 있습니다.

호스팅 설정:

- 설치: `npm ci --omit=dev`
- 실행: `node src/index.js` (호스팅의 환경변수 사용)
- `HOST=0.0.0.0`, `PORT=호스팅에서_지정한_포트`
- `PUBLIC_BASE_URL=https://실제로_발급받은_개발주소`
- `TOKEN_FILE=/영구디스크_마운트경로/imweb-tokens.enc`
- `.env` 항목을 호스팅의 비밀 환경변수 설정에 입력합니다. `.env`를 Git에 올리지 않습니다.
- 신뢰할 수 있는 프록시가 정확히 1단계 앞에 있을 때만 `TRUST_PROXY_HOPS=1`로 설정합니다. 프록시는 원래 Host를 보존해야 합니다.
- 인스턴스 수는 **1개**로 유지합니다. 토큰 갱신 잠금 및 MCP 인증 세션은 프로세스 내부에 있습니다.
- 애플리케이션·프록시 로그에서 요청 body, Authorization/Cookie 헤더, OAuth 콜백 query를 기록하지 않도록 합니다.

배포 후 아임웹 서비스 URL과 Redirect URI를 새 주소로 바꾸고 `/oauth/start`부터 승인합니다. 영구디스크가 없으면 재배포 시 토큰이 사라져 다시 승인해야 합니다. 암호화 키를 변경하거나 잃으면 기존 토큰을 읽을 수 없으므로 키를 안전하게 보관하세요.

## 5. ChatGPT에 연결

두 OAuth 연결은 서로 다릅니다:

- **서버 → 아임웹**: `IMWEB_CLIENT_ID`, `IMWEB_CLIENT_SECRET`, `site-info:read`
- **ChatGPT → 이 서버**: `MCP_CLIENT_ID`, `MCP_CLIENT_SECRET`, `site:read`

ChatGPT에는 **아임웹 Client Secret을 입력하지 않습니다.**

1. ChatGPT 웹에서 개발자 모드를 켜고 사용자 지정 MCP 앱을 생성합니다. 계정 및 조직 정책에 따라 메뉴가 다를 수 있습니다.
2. MCP URL: `https://개발주소/mcp`
3. 인증 방식: **OAuth**, 정적 Client ID/Secret은 `.env`의 `MCP_CLIENT_ID` / `MCP_CLIENT_SECRET`을 입력합니다. 자동 클라이언트 등록은 제공하지 않습니다.
4. ChatGPT가 안내하는 **정확한 callback URL**을 호스팅의 `MCP_REDIRECT_URIS`에 입력하고 서버를 다시 시작합니다. 여러 URL은 쉼표로 구분합니다. 와일드카드는 허용하지 않습니다.
5. 연결을 시작하면 이 서버의 소유자 승인 화면이 나옵니다. `ADMIN_PASSWORD`로 읽기 전용 연결을 승인합니다.
6. 대화에서 COSA 앱을 선택하고 “COSA의 get_site_info 도구로 사이트 정보를 조회해줘”라고 요청합니다.

아임웹용 콜백은 `/oauth/callback`, ChatGPT 콜백은 ChatGPT가 제공한 URL입니다. 서로 바꾸어 입력하지 마세요.

서버는 OAuth metadata, PKCE S256, 코드 재사용 방지, 고정 콜백 검증, resource 검증을 제공합니다. MCP access token은 1시간, refresh token은 24시간이며 갱신 시 회전합니다. MCP 로그인 정보는 메모리에 있으므로 **서버 재시작 후 ChatGPT 재연결**이 필요합니다. 아임웹 토큰은 암호화 파일에서 복구됩니다. 이 구성은 COSA 소유자 1명과 사이트 1개를 위한 MVP이며 다중 사용자 서비스가 아닙니다.

## 6. GitHub Desktop으로 저장

Changes 목록에 `.env`, `.data/`, `node_modules/`가 없는지 확인하고 소스·문서를 커밋한 뒤 Push origin을 누릅니다. 초기 커밋 메시지 예: `Add read-only Imweb MCP MVP`.

현재 이 환경의 GitHub CLI 로그인은 만료되어 자동 push하지 않았습니다. GitHub Desktop 로그인은 별개이므로 그곳에서 업로드할 수 있습니다.

## 7. 나중에 mcp.cosa-bags.com 사용

MCP 동작을 검증한 뒤 DNS 관리 가능 여부를 확인하고 `mcp` 서브도메인을 호스팅에 연결합니다. TLS 발급 후 `PUBLIC_BASE_URL`, 아임웹 서비스 URL/Redirect URI, ChatGPT MCP URL을 함께 변경하고 양쪽 OAuth를 다시 연결합니다. 고객용 루트/www 도메인 레코드는 유지합니다.

## 프로젝트 구조

```text
src/
  index.js         실행과 종료 처리
  config.js        환경변수 검증
  app.js           웹 화면, Imweb OAuth, HTTP 경로
  imweb.js         공식 Imweb API와 토큰 갱신
  token-store.js   토큰 암호화·원자적 저장
  mcp.js           get_site_info 읽기 전용 도구
  mcp-auth.js      ChatGPT용 소유자 OAuth 승인
  security.js     쿠키·비교·만료 데이터 유틸리티
scripts/setup.js   Secret을 출력하지 않는 로컬 초기 설정
test/server.test.js  OAuth, 토큰, 실제 SDK MCP 흐름 테스트
docs/API-NOTES.md    확인한 공식 명세 및 주의점
.env.example      빈 설정 예시
.gitignore        비밀과 생성 파일 제외
Dockerfile        단일 서버 배포
```

## 테스트와 문제 해결

```sh
npm test
npm run check
```

테스트는 실제 아임웹 credential을 사용하지 않습니다. 실제 MCP SDK 클라이언트가 로컬 서버의 도구를 조회·실행하며, 아임웹 부분만 모의 응답으로 대체합니다.

- `Missing IMWEB_...`: `.env`의 세 항목 입력 및 `npm start` 사용 여부 확인.
- OAuth state 오류: 같은 브라우저에서 `/oauth/start`부터 다시 시작. 오래된 콜백을 새로고침하지 않기.
- Redirect 오류: 아임웹 등록 주소와 `PUBLIC_BASE_URL` 확인.
- 401 / 30101 / 30102: 토큰 갱신을 한 번 시도합니다. 재발 시 `/oauth/start`에서 재승인.
- 403 / 30103: 사이트 테스트 연동과 `site-info:read` 확인. 쓰기 권한을 추가하지 않기.
- 429: 잠시 기다린 뒤 다시 조회. 자동 반복 호출하지 않기.
- Host/Origin 오류: 설정한 도메인으로 접속하고 프록시의 Host 전달 설정 확인.
- 재배포 후 연결 끊김: ChatGPT 다시 연결. 아임웹도 끊기면 영구디스크 경로·암호화 키 확인.

공식 출처와 명세 차이는 [API-NOTES.md](docs/API-NOTES.md)에 기록했습니다.
