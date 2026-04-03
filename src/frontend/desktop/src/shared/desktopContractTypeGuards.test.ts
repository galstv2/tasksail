import { describe, expect, it } from 'vitest';

import {
  isContextPackListResponse,
  isContextPackSwitchResponse,
  isContextPackReseedResponse,
  isPickDirectoryResponse,
  isDiscoverPrefillResponse,
  isCreateResponse,
} from './desktopContractTypeGuards';

describe('isContextPackListResponse', () => {
  it('returns true for a list response', () => {
    expect(isContextPackListResponse({ action: 'contextPack.list' })).toBe(true);
  });

  it('returns false for a different action', () => {
    expect(isContextPackListResponse({ action: 'contextPack.create' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isContextPackListResponse(null)).toBe(false);
  });

  it('returns false for a non-object', () => {
    expect(isContextPackListResponse('contextPack.list')).toBe(false);
  });
});

describe('isContextPackSwitchResponse', () => {
  it('returns true for previewSwitch action', () => {
    expect(isContextPackSwitchResponse({ action: 'contextPack.previewSwitch' })).toBe(true);
  });

  it('returns true for applySwitch action', () => {
    expect(isContextPackSwitchResponse({ action: 'contextPack.applySwitch' })).toBe(true);
  });

  it('returns true for clearActive action', () => {
    expect(isContextPackSwitchResponse({ action: 'contextPack.clearActive' })).toBe(true);
  });

  it('returns false for an unrelated action', () => {
    expect(isContextPackSwitchResponse({ action: 'contextPack.list' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isContextPackSwitchResponse(null)).toBe(false);
  });
});

describe('isContextPackReseedResponse', () => {
  it('returns true for reseed action', () => {
    expect(isContextPackReseedResponse({ action: 'contextPack.reseed' })).toBe(true);
  });

  it('returns false for a different action', () => {
    expect(isContextPackReseedResponse({ action: 'contextPack.list' })).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isContextPackReseedResponse(undefined)).toBe(false);
  });
});

describe('isPickDirectoryResponse', () => {
  it('returns true for pickDirectory action', () => {
    expect(isPickDirectoryResponse({ action: 'contextPack.pickDirectory' })).toBe(true);
  });

  it('returns false for a different action', () => {
    expect(isPickDirectoryResponse({ action: 'contextPack.create' })).toBe(false);
  });
});

describe('isDiscoverPrefillResponse', () => {
  it('returns true for discoverPrefill action', () => {
    expect(isDiscoverPrefillResponse({ action: 'contextPack.discoverPrefill' })).toBe(true);
  });

  it('returns false for a different action', () => {
    expect(isDiscoverPrefillResponse({ action: 'contextPack.list' })).toBe(false);
  });
});

describe('isCreateResponse', () => {
  it('returns true for create action', () => {
    expect(isCreateResponse({ action: 'contextPack.create' })).toBe(true);
  });

  it('returns false for a different action', () => {
    expect(isCreateResponse({ action: 'contextPack.list' })).toBe(false);
  });

  it('returns false when action property is missing', () => {
    expect(isCreateResponse({ type: 'contextPack.create' })).toBe(false);
  });
});
