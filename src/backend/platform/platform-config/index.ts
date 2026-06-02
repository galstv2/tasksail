export { loadPlatformConfig, validatePlatformConfig } from './load.js';
export { seedPlatformConfig } from './seed.js';
export { resolveContainerEngineHost, resolveContainerRuntime } from './resolve.js';
export { getPlatformConfig, resetPlatformConfigCache } from './get.js';
export { readSystemSettings, saveSystemSettings, SystemSettingsSaveError } from './save.js';

export type {
  PlatformConfig,
  PlatformConfigLoadResult,
  PlatformConfigValidationError,
} from './types.js';

export type {
  SystemSettingsRuntimeStatus,
  SystemSettingsEnvOverride,
  SystemSettingsEnvOverrideScope,
  SystemSettingsReadResult,
  SystemSettingsReadOptions,
  SystemSettingsSaveResult,
  SystemSettingsSavePayload,
  SystemSettingsSaveOptions,
  SystemSettingsSaveErrorCode,
} from './save.js';

export { CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION } from './types.js';
