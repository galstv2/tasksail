from __future__ import annotations

from typing import Any, Union

from src.backend.mcp.pack.constants import MANIFEST_VERSION_V2 as _MANIFEST_VERSION_V2
from src.backend.mcp.pack_schemas.answers import (
    BootstrapAnswers as BootstrapAnswers,
)
from src.backend.mcp.pack_schemas.answers import (
    BootstrapRepository as BootstrapRepository,
)
from src.backend.mcp.pack_schemas.answers import (
    dump_answers as dump_answers,
)
from src.backend.mcp.pack_schemas.answers import (
    validate_answers as validate_answers,
)
from src.backend.mcp.pack_schemas.canonical import canonicalize as canonicalize
from src.backend.mcp.pack_schemas.errors import PackSchemaError as PackSchemaError
from src.backend.mcp.pack_schemas.manifest import (
    ManifestFocusableArea as ManifestFocusableArea,
)
from src.backend.mcp.pack_schemas.manifest import (
    ManifestRepository as ManifestRepository,
)
from src.backend.mcp.pack_schemas.manifest import (
    RepoSourcesManifest as RepoSourcesManifest,
)
from src.backend.mcp.pack_schemas.manifest import (
    dump_manifest as _dump_manifest_v1,
)
from src.backend.mcp.pack_schemas.manifest import (
    validate_manifest as _validate_manifest_v1,
)
from src.backend.mcp.pack_schemas.manifest_v2 import (
    LocalPath as LocalPath,
)
from src.backend.mcp.pack_schemas.manifest_v2 import (
    ManifestRepositoryV2 as ManifestRepositoryV2,
)
from src.backend.mcp.pack_schemas.manifest_v2 import (
    RepoSourcesManifestV2 as RepoSourcesManifestV2,
)
from src.backend.mcp.pack_schemas.manifest_v2 import (
    dump_manifest_v2 as dump_manifest_v2,
)
from src.backend.mcp.pack_schemas.manifest_v2 import (
    load_manifest as load_manifest,
)
from src.backend.mcp.pack_schemas.manifest_v2 import (
    validate_manifest_v2 as validate_manifest_v2,
)
from src.backend.mcp.pack_schemas.pack_seed_state import (
    PackSeedState as PackSeedState,
)
from src.backend.mcp.pack_schemas.pack_seed_state import (
    validate_pack_seed_state as validate_pack_seed_state,
)
from src.backend.mcp.pack_schemas.plan import (
    SeedPlan as SeedPlan,
)
from src.backend.mcp.pack_schemas.plan import (
    SeedPlanRepository as SeedPlanRepository,
)
from src.backend.mcp.pack_schemas.plan import (
    dump_plan as dump_plan,
)
from src.backend.mcp.pack_schemas.plan import (
    validate_plan as validate_plan,
)

# These wrappers keep callers and the parametrized fixture tests version-agnostic:
# pass any raw manifest dict and the right validator/dumper is selected based on
# manifest_version. v2 fixtures go in the same manifest/ fixture dir as v1.

_AnyManifest = Union[RepoSourcesManifest, RepoSourcesManifestV2]


def validate_manifest(raw: Any, *, path: str | None = None) -> _AnyManifest:
    """Validate a manifest dict, dispatching on manifest_version."""
    version = raw.get("manifest_version", "") if isinstance(raw, dict) else ""
    if version == _MANIFEST_VERSION_V2:
        return validate_manifest_v2(raw, path=path)
    return _validate_manifest_v1(raw, path=path)


def dump_manifest(model: _AnyManifest) -> dict[str, Any]:
    """Dump a manifest model back to a plain dict, dispatching on model type."""
    if isinstance(model, RepoSourcesManifestV2):
        return dump_manifest_v2(model)
    return _dump_manifest_v1(model)
