export function writeProtocolStdout(text: string): void {
  // tasksail: protocol-output - helper raw stdout is command/protocol output.
  process.stdout.write(text);
}

export function writeProtocolStderr(text: string): void {
  // tasksail: protocol-output - helper raw stderr is command/protocol output.
  process.stderr.write(text);
}

export function writeProtocolJson(
  value: unknown,
  options?: { pretty?: boolean; trailingNewline?: boolean },
): void {
  const rendered = options?.pretty
    ? JSON.stringify(value, null, 2)
    : JSON.stringify(value);
  writeProtocolStdout(`${rendered}${options?.trailingNewline === false ? '' : '\n'}`);
}
