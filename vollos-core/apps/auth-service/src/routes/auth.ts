import { Hono } from "hono";

const auth = new Hono();

// GET /health — placeholder only
// Backend will implement login/logout/refresh/JWKS in RS-002
auth.get("/health", (c) => {
  return c.json({ status: "ok" });
});

export default auth;
