# Install Prerequisites

TaskSail is supported on Unix-based systems such as Linux and macOS today. Windows is not a supported target.

Install these before running setup:

- Git
- Node.js 24 with `npm`
- pnpm 9 or newer
- Python 3.12 or newer
- GitHub Copilot CLI access for the GitHub account you will use locally

Docker Desktop or Podman is optional. The checked-in default runtime is direct local execution, which uses Python on your machine. Docker or Podman can be configured later if your environment needs a compose runtime.

GitHub Copilot CLI is the only shipped provider today. TaskSail keeps provider-specific behavior behind an adapter boundary, but no other provider adapter ships in this repository yet.

## Check Your Shell

From the repository root, these commands should work:

```bash
git --version
node --version
pnpm --version
python3 --version
```

If `python3` is unavailable but Python 3.12+ is installed under another name, configure the supported Python override before setup.

## Internal Mirrors

If your company uses internal npm, PyPI, or Electron mirrors, export those package-manager settings before the first dependency install. Package managers do not read the repository `.env` file before dependencies exist.

Common examples:

```bash
export NPM_CONFIG_REGISTRY="https://artifactory.example.internal/api/npm/npm-virtual/"
export NPM_CONFIG_REPLACE_REGISTRY_HOST=npmjs
export PIP_INDEX_URL="https://artifactory.example.internal/api/pypi/pypi-virtual/simple/"
```

If you are not using a POSIX-style shell, use that shell's environment assignment syntax before dependency installation.

Continue with [First Run](02-first-run.md).
