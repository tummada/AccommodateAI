/**
 * auth-broadcast — cross-tab logout sync.
 *
 * ACMD-116 §4: when tab A logs out we must tell tabs B/C/D to drop their
 * in-memory access token and bounce to /login. BroadcastChannel is the
 * preferred channel (same-origin only, so no XSS surface from other sites).
 *
 * FALLBACK: Safari < 15.4 and some older WebKit builds do not ship
 * BroadcastChannel. We fall back to a "write-then-immediately-delete"
 * sentinel on `localStorage`, which fires a `storage` event on every OTHER
 * tab in the same origin. We never persist any token material — only a
 * short-lived sentinel key — and we clean it up in the same tick. The
 * storage event carries the event type, never a token.
 *
 * SECURITY RULES:
 * - Never broadcast access or refresh tokens.
 * - Never persist auth material to localStorage (the fallback only writes
 *   a transient event marker and deletes it synchronously).
 * - Same-origin by design: BroadcastChannel does not cross origins and
 *   localStorage events do not fire across origins.
 */

export type AuthBroadcastMessage = { type: 'logout' };

export interface AuthBroadcastHandle {
  postLogout: () => void;
  subscribe: (handler: (message: AuthBroadcastMessage) => void) => () => void;
  close: () => void;
}

const CHANNEL_NAME = 'acmd-auth';
const STORAGE_EVENT_KEY = '__acmd_auth_event__';

function hasBroadcastChannel(): boolean {
  return typeof globalThis !== 'undefined' && typeof (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel === 'function';
}

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Create a new auth broadcast handle. Each AuthProvider instance owns one
 * handle and must call `close()` on unmount to release the channel.
 */
export function createAuthBroadcast(): AuthBroadcastHandle {
  if (hasBroadcastChannel()) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    return {
      postLogout: () => {
        try {
          channel.postMessage({ type: 'logout' } satisfies AuthBroadcastMessage);
        } catch {
          // BroadcastChannel can throw in private mode on some browsers —
          // swallow because logout must never block on cross-tab plumbing.
        }
      },
      subscribe: (handler) => {
        const listener = (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (isAuthBroadcastMessage(data)) {
            handler(data);
          }
        };
        channel.addEventListener('message', listener);
        return () => channel.removeEventListener('message', listener);
      },
      close: () => {
        try {
          channel.close();
        } catch {
          /* no-op */
        }
      },
    };
  }

  // --- Safari / legacy fallback via transient localStorage write ----------
  if (!hasWindow()) {
    // SSR / non-browser — return a no-op handle so tests and non-DOM
    // callers never crash.
    return {
      postLogout: () => {},
      subscribe: () => () => {},
      close: () => {},
    };
  }

  return {
    postLogout: () => {
      try {
        // ACMD-116 R8: payload is the bare event type, NEVER a token.
        const payload = JSON.stringify({ type: 'logout', t: Date.now() });
        window.localStorage.setItem(STORAGE_EVENT_KEY, payload);
        // Remove on next tick so the key never persists across reloads.
        window.localStorage.removeItem(STORAGE_EVENT_KEY);
      } catch {
        // localStorage may be disabled (private mode / quota) — cross-tab
        // sync gracefully degrades to "this tab only".
      }
    },
    subscribe: (handler) => {
      const listener = (event: StorageEvent) => {
        if (event.key !== STORAGE_EVENT_KEY || !event.newValue) {
          return;
        }
        try {
          const parsed: unknown = JSON.parse(event.newValue);
          if (isAuthBroadcastMessage(parsed)) {
            handler(parsed);
          }
        } catch {
          // Corrupt payload — ignore.
        }
      };
      window.addEventListener('storage', listener);
      return () => window.removeEventListener('storage', listener);
    },
    close: () => {},
  };
}

function isAuthBroadcastMessage(value: unknown): value is AuthBroadcastMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'logout'
  );
}
