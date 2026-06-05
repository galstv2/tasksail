/**
 * Single source of truth for the platform-config file locations. Consumed by
 * seed/get/resolve/save so a path rename can never split-brain (e.g. seed
 * writing one location while get reads another).
 */
export const DEFAULT_PLATFORM_CONFIG_PATH = 'config/platform.default.json';
export const RUNTIME_PLATFORM_CONFIG_PATH = '.platform-state/platform.json';
