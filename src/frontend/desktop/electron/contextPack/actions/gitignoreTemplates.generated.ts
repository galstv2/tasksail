// Static mirror of local .gitignore template assets.
// The .gitignore files under gitignoreTemplates/ are the human-reviewed source of truth.
// This module mirrors them byte-for-byte so the Electron main-process bundle can load
// templates without filesystem reads at runtime.
// Tests in gitignoreTemplates.test.ts prove byte-for-byte synchronization.

export const defaultTemplate = `
# Local environment files
.env
.env.*
!.env.example
!.env.sample
!.env.template

# Logs and process output
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# macOS
.DS_Store
.DS_Store?
._*
.AppleDouble
.LSOverride
.Spotlight-V100
.Trashes
.fseventsd
.DocumentRevisions-V100
.TemporaryItems
.apdisk

# Windows
Thumbs.db
Thumbs.db:encryptable
ehthumbs.db
ehthumbs_vista.db
Desktop.ini
$RECYCLE.BIN/
*.lnk
*.stackdump

# Linux
.directory
.Trash-*
.nfs*
.fuse_hidden*

# Temp and editor backup files
*.tmp
*.temp
*.bak
*.swp
*.swo
*~
`;

export const csharpTemplate = `
# Build output directories
bin/
obj/

# NuGet packages
packages/
*.nupkg
*.snupkg

# Test results
TestResults/

# Database files generated during publish
*.dacpac
*.bak

# User-specific files (editor)
*.user
*.suo

# Build results
[Dd]ebug/
[Rr]elease/
x64/
x86/
[Ww][Ii][Nn]32/
[Aa][Rr][Mm]/
[Aa][Rr][Mm]64/

# Crash dumps
*.mdmp

# Profiler output
*.psess
*.vsp
*.vspx
*.sap
`;

export const typescriptTemplate = `
# Node.js dependencies
node_modules/

# Build output
dist/
dist-cjs/
dist-esm/
dist-types/
build/
out/
lib/

# TypeScript compiler output
*.tsbuildinfo

# Test coverage
coverage/

# Temporary runtime artifacts
tmp/
temp/
`;

export const javascriptTemplate = `
# Node.js dependencies
node_modules/

# Build output
dist/
dist-cjs/
dist-esm/
build/
out/
lib/

# Test coverage
coverage/

# Temporary runtime artifacts
tmp/
temp/
`;

export const pythonTemplate = `
# Byte-compiled and optimized files
__pycache__/
*.pyc
*.pyo
*.pyd

# Virtual environments
.venv/
venv/
env/
ENV/
.Python

# Distribution and packaging
dist/
build/
*.egg-info/
*.egg
*.whl
MANIFEST

# Test and coverage
.pytest_cache/
.coverage
htmlcov/
coverage/
.tox/

# MyPy type cache
.mypy_cache/
.dmypy.json

# Ruff cache
.ruff_cache/
`;

export const javaTemplate = `
# Compiled output
*.class
*.jar
*.war
*.nar
*.ear
*.zip
*.tar.gz
*.rar

# Build directories
build/
target/
out/

# Gradle
.gradle/
gradle-app.setting
!gradle-wrapper.jar

# Maven
pom.xml.tag
pom.xml.releaseBackup
pom.xml.versionsBackup
pom.xml.next
release.properties
dependency-reduced-pom.xml

# Test results
.mtj.tmp/
*.tmp
`;

export const goTemplate = `
# Compiled binaries and packages
pkg/
*.exe
*.exe~
*.dll
*.so
*.dylib

# Test binary and profiling output
*.test
*.out
*.prof

# Build output
bin/

# Vendor directory (managed by go mod)
vendor/
`;

export const rustTemplate = `
# Build output
target/
debug/
release/

# Compilation artifacts
*.pdb

# Benchmarks and test output
criterion/

# Coverage
tarpaulin-report.html
`;

export const rubyTemplate = `
# Bundler
.bundle/
vendor/bundle/

# Build and generated files
*.gem
*.rbc
/.config

# Documentation
rdoc/
doc/

# Test coverage
coverage/

# Temporary files
tmp/
`;

export const sqlTemplate = `
# Generated database backup and export files
*.bak
*.dump
*.sql.gz
*.sql.bz2

# Database data export directories
data_exports/
db_backups/
backups/

# SQLite runtime files
*.db-journal
*.db-wal
*.db-shm
`;

export const hclTemplate = `
# Terraform local state and plan files
.terraform/
terraform.tfstate
terraform.tfstate.*
*.tfstate
*.tfstate.*
*.tfvars
*.tfvars.json
*.tfplan
crash.log
crash.*.log
override.tf
override.tf.json
*_override.tf
*_override.tf.json

# OpenTofu state files (same layout as Terraform)
.terraform.lock.hcl.bak

# Terragrunt cache
.terragrunt-cache/
`;

export const shellTemplate = `
# Shell script test output
*.log
bats-report/
test-output/

# Temporary files created during script execution
tmp/
temp/
*.tmp
`;

export const powershellTemplate = `
# PowerShell module build output
bin/
obj/

# Pester test results
TestResults/
*.xml

# PSake / Invoke-Build artifacts
Build/

# PowerShell module package output
*.nupkg

# Temporary files
tmp/
temp/
`;
