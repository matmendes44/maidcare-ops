import "server-only";

import { isDemo } from "@/lib/demo";
import { simulatedSource } from "./simulator";
import { accessToken, bouncieConfig, getConnection } from "./tokens";
import type { BouncieTrip, BouncieVehicle, FleetSource } from "./types";

const API = "https://api.bouncie.dev/v1";

async function call<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = `${API}${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""}`;
  for (const force of [false, true]) {
    const token = await accessToken(force);
    if (!token) throw new Error("Bouncie isn't connected.");
    // the token goes in as-is, without "Bearer"
    const res = await fetch(url, {
      headers: { Authorization: token, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (res.status === 401 && !force) continue;
    if (!res.ok) throw new Error(`Bouncie request failed (${res.status}).`);
    return (await res.json()) as T;
  }
  throw new Error("Bouncie rejected the saved sign-in. Reconnect it on the Fleet page.");
}

export const bouncieSource: FleetSource = {
  kind: "bouncie",
  async vehicles() {
    const all: BouncieVehicle[] = [];
    for (let skip = 0; ; skip += 50) {
      const page = await call<BouncieVehicle[]>("/vehicles", { limit: "50", ...(skip ? { skip: String(skip) } : {}) });
      all.push(...page);
      if (page.length < 50) return all;
    }
  },
  trips(imei, startsAfter, endsBefore) {
    return call<BouncieTrip[]>("/trips", {
      imei,
      "gps-format": "geojson",
      "starts-after": startsAfter.toISOString(),
      "ends-before": endsBefore.toISOString(),
    });
  },
};

export async function bouncieUser() {
  return call<{ email: string; name: string }>("/user");
}

// Where fleet data comes from: the connected Bouncie account, else the
// simulator, but only in development and the public demo. Production without
// a connection has no data rather than made-up data.
export async function fleetSource(): Promise<FleetSource | null> {
  if (isDemo()) return simulatedSource;
  if (bouncieConfig() && (await getConnection())) return bouncieSource;
  return process.env.NODE_ENV === "production" ? null : simulatedSource;
}
