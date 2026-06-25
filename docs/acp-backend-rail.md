# ACP Backend Adapter Rail (표준궤) — 0.12.0 설계 초안

> **Status: 규격 확정 (GPT 합의 2026-06-25), 구현 대기.** GLG 결정 + GPT(`…341a87`) 검토 반영.
> 확정 규격은 **§9**. 다음: (1) GLG가 claude 리팩터로 레일을 깔고 (2) 기여자(hvkiefer)가 PR #40
> cortex를 이 레일 위 어댑터 하나로 포팅한다. (§3 인터페이스는 GPT 제안 반영본, §7은 해소된 논의 기록.)

## 1. 왜 (배경)

- PR [#40](https://github.com/junghan0611/entwurf/pull/40)(Snowflake Cortex Code, hvkiefer)은 **0.12.0에서
  삭제된** `acp-bridge.ts`/`index.ts`(0.11.0 fat-bridge) 위에 작성됐다. 단순 rebase conflict가 아니라
  그 아키텍처가 사라졌다.
- **0.11.0엔 표준궤가 있었다:** `type AcpBackend = "claude"|"codex"|"gemini"`,
  `type AcpBackendAdapter`, `ACP_BACKEND_ADAPTERS: Record<AcpBackend, AcpBackendAdapter>`,
  `resolveAcpBackendAdapter(backend)`. PR #40은 cortex를 4번째로 끼웠을 뿐 — 기여자 표현:
  *"slots into the existing AcpBackendAdapter pattern the same way Gemini does."*
- **0.12.0 cutover가 그 레일을 걷어냈다.** fat-bridge를 통째 버리고 Claude-first로 새로 빌드
  (CHANGELOG: "a fresh build on the v2 core, not a port of the old architecture"). 결과:
  - `lib/acp/`에 백엔드 추상화 **0건**.
  - `config.ts:374` — `backend !== "claude"`면 `throw`로 차단.
  - 확장 의도는 주석으로만 남음: `models.ts:9-12` "Cortex would EXTEND this set — does not change the pattern."
- **판정:** 단일 claude 코드 품질은 0.12.0이 더 깔끔(11모듈 분해, v2 위 thin plugin). 그러나
  **백엔드 추가 레일은 0.11.0보다 후퇴.** cortex가 들어올 seam이 없다.

## 2. 핵심 통찰 — seam은 이미 절반 존재한다

0.12.0 `backend.ts`는 이미 의존성 주입 구조체 `AcpTurnDeps`를 갖고 있고, `defaultDeps()`가 claude
전용 함수로 채운다(원래는 session-reuse fake 주입용):

```ts
function defaultDeps(): AcpTurnDeps {
  return {
    resolveLaunch,                                  // claude launch (인자 없음)
    ensureOverlay: ensureClaudeConfigOverlay,        // CLAUDE_CONFIG_DIR overlay
    spawnChild: (launch, cwd) => spawn(..., { env: { ...process.env, ...claudeLaunchEnvDefaults() } }),
    createConnection: ...,                           // 백엔드 불변 (ndJsonStream + connectAcpClient)
    lifecyclePolicy: ...,                            // 백엔드 불변
    loadConfig: (cwd, modelId) => resolveProviderConfig({ cwd, modelId }),
    now: ...,
  };
}
```

→ **레일 재도입 = 이 `AcpTurnDeps`의 백엔드-특정 부분을 `AcpBackendAdapter`로 묶고, `defaultDeps()`가
modelId로 어댑터를 골라 채우게 하는 것.** turn orchestration 본체(streamShellAcp의 spawn→initialize→
newSession→enforce→prompt→event-map 루프)는 **백엔드 불변으로 그대로 유지**된다. 이게 0.11.0의 거대
`ACP_BACKEND_ADAPTERS` Record 분기보다 testable하고 깔끔할 수 있는 이유 — seam이 이미 deps로 존재.

## 3. `AcpBackendAdapter` 인터페이스 (초안 — 논의 대상)

```ts
export interface AcpBackendAdapter {
  /** Discriminator. BridgeSession/configSig에 명시 저장(modelId 파싱 의존 제거),
   *  tool-surface assertions(assertExcludeToolsHonored backend). */
  readonly backend: string;                          // "claude" | "cortex"

  /** modelId가 이 어댑터 소유면 native model id로 라우팅, 아니면 undefined.
   *  ownsModel(boolean)을 쓰면 unprefixed claude가 과넓게 잡음 → owns+prefix-strip을
   *  한 메서드로. registry adapter order에 안 기댐. cortex-claude-sonnet-4-6 →
   *  { nativeModelId: "claude-sonnet-4-6" }, cortex-auto → { nativeModelId: "auto" }. */
  routeModel(modelId: string): { nativeModelId: string } | undefined;

  /** provider registry에 기여하는 curated model rows. */
  curatedModels(): AcpModelRow[];

  /** ACP 서버 launch. native model id 사용(cortex -m, -c). */
  resolveLaunch(params: {
    cwd: string; modelId: string; nativeModelId: string; config: ResolvedAcpConfig;
  }): AcpLaunchSpec;

  /** spawn 시 process.env 위에 머지할 백엔드 launch env defaults. */
  launchEnvDefaults(): Record<string, string>;

  /** config overlay(auth passthrough + state hiding). envOverrides만 반환 — spawn이
   *  공통 머지. sweep은 어댑터 내부(필요시 diagnostic만). no-op = { envOverrides: {} }. */
  ensureOverlay(params: AcpOverlayParams): { envOverrides: Record<string, string> };

  /** system-prompt carrier _meta. engraving 로딩까지 캡슐화 — carrier 없으면 undefined
   *  반환(backend.ts가 newSession에서 _meta 키 omit). cortex는 loadEngraving 자체를
   *  안 부른다. rich context(augment)는 carrier와 무관하게 항상 운반(별개 경로). */
  buildSessionMeta(params: AcpSessionMetaParams): AcpSessionMeta | undefined;

  /** 모델 강제. 단일 메서드가 백엔드 차이 흡수(flag 불필요). native model id 사용.
   *  claude=session/set_config_option, cortex=no-op + launch-pin assertion. */
  enforceModel(params: AcpEnforceModelParams): Promise<void>;

  /** bridgeConfigSignature에 접히는 필드: backend, nativeModelId, backend-specific
   *  connection/profile/env-derived stable id. env 원문 값/secret 금지. */
  configSignatureFields(config: ResolvedAcpConfig): Record<string, unknown>;
}

/** modelId → 어댑터. 0개 매칭=throw(unknown model), 2개 매칭=throw(prefix 충돌,
 *  startup fail-fast). claude=unprefixed 기본, non-claude=reserved prefix 필수(cortex-*). */
export function resolveAcpBackendAdapter(modelId: string): AcpBackendAdapter;
```

## 4. 7 seam 명세 (claude 현재 / cortex = PR #40이 0.11.0에서 실증)

| seam | claude (현재 0.12.0) | cortex (PR #40 실증) |
|---|---|---|
| **resolveLaunch** | `@agentclientprotocol/claude-agent-acp` npm bin resolve, `CLAUDE_AGENT_ACP_COMMAND` override | `cortex acp serve` PATH resolve(+`-c <conn>` `-m <model>`), `CORTEX_ACP_COMMAND` override |
| **launchEnvDefaults** | `claudeLaunchEnvDefaults()` | `SNOWFLAKE_HOME`=overlay, `CORTEX_DISABLE_AUTO_APPLY_PROFILES=1` |
| **ensureOverlay** | `CLAUDE_CONFIG_DIR` whitelist overlay(auth/runtime 보존, memory/hooks/project 숨김, `hooks:{}`) | `SNOWFLAKE_HOME` symlink-passthrough(`connections.toml`/`config.toml`/cred cache/skills) + conv/profile/memory/mcp/hooks 숨김 + 매 spawn sweep |
| **buildSessionMeta** | `_meta.systemPrompt`(짧고 순수, 빌링 안전) | **undefined** — Cortex ACP엔 systemPrompt carrier 없음 → engraving이 first-user augment로 |
| **curated models + 라우팅** | `getModels("anthropic")` 2개(prefix 없음) | hand-curated `cortex-auto`/`cortex-claude-sonnet-4-6`(pi-ai에 cortex source 없음), `cortex-` prefix → `inferBackendFromModel` 라우팅, launch 시 prefix strip해 native `-m` 복원 |
| **enforceModel** | per-turn `session/set_config_option(configId="model")` | **launch-time `-m` pin**, per-turn switch **금지**(Cortex는 session config로 모델 노출 → spurious per-turn invalidation 방지) |
| **settings + signature** | (단일) | `backend:"cortex"`, `cortexConnection`(또는 env) → `bridgeConfigSignature`에 접힘(conn 변경 시 reuse 무효) |
| **gates** | `check-acp-*` | `check-backends`(launch/strip/override/env-pin/undefined-meta/overlay-passthrough), `check-models`(prefix+anti-collision), `smoke-cortex`(on-demand, claude-only floor 밖) |

**두 비대칭이 인터페이스 설계의 시금석이다:**
1. `buildSessionMeta`가 **undefined를 반환할 수 있어야** 한다(cortex carrier 부재). backend.ts는 undefined면
   engraving을 first-user augment 경로로 흘린다 — 이 fallback이 이미 augment.ts에 있는지 확인 필요.
2. `enforceModel`이 **per-turn vs launch-pin을 흡수**해야 한다. claude는 매 턴 set_config_option,
   cortex는 launch에 박고 턴마다 안 건드림. 인터페이스가 이 둘을 같은 메서드 뒤로 숨겨야 "혼란 없는 표준궤".

## 5. claude 리팩터 경로 (GLG가 깔 레일)

1. `AcpBackendAdapter` 인터페이스 + `resolveAcpBackendAdapter(modelId)` 추가(신규 `lib/acp/backend-adapter.ts`).
2. 현재 claude 하드코딩을 `claudeAdapter` 객체로 모은다: `resolveLaunch`/`ensureClaudeConfigOverlay`/
   `claudeLaunchEnvDefaults`/`buildClaudeSessionMeta`/claude enforce → 어댑터 메서드로.
3. `defaultDeps()`가 modelId로 어댑터를 골라 deps를 채움(turn loop 본체 불변).
4. `config.ts:374` claude-only `throw` 가드 → 어댑터 registry 조회(미등록 backend만 reject).
5. `models.ts`를 백엔드별 curated 병합 + prefix 라우팅으로 일반화(claude=prefix 없음 기본).
6. `acp-provider.ts`는 단일 `entwurf` provider 유지, `models`는 등록된 모든 어댑터의 `curatedModels()` 병합.

→ 이 단계까지가 "레일". cortex는 0건 추가(claude 단독으로 어댑터 패턴이 서는지 먼저 green).

## 6. 기여자 지침의 뼈대 (레일 확정 후)

PR #40을 0.12.0으로 포팅 = **어댑터 객체 하나(`cortexAdapter`) 작성 + 등록**:
- `lib/acp/adapters/cortex.ts`에 7 seam 구현(위 표 cortex 열).
- `resolveAcpBackendAdapter`에 prefix 등록.
- `check-backends`/`check-models`/`smoke-cortex` 게이트 추가.
- **backend.ts turn loop / acp-client / event-mapper / session-store는 건드리지 않는다**(불변식). 이게
  "레일이 깔렸다"의 검증 — 백엔드 추가가 어댑터 파일 + 게이트로 닫히면 표준궤.

## 7. 논의 포인트 (GPT)

1. **어댑터 선택 키 = modelId prefix 라우팅으로 충분한가?** 0.11.0은 `inferBackendFromModel` + `settings.backend`
   둘 다 썼다. 0.12.0 단일 provider에선 modelId prefix가 자연스러운데, claude를 "prefix 없음=기본"으로 둘지
   claude도 명시 prefix를 줄지(표준궤 규격의 핵심 결정).
2. **단일 provider 유지 확정?** `entwurf` 하나에 모든 백엔드 모델 + modelId 라우팅. vs provider-per-backend.
3. **`AcpTurnDeps` 승격 vs 별도 `AcpBackendAdapter` 객체?** deps에 어댑터를 흡수할지, 어댑터를 deps와 분리해
   `defaultDeps(adapter)`로 주입할지. 후자가 test seam(fake deps)과 backend seam(adapter)을 안 섞어 깔끔할 듯.
4. **`buildSessionMeta` undefined fallback이 이미 있나?** augment.ts가 carrier 부재 시 engraving을 first-user로
   흘리는 경로를 갖는지 — 없으면 레일에 추가해야 cortex가 산다.
5. **`enforceModel` 추상화 형태.** 메서드 하나 + 내부 분기 vs `supportsPerTurnModelSwitch` flag + 공통 enforce.
6. **overlay 출력 규격.** claude(CLAUDE_CONFIG_DIR)와 cortex(SNOWFLAKE_HOME)를 `ensureOverlay → { envOverrides,
   sweepDirs }` 같은 공통 출력으로 묶을지, 어댑터가 자유 구현하고 backend.ts는 envOverrides만 받을지.
7. **codex/gemini는?** 0.12.0 교리상 codex=native garden citizen(ACP 아님), gemini=deprecated. 레일이
   claude+cortex 2개만 다뤄도 되는지, 아니면 codex-ACP opt-in(`ENTWURF_ACP_FOR_CODEX=1`)도 어댑터로 흡수할지.

## 8. 역할 분담

- **GLG:** §5 레일(인터페이스 + claude 리팩터)을 깔고 claude 단독으로 게이트 green.
- **기여자(hvkiefer):** §6 cortex 어댑터 1개 포팅(PR #40 → 0.12.0).
- **GPT:** §7 논의 → 규격 확정.
- 위임 전제: GLG가 거의 다 해보고 인터페이스가 0.11.0보다 깔끔할 것.

## 9. 확정 규격 (GPT 합의 2026-06-25)

GPT(`…341a87`) 검토로 §7 논의 포인트가 전부 해소됐다. 확정 사항 — 이게 표준궤 규격이다:

1. **단일 `entwurf` provider + modelId prefix registry.** provider-per-backend 안 함.
   - non-claude 백엔드는 **reserved prefix 필수**(`cortex-*`). claude adapter는 **unprefixed** curated model만 소유.
   - `resolveAcpBackendAdapter(modelId)`: 0개 매칭=`throw`(unknown), 2개 매칭=`throw`(prefix 충돌). 충돌은 startup/check **fail-fast**.
   - `claude-*` 명시 prefix는 0.12.0 rail에 **넣지 않는다**(alias/dual identity 회피, 기존 id 비파괴).
2. **`AcpBackendAdapter`(product seam)와 `AcpTurnDeps`(test/runtime seam) 분리.** 합치지 않는다 — 합치면 fake deps가 fake backend처럼 보이고 어댑터가 clock/sessionDir/createConnection까지 떠안음.
   - turn 초입에서 `const adapter = resolveAcpBackendAdapter(model.id)` 1회 결정 → `defaultDeps(adapter)`.
   - `backend: adapter.backend`를 BridgeSession/BootstrapParams/configSig에 **명시 저장**(modelId 문자열 파싱 의존 제거).
3. **`routeModel(modelId)`로 owns+native-id strip을 한 메서드에.** `enforceModel`/`resolveLaunch`는 **native model id** 사용.
4. **`buildSessionMeta` undefined → `_meta` omit.** `newSessionParams = sessionMeta === undefined ? { cwd, mcpServers } : { cwd, mcpServers, _meta: sessionMeta }`. engraving 로딩은 어댑터 `buildSessionMeta` 내부에 캡슐화(cortex는 `loadEngraving` 자체를 안 부름 → shipped-engraving/appendSystemPrompt signature와 안 엮임). rich context(augment)는 carrier와 **무관하게 항상** `prependNewPromptAugment`로 운반(이미 존재 확인 — GPT). carrier 부재 백엔드의 operator engraving은 first-user augment로(PR #40 패턴) — augment 합류 디테일은 claude 리팩터 시 확정.
5. **`ensureOverlay → { envOverrides }`.** spawn 공통 머지 `env: { ...process.env, ...adapter.launchEnvDefaults(), ...overlay.envOverrides }`. sweep은 어댑터 내부, 필요시 diagnostic만.
6. **`enforceModel` 단일 메서드, flag 없음.** claude=`session/set_config_option`, cortex=no-op + launch-pin assertion(필요시 created session config 검증).
7. **`configSignatureFields`**: `backend`, `nativeModelId`, backend-specific connection/profile/env-derived **stable id**. env 원문 값/secret **금지**.
8. **codex/gemini = 0.12.0 non-goal.** codex=native garden citizen이 정위치. `ENTWURF_ACP_FOR_CODEX=1` ACP opt-in을 rail에 넣으면 "plugin은 plugin, sibling은 sibling" 경계가 흐림 → default registry **미등록**, future opt-in only, 별도 issue/branch에서 교리 충돌 검토.

**최종 규격 한 줄:** 단일 `entwurf` provider + modelId prefix registry(non-claude required) + 별도 Adapter 객체 + `defaultDeps(adapter)` + `buildSessionMeta` undefined 시 `_meta` omit, rich context는 first-user augment로 항상 운반 + codex ACP는 0.12.0 non-goal.

### Step B 검수 future notes (GPT 2026-06-25)

구현 완료 후 GPT가 남긴 후속 — cortex 포팅 시 반드시 반영:

- **`configSignatureFields`의 `extra`는 flat/sorted primitive map만.** key order가 안정적이어야 signature가 turn 간 안정(JSON.stringify 결정성). nested object / 비결정 순서 금지 — `check-backends`에 이 제약을 박는다.
- **`config.ts`의 `settings.backend` non-claude throw 가드는 cortex 포팅 전/동시 정리 필수.** 표준궤에서 routing authority는 **modelId prefix**다. `settings.backend`를 살린다면 duplicate authority가 되지 않도록 "diagnostic/compat only" 또는 "modelId prefix와 불일치 시 throw"로 한정. 지금 가드를 그대로 두면 `backend:"cortex"` 설정이 config 단계에서 막힌다.
- **persisted resume/load가 켜질 때** persisted record와 `adapter`/`backend`/`nativeModelId` 정합을 재검토(현재 persisted off라 무관).
