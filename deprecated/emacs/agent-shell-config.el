;;; agent-shell-config.el --- meta-config ACP Integration Layer -*- lexical-binding: t -*-

;; Copyright (C) 2025 Junghan Kim
;; Author: Junghan Kim <junghanacs@gmail.com>
;; URL: https://github.com/junghan0611/meta-config
;; Version: 0.1.0
;; Package-Requires: ((emacs "29.1") (agent-shell "0.1") (magit "3.0"))
;; Keywords: ai, agent, acp, meta-config

;;; Commentary:
;;
;; meta-config의 계층적 에이전트 아키텍처를 위한 ACP 통합 레이어
;;
;; 주요 기능:
;; 1. 디바이스 컨텍스트 인식 (LAPTOP/STORAGE-01/GPU-01~03)
;; 2. Git 저장소 상태 표시
;; 3. 세션 모드 및 에이전트 상태 모니터링
;; 4. 토큰 사용량 추정 및 경고
;; 5. 커스텀 시스템 프롬프트 주입
;;
;; 설치:
;;   (add-to-list 'load-path "~/repos/gh/meta-config/emacs/")
;;   (require 'agent-shell-config)
;;
;; 설정:
;;   (setq jh/agent-custom-prompt-template "...")
;;   (setq jh/claude-context-window 200000)

;;; Code:

(require 'agent-shell nil t)
(require 'magit nil t)

;;; Customization

(defgroup agent-shell-meta-config nil
  "meta-config integration for agent-shell."
  :group 'agent-shell
  :prefix "jh/agent-")

(defcustom jh/agent-custom-prompt-template
  "당신은 NixOS와 Emacs 전문가이며, meta-config 생태계를 이해합니다.

현재 환경:
- 디바이스: %s
- 작업 컨텍스트: ~/claude-memory/ Git 저장소 기반 메모리 시스템
- 프로젝트: ~/repos/gh/meta-config/ - 계층적 에이전트 아키텍처

핵심 규칙:
1. 모든 메모리는 Denote 형식으로 저장 (YYYYMMDDTHHMMSS--제목__태그.org)
2. Git으로 동기화 (commit 후 push 필수)
3. 디바이스별 작업 컨텍스트 유지 (LAPTOP/STORAGE-01/GPU-01~03)
4. NixOS 선언형 설정 우선 (configuration.nix, home-manager)
5. Emacs Lisp는 간결하고 명확하게"
  "meta-config용 에이전트 시스템 프롬프트 템플릿.
%s는 디바이스 이름으로 치환됩니다."
  :type 'string
  :group 'agent-shell-meta-config)

(defcustom jh/claude-context-window 200000
  "Claude Sonnet 4.5의 컨텍스트 윈도우 크기 (토큰).
기본값: 200,000 토큰"
  :type 'integer
  :group 'agent-shell-meta-config)

(defcustom jh/device-file "~/.current-device"
  "현재 디바이스 정보를 저장하는 파일 경로."
  :type 'string
  :group 'agent-shell-meta-config)

;;; Utility Functions

(defun jh/get-current-device ()
  "현재 디바이스 이름을 가져옵니다.
~/.current-device 파일에서 읽거나, 없으면 'UNKNOWN' 반환."
  (condition-case nil
      (with-temp-buffer
        (insert-file-contents (expand-file-name jh/device-file))
        (string-trim (buffer-string)))
    (error "UNKNOWN")))

(defun jh/get-git-branch ()
  "현재 디렉토리의 Git 브랜치를 가져옵니다.
magit이 있으면 사용하고, 없으면 nil 반환."
  (when (fboundp 'magit-get-current-branch)
    (magit-get-current-branch)))

(defun jh/estimate-token-usage ()
  "현재 agent-shell 버퍼의 토큰 사용량을 추정합니다.
1토큰 ≈ 4자 (한글/영문 평균) 휴리스틱 사용.
80% 이상이면 경고 표시."
  (when (derived-mode-p 'agent-shell-mode)
    (let* ((content (buffer-string))
           (char-count (length content))
           (estimated-tokens (/ char-count 4))
           (usage-ratio (/ (float estimated-tokens) jh/claude-context-window)))
      (cond
       ((> usage-ratio 0.9)
        (propertize (format " [🔴 %.0f%%]" (* usage-ratio 100))
                    'face 'error
                    'help-echo (format "토큰: ~%d/%d (컴팩트 필요!)"
                                      estimated-tokens jh/claude-context-window)))
       ((> usage-ratio 0.8)
        (propertize (format " [🟡 %.0f%%]" (* usage-ratio 100))
                    'face 'warning
                    'help-echo (format "토큰: ~%d/%d (곧 컴팩트 필요)"
                                      estimated-tokens jh/claude-context-window)))
       ((> usage-ratio 0.5)
        (propertize (format " [%.0f%%]" (* usage-ratio 100))
                    'face 'font-lock-comment-face
                    'help-echo (format "토큰: ~%d/%d"
                                      estimated-tokens jh/claude-context-window)))
       (t "")))))

;;; Mode Line Integration

(defun jh/agent-session-mode-string ()
  "세션 모드 문자열을 가져옵니다 (agent-shell 내부 상태 직접 접근)."
  (when (and (derived-mode-p 'agent-shell-mode)
             (fboundp 'agent-shell--state)
             (fboundp 'agent-shell--resolve-session-mode-name))
    (when-let ((mode-name (agent-shell--resolve-session-mode-name
                           (map-nested-elt (agent-shell--state) '(:session :mode-id))
                           (map-nested-elt (agent-shell--state) '(:session :modes)))))
      (propertize (format "[%s]" mode-name)
                  'face 'font-lock-type-face
                  'help-echo (format "Session Mode: %s" mode-name)))))

(defun jh/agent-status-frame ()
  "활동 상태 애니메이션 프레임 (agent-shell 내부 로직 복제 없이 참조)."
  (when (and (derived-mode-p 'agent-shell-mode)
             (fboundp 'agent-shell--status-frame))
    (agent-shell--status-frame)))

(defun jh/agent-context-indicator ()
  "meta-config 컨텍스트 정보를 모드라인에 표시합니다.
디바이스, Git 브랜치, 세션 모드, 토큰 사용량을 포함.
중복 방지를 위해 agent-shell 내부 함수 대신 직접 구현."
  (when (and (derived-mode-p 'agent-shell-mode)
             (memq agent-shell-header-style '(text none nil)))
    (concat
     ;; 디바이스 표시
     (let ((device (jh/get-current-device)))
       (propertize (format "[%s] " device)
                   'face (if (string= device "UNKNOWN")
                            'warning
                          'success)
                   'help-echo "현재 디바이스"))

     ;; Git 브랜치
     (when-let ((branch (jh/get-git-branch)))
       (propertize (format "[%s] " branch)
                   'face 'font-lock-keyword-face
                   'help-echo "현재 Git 브랜치"))

     ;; 세션 모드 (agent-shell 중복 방지)
     (when-let ((mode-str (jh/agent-session-mode-string)))
       (concat " " mode-str))

     ;; 활동 상태
     (jh/agent-status-frame)

     ;; 토큰 사용량 추정
     (jh/estimate-token-usage))))

;;; Custom Prompt Injection

(defun jh/agent-get-custom-prompt ()
  "현재 환경 기반 커스텀 프롬프트를 생성합니다."
  (format jh/agent-custom-prompt-template
          (jh/get-current-device)))

(defun jh/agent-new-session-with-meta-prompt ()
  "meta-config 커스텀 프롬프트로 새 세션을 시작합니다.
ACP의 _meta.systemPrompt 확장을 활용합니다.

주의: acp.el에 _meta 지원이 추가되어야 동작합니다.
현재는 placeholder 함수입니다."
  (interactive)
  (message "커스텀 프롬프트 주입 기능은 acp.el 업데이트 후 활성화됩니다.")
  (message "프롬프트 미리보기:\n%s" (jh/agent-get-custom-prompt))
  ;; TODO: acp.el에 _meta 지원 추가 후 주석 해제
  ;; (let ((custom-prompt (jh/agent-get-custom-prompt)))
  ;;   (acp-send-request
  ;;    :client (map-elt (agent-shell--state) :client)
  ;;    :request (acp-make-session-new-request
  ;;              :cwd default-directory
  ;;              :_meta `((systemPrompt . ((append . ,custom-prompt)))))))
  )

;;; Setup Hook

(defun jh/agent-shell-setup ()
  "agent-shell 버퍼에 meta-config 통합을 활성화합니다.
agent-shell 기본 모드라인을 제거하고 meta-config 버전으로 대체."
  ;; agent-shell 기본 모드라인 제거
  (setq-local mode-line-misc-info
              (seq-remove (lambda (item)
                            (and (listp item)
                                 (eq (car item) :eval)
                                 (listp (cadr item))
                                 (eq (car (cadr item)) 'agent-shell--mode-line-format)))
                          mode-line-misc-info))
  ;; meta-config 모드라인 추가
  (setq-local mode-line-misc-info
              (append mode-line-misc-info
                      '((:eval (jh/agent-context-indicator))))))

;;;###autoload
(defun jh/agent-shell-meta-config-enable ()
  "meta-config ACP 통합을 활성화합니다."
  (interactive)
  (add-hook 'agent-shell-mode-hook #'jh/agent-shell-setup)
  (message "meta-config ACP 통합이 활성화되었습니다."))

;;;###autoload
(defun jh/agent-shell-meta-config-disable ()
  "meta-config ACP 통합을 비활성화합니다."
  (interactive)
  (remove-hook 'agent-shell-mode-hook #'jh/agent-shell-setup)
  (message "meta-config ACP 통합이 비활성화되었습니다."))

;; Auto-enable on load
(with-eval-after-load 'agent-shell
  (jh/agent-shell-meta-config-enable))

(provide 'agent-shell-config)

;;; agent-shell-config.el ends here
