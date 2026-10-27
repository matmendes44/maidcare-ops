// Shapes returned by the Bouncie REST API (https://api.bouncie.dev/v1),
// shared by the real client and the development simulator.

export type BouncieVehicle = {
  imei: string;
  vin: string | null;
  nickName: string | null;
  model?: { make?: string; name?: string; year?: number } | null;
  stats?: {
    odometer?: number | null;
    lastUpdated?: string | null;
    location?: { lat: number; lon: number; heading?: number | null; address?: string | null } | null;
    fuelLevel?: number | null;
    isRunning?: boolean | null;
    speed?: number | null;
    mil?: {
      milOn?: boolean;
      qualifiedDtcList?: { code: string; name?: string[] }[];
      // the docs nest battery inside mil; accepted in either place
      battery?: { status?: "normal" | "low" | "critical" } | null;
    } | null;
    battery?: { status?: "normal" | "low" | "critical" } | null;
  } | null;
};

export type BouncieTrip = {
  transactionId: string;
  imei: string;
  startTime: string;
  // missing while the trip is still under way
  endTime?: string | null;
  startOdometer?: number | null;
  endOdometer?: number | null;
  distance: number;
  fuelConsumed?: number | null;
  maxSpeed?: number | null;
  averageSpeed?: number | null;
  totalIdleDuration?: number | null;
  hardBrakingCount?: number | null;
  hardAccelerationCount?: number | null;
  // with gps-format=geojson: a LineString (object, or a JSON string of one)
  gps?: unknown;
};

export interface FleetSource {
  kind: "simulated" | "bouncie";
  vehicles(): Promise<BouncieVehicle[]>;
  // trips for one device; the API allows at most a week per request
  trips(imei: string, startsAfter: Date, endsBefore: Date): Promise<BouncieTrip[]>;
}
