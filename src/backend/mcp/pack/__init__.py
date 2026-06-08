"""Operational context pack helpers."""

from .constants import MANIFEST_VERSION_V2

__all__ = [
    "MANIFEST_VERSION_V2",
    "PackPreflightValidator",
    "PackWriter",
    "PackWriterContended",
    "run_preflight",
    "write_text_atomic",
]


def __getattr__(name: str):  # noqa: ANN202
    if name == "write_text_atomic":
        from .io import write_text_atomic

        return write_text_atomic
    if name in {"PackPreflightValidator", "run_preflight"}:
        from .preflight import PackPreflightValidator, run_preflight

        return {
            "PackPreflightValidator": PackPreflightValidator,
            "run_preflight": run_preflight,
        }[name]
    if name in {"PackWriter", "PackWriterContended"}:
        from .writer import PackWriter, PackWriterContended

        return {
            "PackWriter": PackWriter,
            "PackWriterContended": PackWriterContended,
        }[name]
    raise AttributeError(name)
