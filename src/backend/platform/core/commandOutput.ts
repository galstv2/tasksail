export function splitCommandOutputLines(stdout: string): string[] {
  return stdout.split(/\r?\n/).filter(Boolean);
}
