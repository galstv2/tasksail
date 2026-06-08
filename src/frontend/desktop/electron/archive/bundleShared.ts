import path from 'node:path';

// Trims to maxBytes without splitting a UTF-8 multibyte sequence (continuation
// bytes match 0b10xxxxxx), so the decoded text never contains a replacement char.
export function utf8SafeSlice(buffer: Buffer, maxBytes: number): Buffer {
  if (maxBytes <= 0) return Buffer.alloc(0);
  if (buffer.length <= maxBytes) return buffer;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end);
}

export function isInsideOrEqual(root: string, filePath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(filePath);
  return resolvedFile === resolvedRoot || resolvedFile.startsWith(`${resolvedRoot}${path.sep}`);
}
