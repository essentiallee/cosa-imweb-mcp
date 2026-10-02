# 쓰기 기능 추가 (2026-09-30)

사용자 승인으로 OAuth 요청 scope를 `site-info:write script:write`로 변경했습니다. 사이트 정보 read-only 요청 시 실제 아임웹 응답 30156에서 site-info:write가 필수임을 확인했습니다.

공식 OpenAPI `/script`: GET(query unitCode/position, data 배열), POST/PUT(JSON unitCode/position/scriptContent, data boolean). 등록/수정에는 script:write가 필요합니다. 공식 명세를 다시 내려받아 이 계약으로 구현했습니다. 기존 스크립트는 수정 전 암호화 백업하며 쓰기는 자동 재시도하지 않습니다. 아래는 최초 구현 시의 조사 기록으로, 현재 권한은 이 상단 내용을 따릅니다.

# 공식 명세 확인 기록

확인일: 2026-09-30. 구형 `api.imweb.me/v2` API는 사용하지 않습니다.

- [Imweb OAuth 가이드](https://developers-docs.imweb.me/guide/개발-가이드-확인하기/oauth-2.0)
- [Imweb OpenAPI JSON](https://developers-docs.imweb.me/reference/openapi.json)
- [Imweb 준비하기](https://developers-docs.imweb.me/guide/준비하기)
- [Imweb 앱 연동하기](https://developers-docs.imweb.me/guide/앱-연동하기)
- [ChatGPT Developer Mode](https://developers.openai.com/api/docs/guides/developer-mode)
- [공식 MCP TypeScript SDK v1](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)

## 사용한 계약

| 단계 | 계약 |
|---|---|
| 인가 | `GET https://openapi.imweb.me/oauth2/authorize` |
| 인가 query | `responseType=code`, `clientId`, `redirectUri`, `scope=site-info:read`, `state`, `siteCode` |
| 토큰 | `POST https://openapi.imweb.me/oauth2/token` |
| 요청 body | `application/x-www-form-urlencoded`, camelCase 필드 |
| 최초 교환 | `grantType=authorization_code`, `clientId`, `clientSecret`, `redirectUri`, `code` |
| 갱신 | `grantType=refresh_token`, `clientId`, `clientSecret`, `refreshToken` |
| 응답 | `statusCode`, `data.accessToken`, `data.refreshToken`, `data.scope` |
| 사이트 READ | `GET https://openapi.imweb.me/site-info`, `Authorization: Bearer ...` |

가이드는 일부 토큰 필드를 '쿼리 파라미터'로 표기하지만 OpenAPI의 requestBody 및 30122 오류 설명에 맞춰 form body로 전송합니다. Secret을 URL query에 넣지 않습니다. OpenAPI의 `basic` security 선언에 따라 Basic 헤더도 함께 사용합니다. 실제 아임웹 계정과의 교환은 아직 검증하지 않았습니다.

가이드의 scope 응답은 배열, OpenAPI는 공백 구분 문자열입니다. 둘 다 파싱하며 `site-info:read` 이외 scope 또는 scope 누락은 안전하게 거절합니다. 토큰 수명은 가이드 기준 access 2시간 / refresh 90일이며, 만료 60초 전 갱신합니다. 갱신된 refresh token도 원자적으로 저장합니다. 만료 오류 시 한 번만 갱신·재조회하고 권한/속도 제한 오류는 반복하지 않습니다.

일반 앱스토어 설치의 integration-complete는 `PATCH`와 `site-info:write`가 필요합니다. 요청 범위 밖이므로 구현하지 않았습니다. 테스트 연동 상태에서 먼저 검증합니다.

## 운영 범위

단일 프로세스/단일 소유자용입니다. 수평 확장 시 영구 데이터베이스 기반 OAuth 세션 저장·분산 토큰 갱신 잠금이 필요합니다. MCP 인증용 토큰과 아임웹 토큰을 분리하며, MCP 클라이언트에 아임웹 토큰을 전달하지 않습니다. 앱은 URL·헤더·body를 로그에 기록하지 않습니다. 호스팅의 별도 HTTP 로그도 같은 원칙으로 설정해야 합니다.

## 실제 스크립트 저장 검증

2026-09-30: Overview 메뉴 위치에 link/style만 담은 요청은 HTTP 400, error.errorCode=30173으로 거절되었습니다. 동일 CSS와 폰트 링크를 script 태그 내 DOM 생성 코드로 전달하니 등록 성공, API 재조회 일치 및 브라우저 적용을 확인했습니다. 권한이나 앱 심사 문제가 아니었습니다. 모든 HTML 조합의 허용 여부를 일반화하지 말고 이 확인된 형식을 사용하세요.
