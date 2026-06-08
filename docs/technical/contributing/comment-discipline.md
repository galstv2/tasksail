# Comment Discipline

Comments should explain why code behaves a certain way when the reason is not obvious from the code itself. Good comments cover security boundaries, compatibility, concurrency, locking, path safety, lifecycle ordering, fallback semantics, external-system behavior, and non-obvious test rationale.

Avoid comments that restate code, preserve planning artifact references, decorate sections, or carry stale implementation history. If a valuable comment includes a planning or audit label, keep the operational meaning and remove the label.

Run:

```bash
pnpm run check-comments
```

## Sources of truth

- [comment discipline checker](../../../src/backend/platform/validation/commentDiscipline.ts)
- [comment discipline tests](../../../src/backend/platform/validation/__tests__/commentDiscipline.test.ts)
- [validation CLI](../../../src/backend/platform/validation/cli.ts)
