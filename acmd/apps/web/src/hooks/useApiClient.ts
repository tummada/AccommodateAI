import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { ApiError, type RequestOptions } from '@/lib/api-client';

/**
 * Returns an authenticated fetch wrapper that uses the refresh-capable
 * client from AuthProvider.
 *
 * ACMD-116: the 401 → refresh → retry cycle lives inside the client
 * itself (see `createAuthenticatedClient`). This hook is now just a
 * thin wrapper that redirects to /login whenever the client gives up
 * (the client has already cleared auth state via onAuthLost).
 */
export function useApiClient() {
  const { client } = useAuth();
  const navigate = useNavigate();

  return useCallback(
    async <T>(path: string, options: Omit<RequestOptions, 'token'> = {}): Promise<T> => {
      try {
        return await client.request<T>(path, options);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          navigate('/login', { replace: true });
        }
        throw err;
      }
    },
    [client, navigate],
  );
}
