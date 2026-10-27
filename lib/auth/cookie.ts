// Shared by the proxy and the session code. The __Host- prefix makes the
// browser refuse the cookie unless it's Secure, host-only and path=/; it's
// dropped in development because Safari won't set Secure cookies over http.
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-session" : "session";
