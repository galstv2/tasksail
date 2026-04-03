# Backward-compatible shim — all targets delegate to pnpm scripts.
# Prefer `pnpm run <command>` directly.

.PHONY: help setup validate local-checks test-smoke test-domain test-integration test-contracts test-targeted check-sizes lint-python qmd-seed-dry-run plan-dropbox-task new-task watch-dropbox queue-status complete-pending-item agent agent-pipeline agent-status

help:
	@echo "TaskSail (pnpm workspace)"
	@echo "  Prefer 'pnpm run <command>' directly."
	@echo ""
	@echo "  make setup                 → pnpm run setup"
	@echo "  make validate              → pnpm run validate"
	@echo "  make local-checks          → pnpm run local-checks"
	@echo "  make test-smoke            → pnpm run test:smoke"
	@echo "  make test-domain DOMAIN=x  → pnpm run test:domain -- --domain x"
	@echo "  make test-integration      → pnpm run test:integration"
	@echo "  make test-contracts        → pnpm run test:contracts"
	@echo "  make check-sizes           → pnpm run check-sizes"
	@echo "  make lint-python           → pnpm run lint:python"
	@echo "  make new-task TITLE=x      → pnpm run new-task -- --title x"
	@echo "  make plan-dropbox-task     → pnpm run plan-dropbox-task"
	@echo "  make watch-dropbox         → pnpm run watch-dropbox"
	@echo "  make queue-status          → pnpm run queue-status"
	@echo "  make complete-pending-item → pnpm run complete-pending-item"
	@echo "  make agent AGENT_ID=x     → pnpm run agent -- --agent-id x"
	@echo "  make agent-pipeline       → pnpm run agent:pipeline"
	@echo "  make agent-status         → pnpm run agent:status"

setup:
	pnpm run setup

validate:
	pnpm run validate

local-checks:
	pnpm run local-checks

test-smoke:
	pnpm run test:smoke

test-domain:
	pnpm run test:domain -- --domain "$(DOMAIN)"

test-integration:
	pnpm run test:integration

test-contracts:
	pnpm run test:contracts

test-targeted:
	pnpm run local-checks -- --changed-path "$(CHANGED)"

check-sizes:
	pnpm run check-sizes

lint-python:
	pnpm run lint:python

qmd-seed-dry-run:
	pnpm run qmd:seed-dry-run -- --context-pack-dir "$(CONTEXT_PACK_DIR)" $(if $(WRITE_PLAN),--write-plan,)

plan-dropbox-task:
	pnpm run plan-dropbox-task -- $(if $(TITLE),--title "$(TITLE)",) $(if $(SUMMARY),--summary "$(SUMMARY)",)

new-task:
	pnpm run new-task -- $(if $(TITLE),--title "$(TITLE)",)

watch-dropbox:
	pnpm run watch-dropbox

queue-status:
	pnpm run queue-status

complete-pending-item:
	pnpm run complete-pending-item

agent:
	pnpm run agent -- --agent-id "$(AGENT_ID)"

agent-pipeline:
	pnpm run agent:pipeline

agent-status:
	pnpm run agent:status
