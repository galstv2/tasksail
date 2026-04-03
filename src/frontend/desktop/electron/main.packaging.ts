import { join } from 'node:path';

export function getPackageOutputDir(releaseDir: string, platform = process.platform, arch = process.arch): string {
  switch (platform) {
    case 'darwin':
      return join(releaseDir, arch === 'arm64' ? 'mac-arm64' : 'mac');
    case 'win32':
      return join(releaseDir, 'win-unpacked');
    case 'linux':
      return join(releaseDir, 'linux-unpacked');
    default:
      return join(releaseDir, 'unsupported-platform');
  }
}

export function getPackageArtifactName(platform = process.platform): string {
  switch (platform) {
    case 'darwin':
      return 'TaskSail.app';
    case 'win32':
      return 'TaskSail Setup.exe';
    case 'linux':
      return 'TaskSail.AppImage';
    default:
      return 'TaskSail artifact';
  }
}

export function getPackageCommand(platform = process.platform): string {
  switch (platform) {
    case 'darwin':
      return 'npm run package:mac';
    case 'win32':
      return 'npm run package:win';
    case 'linux':
      return 'npm run package:linux';
    default:
      return 'No native packaging command is configured for this host platform.';
  }
}
