# Contributing

Thanks for contributing to TaskSail.

## Before you start

- Read [README.md](README.md)
- Review the docs under [docs/](docs/)
- Keep changes aligned with the platform's local-first workflow model
- Treat repo artifacts as the source of truth for workflow changes

## Development setup

1. Clone the repository.
2. Copy `.env.example` to `.env`.
3. Run `pnpm run setup`.
4. Run `pnpm run validate`.

## Making changes

- Prefer small, focused pull requests.
- Avoid unrelated refactors in the same change.
- Update documentation when behavior, architecture, or operator flow changes.
- Add or update tests for behavioral changes.
- Keep secrets, credentials, and target-estate private data out of the repo.

## Validation

Before opening a pull request, run:

- `pnpm run local-checks`
- `pnpm run check-open-source-readiness`

If your change touches the desktop shell, also run:

- `cd src/frontend/desktop && npm run validate:desktop`

If your change touches specific Python or workflow surfaces, run the most relevant
unit tests in addition to the standard checks.

## Pull request expectations

Please include:

- a clear summary of the change
- why the change is needed
- validation performed
- any follow-up work or known limitations

## Workflow and architecture changes

For changes affecting:

- queue behavior
- handoff contracts
- context-pack activation
- archival or QMD behavior
- MCP transport or security behavior
- terminal UI control-plane flows

also update the relevant documentation in [docs/](docs/).

## License

By contributing, you agree that your contributions will be licensed under the
MIT License in [LICENSE](LICENSE).
