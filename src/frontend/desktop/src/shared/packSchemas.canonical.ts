// Recursive stable-stringify: sorts object keys at every depth, 2-space indent.
// Output is byte-for-byte identical to src/backend/mcp/pack_schemas/canonical.py
// for all fixture values in this codebase. Run packSchemas.roundtrip.test.ts to verify.
export function canonicalize(value: unknown): string {
  return stringify(value, 0);
}

function stringify(v: unknown, depth: number): string {
  const pad = '  '.repeat(depth);
  const padInner = '  '.repeat(depth + 1);
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const items = v.map((x) => padInner + stringify(x, depth + 1));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }
  const keys = Object.keys(v as Record<string, unknown>).sort();
  if (keys.length === 0) return '{}';
  const lines = keys.map(
    (k) =>
      padInner +
      JSON.stringify(k) +
      ': ' +
      stringify((v as Record<string, unknown>)[k], depth + 1),
  );
  return '{\n' + lines.join(',\n') + '\n' + pad + '}';
}
