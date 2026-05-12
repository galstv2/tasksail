import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveContainerRuntime } from '../platform-config/resolve.js';

const execFileAsync = promisify(execFile);

export interface ToolCheck {
  name: string;
  checkCmd: string[];
}

export function getRequiredTools(platform: NodeJS.Platform = process.platform): ToolCheck[] {
  return [
    { name: 'git', checkCmd: ['git', '--version'] },
    { name: 'node', checkCmd: ['node', '--version'] },
    platform === 'win32'
      ? { name: 'python', checkCmd: ['python', '--version'] }
      : { name: 'python3', checkCmd: ['python3', '--version'] },
    { name: 'pnpm', checkCmd: ['pnpm', '--version'] },
  ];
}

export const REQUIRED_TOOLS: ToolCheck[] = getRequiredTools();

export interface LocalSetupResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

async function isToolAvailable(cmd: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd[0], cmd.slice(1), { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function validateLocalSetup(repoRoot?: string): Promise<LocalSetupResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const tool of getRequiredTools()) {
    const available = await isToolAvailable(tool.checkCmd);
    if (!available) {
      errors.push(`Required tool not found: ${tool.name} (tried: ${tool.checkCmd.join(' ')})`);
    }
  }

  // Check optional tools
  const root = repoRoot ?? process.cwd();
  let runtimeTool: 'docker' | 'podman' | null = null;
  try {
    const resolvedRuntime = await resolveContainerRuntime(root);
    runtimeTool = resolvedRuntime === 'direct' ? null : resolvedRuntime;
  } catch (err: unknown) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const optionalTools = [runtimeTool, 'ruff', 'gh'].filter((tool): tool is string => tool !== null);
  for (const tool of optionalTools) {
    const available = await isToolAvailable([tool, '--version']);
    if (!available) {
      warnings.push(`Optional tool not found: ${tool}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
