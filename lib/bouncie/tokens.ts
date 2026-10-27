import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bouncieConnection } from "@/db/schema";

const AUTH_URL = "https://auth.bouncie.com/dialog/authorize";
const TOKEN_URL = "https://auth.bouncie.com/oauth/token";

export function bouncieConfig() {
  const clientId = process.env.BOUNCIE_CLIENT_ID?.trim();
  const clientSecret = process.env.BOUNCIE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.BOUNCIE_REDIRECT_URI?.trim();
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

// Tokens are stored encrypted (AES-256-GCM) with a key derived from the client
// secret, so a copy of the database alone can't be used to read the vehicles.
function key(secret: string) {
  return Buffer.from(hkdfSync("sha256", secret, "maidcare-bouncie-tokens", "token-encryption", 32));
}
function seal(plain: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
}
function open(sealed: string, secret: string) {
  const raw = Buffer.from(sealed.replace(/^v1:/, ""), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function authorizeUrl(state: string, codeChallenge: string) {
  const config = bouncieConfig();
  if (!config) throw new Error("Bouncie isn't configured.");
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params}`;
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number };

async function requestTokens(body: Record<string, string>): Promise<TokenResponse> {
  const config = bouncieConfig();
  if (!config) throw new Error("Bouncie isn't configured.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Bouncie sign-in failed (${res.status}).`);
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token || !data.refresh_token) throw new Error("Bouncie didn't return tokens.");
  return data;
}

async function save(
  tokens: TokenResponse,
  code: string,
  extra: { accountEmail?: string | null; connectedBy?: number; connectedAt?: string } = {},
) {
  const { clientSecret } = bouncieConfig()!;
  const row = {
    accessToken: seal(tokens.access_token, clientSecret),
    refreshToken: seal(tokens.refresh_token, clientSecret),
    authorizationCode: seal(code, clientSecret),
    // renew a minute early
    expiresAt: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
  };
  await db
    .insert(bouncieConnection)
    .values({ id: 1, ...row, ...extra })
    .onConflictDoUpdate({ target: bouncieConnection.id, set: { ...row, ...extra } });
}

// After the user approves access: swap the code for tokens and keep them.
export async function connectWithCode(code: string, codeVerifier: string, userId: number) {
  const { redirectUri } = bouncieConfig()!;
  const tokens = await requestTokens({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier });
  await save(tokens, code, { connectedBy: userId, connectedAt: new Date().toISOString(), accountEmail: null });
  return tokens.access_token;
}

export async function getConnection() {
  return db.query.bouncieConnection.findFirst({ where: eq(bouncieConnection.id, 1) });
}

export async function disconnect() {
  await db.delete(bouncieConnection).where(eq(bouncieConnection.id, 1));
}

// A valid access token, renewed when it's about to expire (or when `force`,
// after Bouncie rejected the current one). Refresh tokens are single-use;
// if one has lapsed, the stored authorization code gets fresh tokens.
export async function accessToken(force = false): Promise<string | null> {
  const config = bouncieConfig();
  const row = await getConnection();
  if (!config || !row) return null;
  if (!force && new Date(row.expiresAt).getTime() > Date.now()) return open(row.accessToken, config.clientSecret);
  const code = open(row.authorizationCode, config.clientSecret);
  let tokens: TokenResponse;
  try {
    tokens = await requestTokens({ grant_type: "refresh_token", refresh_token: open(row.refreshToken, config.clientSecret) });
  } catch {
    tokens = await requestTokens({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri });
  }
  await save(tokens, code);
  return tokens.access_token;
}

export async function setAccountEmail(email: string | null) {
  await db.update(bouncieConnection).set({ accountEmail: email }).where(eq(bouncieConnection.id, 1));
}
