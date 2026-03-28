# CLAUDE.md - Agent Instructions for meta-config

**Version**: 1.0.0  
**Updated**: 2025-11-11  
**Project**: meta-config - Hierarchical Agent Architecture

## Project Context

meta-config는 계층적 에이전트 아키텍처를 위한 표준 프로토콜 통합 레이어입니다.

**핵심 개념**:
- ACP(Agent Client Protocol) + MCP(Model Context Protocol) 하이브리드
- 디바이스별 컨텍스트 격리 (LAPTOP/STORAGE-01/GPU-01~03)
- Git 기반 동기화 및 메모리 관리

## Directory Structure

```
meta-config/
├── CLAUDE.md           # 이 파일 (에이전트 지침)
├── README.md           # 프로젝트 개요
├── docs/               # Denote 형식 문서 (*.org)
├── emacs/              # Emacs Lisp 통합 레이어
├── examples/           # 사용 예제
└── schemas/            # JSON 스키마
```

## Coding Standards

### Python
- **환경**: shell.nix로 격리된 개발 환경 구성 필수
- **의존성**: requirements.txt 대신 shell.nix에 명시
- **예시**:
  ```nix
  { pkgs ? import <nixpkgs> {} }:
  pkgs.mkShell {
    buildInputs = with pkgs; [
      python311
      python311Packages.requests
    ];
  }
  ```

### Bash Scripts
- **NixOS 호환**: 절대 경로 회피, which/type 활용
- **명령어 치환**: `$(cmd)` 금지 → 단계별 분리
- **예시**:
  ```bash
  # ❌ uid=$(id -u)
  # ✅
  id -u > /tmp/uid
  uid=$(cat /tmp/uid)
  ```

### Documentation
- **형식**: Denote 형식 org-mode (docs/ 디렉토리)
- **파일명**: `YYYYMMDDTHHMMSS--제목__태그들.org`
- **헤더**:
  ```org
  #+title:      제목
  #+date:       [YYYY-MM-DD Day HH:MM]
  #+filetags:   :tag1:tag2:
  #+identifier: YYYYMMDDTHHMMSS
  ```

## Project-Specific Rules

### 1. Git Workflow
- **커밋 전**: 반드시 현재 상태 확인
- **메시지**: 간결하고 명확하게 (AI 서명 제외)
- **푸시**: 커밋 후 즉시 push

### 2. Device Context
- 모든 스크립트는 `~/.current-device` 파일 확인
- 디바이스별 환경 차이 고려:
  - LAPTOP: Ubuntu 24.04
  - STORAGE-01/GPU-0X: NixOS 25.05

### 3. ACP Integration
- `emacs/agent-shell-config.el`이 핵심 통합 레이어
- 새 기능은 계층적 구조 유지하며 추가
- _meta 확장 활용 (ACP 표준 준수)

### 4. Documentation
- 기술 문서는 docs/에 Denote 형식
- 사용자 가이드는 각 디렉토리 README.md
- 에이전트 지침은 CLAUDE.md (이 파일)

## Quick Reference

### 새 문서 생성
```bash
# Denote 타임스탬프 생성
date '+%Y%m%dT%H%M%S'
# => 20251111T103000

# 파일 생성
docs/20251111T103000--제목__태그1_태그2.org
```

### shell.nix 템플릿
```nix
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    python311
    # 필요한 패키지 추가
  ];
}
```

### 디바이스 확인
```bash
cat ~/.current-device  # => LAPTOP, STORAGE-01, GPU-0X
```

## Important Notes

- **메모리 시스템**: ~/claude-memory/ (별도 저장소)와 연동하지 말 것
- **독립성**: meta-config는 독립적인 프로토콜 레이어
- **확장성**: 새 에이전트 추가 시 계층 구조 유지
- **테스트**: 모든 코드는 NixOS 환경에서 검증

## Next Steps

1. 현재 작업 컨텍스트 파악 (디바이스, Git 브랜치)
2. 관련 문서 확인 (docs/ 디렉토리)
3. 계층적 구조 준수하며 구현
4. Git 커밋 및 푸시

---
**Created**: 2025-11-11  
**Maintainer**: junghanacs@gmail.com
