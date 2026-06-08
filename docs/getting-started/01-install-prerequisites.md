# Install Prerequisites

Install these before running setup:

- Git
- Node.js 24 with `npm`
- pnpm 9 or newer
- Python 3.12 or newer
- GitHub Copilot CLI access for the GitHub account you will use locally

Docker Desktop or Podman is optional. The checked-in default runtime is direct local execution, which uses Python on your machine. Docker or Podman can be configured later if your environment needs a compose runtime.

## Check Your Shell

From the repository root, these commands should work:

```bash
git --version
node --version
pnpm --version
python3 --version
```

On Windows, `python --version` or `py -3.12 --version` may be the right Python command depending on how Python was installed.

## Internal Mirrors

If your company uses internal npm, PyPI, or Electron mirrors, export those package-manager settings before the first dependency install. Package managers do not read the repository `.env` file before dependencies exist.

Common examples:

```bash
export NPM_CONFIG_REGISTRY="https://artifactory.example.internal/api/npm/npm-virtual/"
export NPM_CONFIG_REPLACE_REGISTRY_HOST=npmjs
export PIP_INDEX_URL="https://artifactory.example.internal/api/pypi/pypi-virtual/simple/"
```

PowerShell uses `$env:NAME = "value"` instead of `export`.

Continue with [First Run](02-first-run.md).
