"""Workspace context sync helpers."""

__all__ = ["WorkspaceContextSyncService"]


def __getattr__(name: str) -> object:
    if name == "WorkspaceContextSyncService":
        from .service import WorkspaceContextSyncService

        return WorkspaceContextSyncService
    raise AttributeError(name)
