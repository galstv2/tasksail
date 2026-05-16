import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  writeProtocolJson,
  writeProtocolStderr,
  writeProtocolStdout,
} from '../protocolOutput.js';

describe('protocol output helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes stdout text exactly', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    writeProtocolStdout('exact text');

    expect(stdout).toHaveBeenCalledWith('exact text');
  });

  it('writes stderr text exactly', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    writeProtocolStderr('exact error');

    expect(stderr).toHaveBeenCalledWith('exact error');
  });

  it('writes compact JSON with a trailing newline by default', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    writeProtocolJson({ ok: true, value: 1 });

    expect(stdout).toHaveBeenCalledWith('{"ok":true,"value":1}\n');
  });

  it('writes pretty JSON and can omit the trailing newline', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    writeProtocolJson({ ok: true }, { pretty: true, trailingNewline: false });

    expect(stdout).toHaveBeenCalledWith('{\n  "ok": true\n}');
  });
});
