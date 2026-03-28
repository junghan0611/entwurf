# meta-config Emacs Integration

meta-config의 계층적 에이전트 아키텍처를 위한 Emacs Lisp 통합 레이어

## 파일 목록

### agent-shell-config.el

ACP(Agent Client Protocol) 기반 agent-shell과 meta-config의 통합 레이어

**주요 기능:**
- 디바이스 컨텍스트 인식 (LAPTOP/STORAGE-01/GPU-01~03)
- Git 저장소 상태 실시간 표시
- 세션 모드 및 에이전트 상태 모니터링
- 토큰 사용량 추정 및 컴팩트 시점 경고
- 커스텀 시스템 프롬프트 주입 (향후 acp.el 업데이트 후)

**설치:**

```elisp
;; ~/.emacs.d/init.el 또는 doom/config.el
(add-to-list 'load-path "~/repos/gh/meta-config/emacs/")
(require 'agent-shell-config)
```

**설정 (선택사항):**

```elisp
;; 커스텀 프롬프트 템플릿 변경
(setq jh/agent-custom-prompt-template
      "당신의 시스템 프롬프트...")

;; 컨텍스트 윈도우 크기 변경
(setq jh/claude-context-window 200000)

;; 디바이스 파일 경로 변경
(setq jh/device-file "~/.current-device")
```

**사용법:**

1. `M-x agent-shell-anthropic` 실행
2. 모드라인에 자동으로 표시:
   - `[LAPTOP]` - 현재 디바이스
   - `[main]` - Git 브랜치
   - `[Always Ask]` - 세션 모드
   - `[45%]` - 토큰 사용량

**토큰 경고:**
- 🟡 80%+: 곧 컴팩트 필요
- 🔴 90%+: 즉시 컴팩트 필요

**함수:**

| 함수 | 설명 |
|------|------|
| `jh/get-current-device` | 현재 디바이스 이름 |
| `jh/get-git-branch` | Git 브랜치 |
| `jh/estimate-token-usage` | 토큰 사용량 추정 |
| `jh/agent-context-indicator` | 모드라인 표시 |
| `jh/agent-new-session-with-meta-prompt` | 커스텀 프롬프트로 세션 시작 |
| `jh/agent-shell-meta-config-enable` | 통합 활성화 |
| `jh/agent-shell-meta-config-disable` | 통합 비활성화 |

## 의존성

- Emacs 29.1+
- agent-shell 0.1+
- magit 3.0+ (선택사항, Git 브랜치 표시용)

## 구조

```
emacs/
├── agent-shell-config.el  # ACP 통합 레이어
└── README.md              # 이 파일
```

## 관련 문서

- [ACP 메타데이터 활용 가이드](../docs/20251111T102000--acp-메타데이터-활용-가이드__solution_acp_agent_shell.org)
- [Emacs Integration](../docs/20251014T142000--emacs-integration-acpel과-계층적-에이전트__meta_emacs_acp_integration.org)
- [Implementation Architecture](../docs/20251014T141000--implementation-architecture-표준-프로토콜-기반-구현__meta_implementation_architecture_acp_mcp_a2a.org)

## 라이선스

Apache-2.0 (meta-config 프로젝트와 동일)

## 작성

Junghan Kim (junghanacs@gmail.com)
2025-11-11
