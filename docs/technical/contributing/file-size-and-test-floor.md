# File Size And Test Floor

TaskSail tracks file-size limits and test-count floors as validation gates. The file-size checker reports warnings for known over-baseline files and fails when files exceed enforced limits. The test-floor checker keeps test coverage from dropping below the recorded module floors.

Run:

```bash
pnpm run check-sizes
pnpm run check-test-floor
```

Do not update baselines as part of unrelated docs work. Baseline changes require a dedicated rationale.

## Sources of truth

- [file-size checker](../../../src/backend/platform/validation/fileSizes.ts)
- [file-size baseline](../../../src/backend/platform/validation/data/file-size-baseline.txt)
- [test-floor checker](../../../src/backend/platform/validation/testCountFloor.ts)
- [test-floor baseline](../../../src/backend/platform/validation/data/test-count-floor.txt)
