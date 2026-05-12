from __future__ import annotations


class PackSchemaError(Exception):
    """Raised when a JSON document fails schema validation."""

    def __init__(
        self,
        model: str,
        validation_errors: list[str],
        *,
        path: str | None = None,
    ) -> None:
        self.model = model
        self.validation_errors = validation_errors
        self.path = path
        location = f" (path={path!r})" if path else ""
        detail = "; ".join(validation_errors)
        super().__init__(f"Schema validation failed for {model}{location}: {detail}")
