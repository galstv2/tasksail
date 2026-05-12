import { useCallback } from 'react';

import type { DesktopInvokeResult } from '../../shared/desktopContract';
import {
  formatIpcError,
  normalizeIpcThrownError,
  withIpcTimeout,
  DEFAULT_IPC_TIMEOUT_MS,
} from '../services/ipcErrorHelpers';

export type IpcCallOptions<TResponse> = {
  validate?: (response: unknown) => response is TResponse;
  fallbackMessage?: string;
  timeoutMs?: number;
  label?: string;
};

export type IpcCallResult<TResponse> =
  | { ok: true; response: TResponse }
  | { ok: false; error: string; details?: string[] };

export function useIpcCall(
  onError: (message: string) => void,
): {
  call: <TResponse>(
    action: () => Promise<DesktopInvokeResult>,
    options?: IpcCallOptions<TResponse>,
  ) => Promise<IpcCallResult<TResponse>>;
} {
  const call = useCallback(
    async <TResponse>(
      action: () => Promise<DesktopInvokeResult>,
      options?: IpcCallOptions<TResponse>,
    ): Promise<IpcCallResult<TResponse>> => {
      const label = options?.label ?? 'IPC call';
      const timeoutMs = options?.timeoutMs ?? DEFAULT_IPC_TIMEOUT_MS;

      let result: DesktopInvokeResult;
      try {
        result = await withIpcTimeout(action(), timeoutMs, label);
      } catch (error: unknown) {
        const message = normalizeIpcThrownError(error, options?.fallbackMessage);
        onError(message);
        return { ok: false, error: message };
      }

      if (!result.ok) {
        const message = formatIpcError(result);
        onError(message);
        return {
          ok: false,
          error: result.error,
          details: result.details,
        };
      }

      if (options?.validate && !options.validate(result.response)) {
        const message = `${label} returned an unexpected response.`;
        onError(message);
        return { ok: false, error: message };
      }

      onError('');
      return { ok: true, response: result.response as TResponse };
    },
    [onError],
  );

  return { call };
}
