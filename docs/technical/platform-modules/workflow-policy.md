# Workflow Policy Module

`workflow-policy` owns runtime legality checks for task artifacts, registry requirements, role execution, template structure, closeout, bootstrap legality, content rules, and validation output. It is the canonical guardrail layer for workflow behavior.

The agent wrapper launches work, but workflow-policy decides whether required artifacts and rule families satisfy the current task state. Guarded checks fail closed when required context is missing.

## Sources of truth

- [workflow policy CLI](../../../src/backend/platform/workflow-policy/cli.ts)
- [workflow models](../../../src/backend/platform/workflow-policy/models.ts)
- [workflow validator](../../../src/backend/platform/workflow-policy/validator.ts)
- [workflow rule index](../../../src/backend/platform/workflow-policy/rules/index.ts)
