import {
  CONTEXT_PACK_TEST_ARTIFACT_TYPE,
  CONTEXT_PACK_TEST_PATH_KIND,
} from '../../src/shared/desktopContractDeepFocus';

export const ARTIFACT_TYPE_TEST_CODE = CONTEXT_PACK_TEST_ARTIFACT_TYPE;
export const PATH_KIND_TESTS = CONTEXT_PACK_TEST_PATH_KIND;

const TEST_DIRECTORY_SEGMENTS = new Set([
  'test',
  'tests',
  'spec',
  'specs',
  'e2e',
  '__test__',
  '__tests__',
  '__spec__',
  '__specs__',
]);

const LOWERCASE_SUFFIX_PATTERNS = [
  '_test.py',
  '_spec.py',
  '_test.go',
  '_test.dart',
  '_test.exs',
  '_spec.rb',
  '_test.cc',
  '_test.cpp',
  '_test.cxx',
  '_spec.cc',
  '_spec.cpp',
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.test.js',
  '.test.jsx',
  '.spec.js',
  '.spec.jsx',
  '.test.mjs',
  '.spec.mjs',
  '.test.cjs',
  '.spec.cjs',
] as const;

const CAMELCASE_SUFFIX_PATTERNS = [
  'Test.java',
  'Tests.java',
  'Spec.java',
  'IT.java',
  'Test.kt',
  'Tests.kt',
  'Spec.kt',
  'Test.scala',
  'Spec.scala',
  'Test.cs',
  'Tests.cs',
  'Spec.cs',
  'Test.php',
  'Tests.php',
  'Tests.swift',
  'Test.swift',
] as const;

function pathParts(path: string): string[] {
  return path.replaceAll('\\', '/').split('/').filter((part) => part.length > 0);
}

export function isTestPath(path: string): boolean {
  const parts = pathParts(path);
  if (parts.length === 0) {
    return false;
  }

  if (parts.some((part) => TEST_DIRECTORY_SEGMENTS.has(part.toLowerCase()))) {
    return true;
  }

  const name = parts[parts.length - 1] ?? '';
  const loweredName = name.toLowerCase();
  if (loweredName.startsWith('test_') && loweredName.endsWith('.py')) {
    return true;
  }
  if (loweredName.startsWith('test-') && loweredName.endsWith('.r')) {
    return true;
  }
  if (LOWERCASE_SUFFIX_PATTERNS.some((pattern) => loweredName.endsWith(pattern))) {
    return true;
  }
  return CAMELCASE_SUFFIX_PATTERNS.some((pattern) => name.endsWith(pattern));
}
