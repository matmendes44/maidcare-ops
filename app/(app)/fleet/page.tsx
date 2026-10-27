import Link from "next/link";
import { headers } from "next/headers";
import { Suspense } from "react";
import { AlertTriangle, BatteryWarning, ChevronLeft, ChevronRight, FileText, Fuel, Gauge, MapPinned, Plug, Truck } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { Empty, linkClass } from "@/components/record";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import type { Formatters } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { phrase, plural } from "@/lib/i18n/tr";
import { today as getToday } from "@/lib/today";
import { fleetTabs, getFleetStatus, getLive, getMaintenance, getMileage, getRouteCheck, getVehicleOptions, getVisits, parseDay, type FleetTab } from "./data";
import { AutoRefresh, CompleteVisitButton, DisconnectButton, IntervalForm, LinkDevice, LocateButton, RefreshButton, ServiceForm } from "./fleet-controls";
import { FleetMap, type MapStop, type MapVehicle } from "./fleet-map";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { isDemo } from "@/lib/demo";

// (shown through tr())
const tabLabels: Record<FleetTab, string> = {
  live: phrase("Live map"),
  visits: phrase("Visits"),
  mileage: phrase("Mileage"),
  maintenance: phrase("Maintenance"),
  routes: phrase("Drive times"),
  setup: phrase("Setup"),
};

const connectMessages: Record<string, { text: string; ok: boolean }> = {
  connected: { text: phrase("Bouncie connected. Your vehicles are syncing."), ok: true },
  denied: { text: phrase("Access wasn't granted on Bouncie's page, so nothing changed."), ok: false },
  failed: { text: phrase("Connecting to Bouncie failed. Check the client ID, secret and redirect URI, then try again."), ok: false },
  invalid: { text: phrase("That sign-in link expired or didn't come from this browser. Start again with Connect Bouncie."), ok: false },
  forbidden: { text: phrase("Only the owner can connect Bouncie."), ok: false },
  "not-configured": { text: phrase("Add the Bouncie settings to the environment first (see the steps below)."), ok: false },
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};
const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.round(m)} min`);
const miles = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 1 : 0 })} mi`;

async function DayPicker({ tab, day, today }: { tab: FleetTab; day: string; today: string }) {
  const { tr } = await getI18n();
  const href = (d: string) => `/fleet?tab=${tab}&day=${d}`;
  return (
    <form action="/fleet" className="mb-4 flex flex-wrap items-center gap-2">
      <input type="hidden" name="tab" value={tab} />
      <Link href={href(shiftDay(day, -1))} className={buttonVariants({ variant: "outline", size: "icon-sm" })} aria-label={tr("Previous day")}>
        <ChevronLeft aria-hidden="true" />
      </Link>
      <Input type="date" name="day" defaultValue={day} aria-label={tr("Day")} className="h-8 w-40" />
      <Link href={href(shiftDay(day, 1))} className={buttonVariants({ variant: "outline", size: "icon-sm" })} aria-label={tr("Next day")}>
        <ChevronRight aria-hidden="true" />
      </Link>
      <Button type="submit" variant="outline" size="sm">
        {tr("Go")}
      </Button>
      {day !== today && (
        <Link href={href(today)} className={cn(linkClass, "text-sm")}>
          {tr("Today")}
        </Link>
      )}
    </form>
  );
}

async function LiveTab({ day, fmt }: { day: string; fmt: Formatters }) {
  const { tr } = await getI18n();
  const { fleet, stops } = await getLive(day);
  const mapVehicles: MapVehicle[] = fleet
    .filter((v) => v.location)
    .map((v) => ({
      id: v.id,
      name: v.name,
      lat: v.location!.lat,
      lng: v.location!.lon,
      running: Boolean(v.isRunning),
      detail: v.isRunning ? tr("Driving · {n} mph", { n: Math.round(v.speed ?? 0) }) : (v.atProperty ?? tr("Parked")),
    }));
  const mapStops: MapStop[] = stops
    .filter((s) => s.point)
    .map((s, i) => ({
      id: s.id,
      lat: s.point!.lat,
      lng: s.point!.lng,
      order: i + 1,
      title: s.customer,
      detail: `${fmt.timeRange(s.start, s.end)} · ${s.address}${s.vehicleName ? ` · ${s.vehicleName}` : ""}`,
      state: s.status === "completed" || s.actualDeparture ? "done" : s.actualArrival ? "here" : "pending",
    }));
  return (
    <>
      <AutoRefresh />
      <FleetMap vehicles={mapVehicles} stops={mapStops} />
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem] text-muted-foreground">
        <span><span className="mr-1 inline-block size-2.5 rounded-full bg-brand-green align-middle" />{tr("Driving")}</span>
        <span><span className="mr-1 inline-block size-2.5 rounded-full bg-brand-blue align-middle" />{tr("Parked")}</span>
        <span>{tr("Numbered squares: today's stops in order (green once visited)")}</span>
      </p>
      <h2 className="mt-6 mb-3 text-lg font-semibold">{tr("Vehicles")}</h2>
      {fleet.length === 0 ? (
        <Empty>{tr("No vehicles yet. They're added from Bouncie with the next update.")}</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fleet.map((v) => {
            const stale = v.stale;
            return (
              <div key={v.id} className="grid content-start gap-2 rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <Truck className={cn("size-4", v.isRunning ? "text-brand-green" : "text-brand-blue")} aria-hidden="true" />
                    {v.name}
                  </div>
                  {!v.linked ? (
                    <Badge variant="muted">{tr("No device")}</Badge>
                  ) : v.isRunning ? (
                    <Badge variant="success">{tr("Driving · {n} mph", { n: Math.round(v.speed ?? 0) })}</Badge>
                  ) : (
                    <Badge variant="info">{tr("Parked")}</Badge>
                  )}
                </div>
                {v.linked ? (
                  <>
                    <p className="text-sm">
                      {v.isRunning ? tr("On the road") : v.atProperty ? tr("At {place}", { place: v.atProperty }) : (v.location?.address ?? tr("Location shown on the map"))}
                    </p>
                    {v.next && (
                      <p className="text-sm text-muted-foreground">
                        {tr("Next: {customer} at {time}", { customer: v.next.customer, time: fmt.time(v.next.start) })}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem] text-muted-foreground">
                      {v.fuelLevel != null && (
                        <span className={cn("inline-flex items-center gap-1", v.fuelLevel < 20 && "font-medium text-destructive")}>
                          <Fuel className="size-3.5" aria-hidden="true" />
                          {tr("{n}% fuel", { n: Math.round(v.fuelLevel) })}
                        </span>
                      )}
                      {v.milOn && (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="size-3.5" aria-hidden="true" />
                          {tr("Check engine")}
                        </span>
                      )}
                      {v.batteryStatus && v.batteryStatus !== "normal" && (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                          <BatteryWarning className="size-3.5" aria-hidden="true" />
                          {tr("Battery {state}", { state: tr(v.batteryStatus) })}
                        </span>
                      )}
                      {v.statsUpdatedAt && (
                        <span className={cn(stale && "text-amber-700 dark:text-amber-400")}>{tr("Updated {time}", { time: fmt.stamp(v.statsUpdatedAt) })}</span>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {tr("Its Bouncie device isn't linked yet.")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

async function VisitsTab({ day, today, fmt }: { day: string; today: string; fmt: Formatters }) {
  const { tr } = await getI18n();
  const user = await getCurrentUser();
  const canComplete = can(user, "appointments.complete");
  const canInvoice = can(user, "invoices.create");
  const visits = await getVisits(day);
  const waiting = visits.filter((v) => v.needsCompleting).length;
  return (
    <>
      <AutoRefresh />
      <DayPicker tab="visits" day={day} today={today} />
      <p className="mb-3 text-sm text-muted-foreground">
        {tr("Arrival and departure are detected when the vehicle's trip ends or starts within about 500 m of the property.")}
        {waiting > 0 && <strong className="text-foreground"> {plural(tr, waiting, "{n} visit is waiting to be marked completed.", "{n} visits are waiting to be marked completed.")}</strong>}
      </p>
      {visits.length === 0 ? (
        <Empty>{tr("No appointments on {day}.", { day: fmt.fullDay(day) })}</Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("Scheduled")}</TableHead>
                <TableHead>{tr("Customer")}</TableHead>
                <TableHead>{tr("Vehicle")}</TableHead>
                <TableHead>{tr("Arrived")}</TableHead>
                <TableHead>{tr("Left")}</TableHead>
                <TableHead>{tr("On site")}</TableHead>
                <TableHead>{tr("Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visits.map((v) => (
                <TableRow key={v.id} className={cn("align-top", v.needsCompleting && "bg-amber-500/5")}>
                  <TableCell data-label={tr("Scheduled")} className="tabular-nums">
                    {fmt.timeRange(v.start, v.end)}
                  </TableCell>
                  <TableCell data-primary className="whitespace-normal">
                    <Link href={`/appointments/${v.id}`} className="font-medium hover:text-link">
                      {v.customer}
                    </Link>
                    <div className="text-[0.8rem] text-muted-foreground">{v.address}</div>
                  </TableCell>
                  <TableCell data-label={tr("Vehicle")}>{v.vehicleName ?? "—"}</TableCell>
                  <TableCell data-label={tr("Arrived")} className="tabular-nums">
                    {v.actualArrival ? (
                      <>
                        {fmt.time(v.actualArrival)}
                        {v.lateMinutes != null && v.lateMinutes > 10 && (
                          <span className="ml-1.5 text-[0.8rem] text-amber-700 dark:text-amber-400">{tr("{time} late", { time: minutes(v.lateMinutes) })}</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell data-label={tr("Left")} className="tabular-nums">
                    {v.actualDeparture ? fmt.time(v.actualDeparture) : "—"}
                  </TableCell>
                  <TableCell data-label={tr("On site")} className="tabular-nums">
                    {v.onSiteMinutes != null ? minutes(v.onSiteMinutes) : "—"}
                  </TableCell>
                  <TableCell data-label={tr("Status")} className="whitespace-normal">
                    <div className="flex flex-wrap items-center justify-end gap-2 sm:justify-start">
                      {v.needsCompleting ? (
                        <>
                          <span className="text-[0.8rem] text-muted-foreground">{tr("Left {time}.", { time: fmt.time(v.actualDeparture!) })}</span>
                          {canComplete && <CompleteVisitButton id={v.id} />}
                        </>
                      ) : (
                        <Badge variant={v.status === "completed" ? "success" : v.status === "in_progress" ? "warning" : "info"}>
                          {v.status === "completed" ? tr("visit|Completed") : v.status === "in_progress" ? tr("visit|In progress") : tr("visit|Pending")}
                        </Badge>
                      )}
                      {canInvoice && (v.needsCompleting || v.status === "completed") && (
                        <Link href={`/finances/invoices/new?appointment=${v.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                          <FileText aria-hidden="true" />
                          {tr("Create invoice")}
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

function mileageRange(preset: string | undefined, fromRaw: string | undefined, toRaw: string | undefined, today: string) {
  const d = new Date(`${today}T12:00:00Z`);
  const monday = shiftDay(today, -((d.getUTCDay() + 6) % 7));
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shiftDay(firstOfMonth, -1);
  switch (preset) {
    case "last-week":
      return { preset, from: shiftDay(monday, -7), to: shiftDay(monday, -1) };
    case "month":
      return { preset, from: firstOfMonth, to: today };
    case "last-month":
      return { preset, from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd };
    case "custom": {
      const from = parseDay(fromRaw, monday);
      const to = parseDay(toRaw, today);
      return from <= to ? { preset, from, to } : { preset, from: to, to: from };
    }
    default:
      return { preset: "week", from: monday, to: today };
  }
}

async function MileageTab({ range, fmt }: { range: ReturnType<typeof mileageRange>; fmt: Formatters }) {
  const { tr } = await getI18n();
  const { daily, totals, jobs } = await getMileage(range.from, range.to);
  const presets = [
    ["week", tr("This week")],
    ["last-week", tr("Last week")],
    ["month", tr("This month")],
    ["last-month", tr("Last month")],
  ] as const;
  const all = totals.reduce((s, t) => s + t.miles, 0);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {presets.map(([key, label]) => (
          <Link
            key={key}
            href={`/fleet?tab=mileage&range=${key}`}
            aria-current={range.preset === key ? "true" : undefined}
            className={cn(
              "rounded-md border px-2.5 py-1 text-sm",
              range.preset === key ? "border-brand-blue bg-brand-blue/10 font-medium" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {label}
          </Link>
        ))}
        <form action="/fleet" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="mileage" />
          <input type="hidden" name="range" value="custom" />
          <Input type="date" name="from" defaultValue={range.from} aria-label={tr("From")} className="h-8 w-38" />
          <span className="text-sm text-muted-foreground">{tr("range|to")}</span>
          <Input type="date" name="to" defaultValue={range.to} aria-label={tr("To")} className="h-8 w-38" />
          <Button type="submit" variant="outline" size="sm">
            {tr("Show")}
          </Button>
        </form>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        {fmt.calendarDate(range.from)} – {fmt.calendarDate(range.to)} · {tr("{miles} in total", { miles: miles(all) })}
      </p>
      {totals.length === 0 ? (
        <Empty>{tr("No trips in this period.")}</Empty>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {totals.map((t) => (
              <div key={t.name} className="rounded-lg border bg-card p-4">
                <div className="text-sm font-semibold">{t.name}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{miles(t.miles)}</div>
                <div className="mt-1 text-[0.8rem] text-muted-foreground">
                  {tr("{trips} trips · {time} driving", { trips: t.trips, time: minutes(t.driveSeconds / 60) })}
                  {t.fuel > 0 ? ` · ${t.fuel.toFixed(1)} gal` : ""}
                </div>
              </div>
            ))}
          </div>
          <h2 className="mb-3 text-lg font-semibold">{tr("By day")}</h2>
          <div className="mb-6 overflow-hidden rounded-lg border">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("Date")}</TableHead>
                  <TableHead>{tr("Vehicle")}</TableHead>
                  <TableHead className="text-right">{tr("Trips")}</TableHead>
                  <TableHead className="text-right">{tr("Miles")}</TableHead>
                  <TableHead className="text-right">{tr("Driving")}</TableHead>
                  <TableHead className="text-right">{tr("Odometer")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.map((d) => (
                  <TableRow key={`${d.day}-${d.vehicleId}`}>
                    <TableCell data-primary>{fmt.calendarDate(d.day)}</TableCell>
                    <TableCell data-label={tr("Vehicle")}>{d.vehicleName}</TableCell>
                    <TableCell data-label={tr("Trips")} className="text-right tabular-nums">{d.trips}</TableCell>
                    <TableCell data-label={tr("Miles")} className="text-right font-medium tabular-nums">{miles(d.miles)}</TableCell>
                    <TableCell data-label={tr("Driving")} className="text-right tabular-nums">{minutes(d.driveSeconds / 60)}</TableCell>
                    <TableCell data-label={tr("Odometer")} className="text-right text-muted-foreground tabular-nums">
                      {d.startOdometer != null && d.endOdometer != null
                        ? `${Math.round(d.startOdometer).toLocaleString()} → ${Math.round(d.endOdometer).toLocaleString()}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {jobs.length > 0 && (
            <>
              <h2 className="mb-1 text-lg font-semibold">{tr("Miles driven to each customer")}</h2>
              <p className="mb-3 text-sm text-muted-foreground">{tr("The trips that ended at their properties, for pricing far-away jobs.")}</p>
              <div className="overflow-hidden rounded-lg border">
                <Table stack>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("Customer")}</TableHead>
                      <TableHead className="text-right">{tr("Visits")}</TableHead>
                      <TableHead className="text-right">{tr("Miles")}</TableHead>
                      <TableHead className="text-right">{tr("Per visit")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((j) => (
                      <TableRow key={j.customerId}>
                        <TableCell data-primary>
                          <Link href={`/customers/${j.customerId}`} className="font-medium hover:text-link">
                            {j.customer}
                          </Link>
                        </TableCell>
                        <TableCell data-label={tr("Visits")} className="text-right tabular-nums">{j.visits}</TableCell>
                        <TableCell data-label={tr("Miles")} className="text-right tabular-nums">{miles(j.miles)}</TableCell>
                        <TableCell data-label={tr("Per visit")} className="text-right font-medium tabular-nums">{miles(j.miles / j.visits)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

async function MaintenanceTab({ today, fmt }: { today: string; fmt: Formatters }) {
  const { tr } = await getI18n();
  const canService = can(await getCurrentUser(), "fleet.service");
  const rows = await getMaintenance();
  if (rows.length === 0) return <Empty>{tr("No active vehicles.")}</Empty>;
  const stateBadge = {
    overdue: { variant: "destructive", text: (n: number) => tr("Overdue by {n} mi", { n: Math.abs(n).toLocaleString() }) },
    soon: { variant: "outline", text: (n: number) => tr("Due in {n} mi", { n: n.toLocaleString() }) },
    ok: { variant: "success", text: (n: number) => tr("Due in {n} mi", { n: n.toLocaleString() }) },
  } as const;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((v) => (
        <section key={v.id} className="grid content-start gap-4 rounded-lg border bg-card p-4" aria-label={v.name}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">{v.name}</h2>
              <p className="text-[0.8rem] text-muted-foreground">
                {[v.makeModel, v.odometer != null ? `${Math.round(v.odometer).toLocaleString()} mi` : null].filter(Boolean).join(" · ") ||
                  tr("No readings yet")}
              </p>
            </div>
            {v.serviceState !== "unknown" && v.milesLeft != null && (
              <Badge
                variant={stateBadge[v.serviceState].variant}
                className={v.serviceState === "soon" ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" : undefined}
              >
                <Gauge aria-hidden="true" />
                {stateBadge[v.serviceState].text(v.milesLeft)}
              </Badge>
            )}
          </div>

          <div className="grid gap-2 text-sm">
            <div className="font-medium">{tr("Service")}</div>
            {v.lastService ? (
              <p>
                {tr("Last: {date} at {n} mi", { date: fmt.calendarDate(v.lastService.performedOn), n: Math.round(v.lastService.odometer).toLocaleString() })}
                {v.lastService.note && <span className="text-muted-foreground"> · {v.lastService.note}</span>}
                {v.dueAt != null && <span className="text-muted-foreground"> · {tr("next at {n} mi", { n: Math.round(v.dueAt).toLocaleString() })}</span>}
              </p>
            ) : (
              <p className="text-muted-foreground">{tr("No service recorded yet. Record the last one to start reminders.")}</p>
            )}
            {canService && (
              <>
                <IntervalForm vehicleId={v.id} miles={v.serviceIntervalMiles} />
                <ServiceForm vehicleId={v.id} odometer={v.odometer} today={today} />
              </>
            )}
            {v.history.length > 1 && (
              <details className="text-[0.8rem] text-muted-foreground">
                <summary className="cursor-pointer">{tr("Earlier services")}</summary>
                <ul className="mt-1 grid gap-0.5">
                  {v.history.slice(1).map((h) => (
                    <li key={h.id}>
                      {fmt.calendarDate(h.performedOn)} · {Math.round(h.odometer).toLocaleString()} mi{h.note ? ` · ${h.note}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="grid gap-1.5 text-sm">
            <div className="font-medium">{tr("Health")}</div>
            {!v.linked ? (
              <p className="text-muted-foreground">{tr("No Bouncie device linked.")}</p>
            ) : (
              <>
                {v.milOn ? (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-200">
                    <div className="flex items-center gap-1.5 font-medium">
                      <AlertTriangle className="size-4" aria-hidden="true" />
                      {tr("Check engine light is on")}
                    </div>
                    {v.milCodes.length > 0 && (
                      <ul className="mt-1 text-[0.8rem]">
                        {v.milCodes.map((c) => (
                          <li key={c.code}>
                            <span className="font-mono">{c.code}</span>
                            {c.name && ` · ${c.name}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <p>{tr("No engine warnings.")}</p>
                )}
                {v.batteryStatus && v.batteryStatus !== "normal" ? (
                  <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                    <BatteryWarning className="size-4" aria-hidden="true" />
                    {tr("Battery is {state}", { state: tr(v.batteryStatus) })}
                  </p>
                ) : (
                  <p>{tr("Battery normal.")}</p>
                )}
                {v.recentlyUnplugged && v.unpluggedAt && (
                  <p className="flex items-center gap-1.5 font-medium text-destructive">
                    <Plug className="size-4" aria-hidden="true" />
                    {tr("Device lost power {time} (unplugged?)", { time: fmt.stamp(v.unpluggedAt) })}
                  </p>
                )}
              </>
            )}
          </div>

          {v.habits && (
            <div className="grid gap-1 text-sm">
              <div className="font-medium">{tr("Last 30 days")}</div>
              <p className="text-muted-foreground">
                {tr("{miles} in {trips} trips · {braking} hard braking · {accel} hard acceleration", {
                  miles: miles(v.habits.miles),
                  trips: v.habits.trips,
                  braking: v.habits.hardBraking,
                  accel: v.habits.hardAcceleration,
                })}
                {v.habits.maxSpeed != null ? ` · ${tr("top speed {n} mph", { n: Math.round(v.habits.maxSpeed) })}` : ""} ·{" "}
                {tr("{time} idling", { time: minutes(v.habits.idleSeconds / 60) })}
              </p>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

async function RoutesTab({ day, today, fmt }: { day: string; today: string; fmt: Formatters }) {
  const { tr } = await getI18n();
  const groups = await getRouteCheck(day);
  const label = {
    ok: "text-brand-green",
    tight: "text-amber-700 dark:text-amber-400",
    conflict: "text-destructive",
    unknown: "text-muted-foreground",
  } as const;
  return (
    <>
      <DayPicker tab="routes" day={day} today={today} />
      <p className="mb-4 text-sm text-muted-foreground">
        {tr("The time between back-to-back visits, compared with how long that drive usually takes: the middle value of your vehicles' past trips between the two properties, or an estimate from the distance until there's history.")}
      </p>
      {groups.length === 0 ? (
        <Empty>{tr("No appointments on {day}.", { day: fmt.fullDay(day) })}</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <section key={g.vehicleId ?? "none"} className="rounded-lg border bg-card p-4" aria-label={g.vehicle}>
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
                <Truck className="size-4 text-brand-blue" aria-hidden="true" />
                {g.vehicleId ? g.vehicle : tr(g.vehicle)}
                <span className="text-sm font-normal text-muted-foreground">· {plural(tr, g.stops.length, "{n} visit", "{n} visits")}</span>
              </h2>
              <ol className="grid gap-0">
                {g.stops.map((s, i) => {
                  const leg = i > 0 ? g.legs[i - 1] : null;
                  return (
                    <li key={s.id}>
                      {leg && (
                        <div className={cn("my-1 ml-3 border-l-2 border-dashed py-1.5 pl-4 text-[0.8rem]", label[leg.state])}>
                          {leg.driveMinutes == null ? (
                            <>{tr("{time} between visits · no location to estimate the drive", { time: minutes(Math.max(0, leg.gapMinutes)) })}</>
                          ) : leg.state === "conflict" ? (
                            <strong>
                              {tr("Only {gap} between visits, but the drive takes about {drive}", { gap: minutes(Math.max(0, leg.gapMinutes)), drive: minutes(leg.driveMinutes) })}
                            </strong>
                          ) : (
                            <>
                              {tr("{gap} between visits · drive about {drive}", { gap: minutes(leg.gapMinutes), drive: minutes(leg.driveMinutes) })}
                              {leg.state === "tight" && ` · ${tr("tight")}`}
                            </>
                          )}
                          <span className="text-muted-foreground">
                            {leg.samples > 0 ? ` (${plural(tr, leg.samples, "from {n} past trip", "from {n} past trips")})` : leg.driveMinutes != null ? ` (${tr("estimate")})` : ""}
                          </span>
                        </div>
                      )}
                      <div className="flex items-start gap-3">
                        <span className="grid size-6 shrink-0 place-items-center rounded-md border-2 border-brand-blue text-[0.75rem] font-bold text-brand-blue">
                          {i + 1}
                        </span>
                        <div className="min-w-0 text-sm">
                          <div className="font-medium tabular-nums">
                            {fmt.timeRange(s.start, s.end)} ·{" "}
                            <Link href={`/appointments/${s.id}`} className="hover:text-link">
                              {s.customer}
                            </Link>
                          </div>
                          <div className="truncate text-[0.8rem] text-muted-foreground">{s.address}</div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

async function SetupTab({ status, fmt }: { status: Awaited<ReturnType<typeof getFleetStatus>>; fmt: Formatters }) {
  const { tr } = await getI18n();
  const vehicleRows = await getVehicleOptions();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const manage = can(await getCurrentUser(), "fleet.manage");
  const tracked = vehicleRows.filter((v) => v.bouncieImei);
  const untracked = vehicleRows.filter((v) => !v.bouncieImei);
  const deviceOptions = status.devices.map((d) => ({
    imei: d.imei,
    label: [d.nickName, d.model, `…${d.imei.slice(-4)}`].filter(Boolean).join(" · "),
    takenBy: vehicleRows.find((v) => v.bouncieImei === d.imei)?.name ?? null,
  }));
  return (
    <div className="grid gap-6">
      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-base font-semibold">{tr("Bouncie account")}</h2>
        {status.connection ? (
          <div className="mt-2 grid gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="success">{tr("Connected")}</Badge>
              <span>
                {status.connection.email ?? "Bouncie account"} · since {fmt.date(status.connection.connectedAt)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RefreshButton label={tr("Check for new vehicles")} />
              {manage && (
                <>
                  <a href="/api/bouncie/connect" className={buttonVariants({ variant: "outline" })}>
                    <Plug aria-hidden="true" />
                    {tr("Reconnect Bouncie")}
                  </a>
                  <DisconnectButton />
                </>
              )}
            </div>
            <p className="text-muted-foreground">
              Every car with a Bouncie tracker on your account is added here automatically, named after its Bouncie nickname. Put a tracker
              in another car? It appears with the next update. If it doesn&apos;t, press Reconnect Bouncie and approve access again so
              Bouncie shares the new device.
            </p>
          </div>
        ) : status.configured ? (
          <div className="mt-2 grid gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground">{tr("Ready to connect.")}</span>
              {manage ? (
                <a href="/api/bouncie/connect" className={buttonVariants()}>
                  <Plug aria-hidden="true" />
                  {tr("Connect Bouncie")}
                </a>
              ) : (
                <span className="text-muted-foreground">{tr("Ask the owner to connect it.")}</span>
              )}
            </div>
            <p className="text-muted-foreground">{tr("Your vehicles are added from Bouncie as soon as it's connected.")}</p>
          </div>
        ) : (
          <div className="mt-2 grid gap-3 text-sm">
            <p className="text-muted-foreground">{tr("Not set up yet. One-time steps:")}</p>
            <ol className="ml-5 grid list-decimal gap-2">
              <li>
                Sign in at{" "}
                <a href="https://www.bouncie.dev/" target="_blank" rel="noopener noreferrer" className={linkClass}>
                  bouncie.dev
                </a>{" "}
                {tr("with your Bouncie account and create an application.")}
              </li>
              <li>
                Add this redirect URI to it: <code className="rounded bg-muted px-1.5 py-0.5 text-[0.8rem] break-all">{origin}/api/bouncie/callback</code>{" "}
                (add the production address too when the app is deployed).
              </li>
              <li>
                Put its details in <code className="rounded bg-muted px-1.5 py-0.5 text-[0.8rem]">.env.local</code> (and in Vercel for production):
                <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 text-[0.8rem]">{`BOUNCIE_CLIENT_ID=…
BOUNCIE_CLIENT_SECRET=…
BOUNCIE_REDIRECT_URI=${origin}/api/bouncie/callback`}</pre>
              </li>
              <li>{tr("Restart the app, then come back here and press Connect Bouncie.")}</li>
            </ol>
          </div>
        )}
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">{tr("Instant updates (webhooks, after deploying)")}</summary>
          <div className="mt-2 grid gap-2 text-muted-foreground">
            <p>
              Without webhooks the page asks Bouncie for updates every minute while it&apos;s open. Once the app is deployed, add a webhook
              on bouncie.dev so trips arrive the moment they end, even when nobody has the page open:
            </p>
            <ul className="ml-5 list-disc">
              <li>
                URL: <code className="rounded bg-muted px-1.5 py-0.5 text-[0.8rem]">https://your-domain/api/bouncie/webhook</code>
              </li>
              <li>{tr("Events: Trip End, Trip Metrics, MIL, Low Battery, Device Disconnected")}</li>
              <li>
                Key: a long random value, also set as <code className="rounded bg-muted px-1.5 py-0.5 text-[0.8rem]">{tr("BOUNCIE_WEBHOOK_KEY")}</code>{" "}
                {status.webhookConfigured ? "(set)" : "(not set)"}
              </li>
            </ul>
          </div>
        </details>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-base font-semibold">{tr("Vehicles")}</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          From your Bouncie account. To rename one, change its nickname in the Bouncie app; the new name shows here with the next update.
        </p>
        {tracked.length === 0 ? (
          <Empty>{status.source ? "No vehicles yet. They're added with the next update from Bouncie." : "Connect Bouncie to add your vehicles."}</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("Vehicle")}</TableHead>
                  <TableHead>{tr("Model")}</TableHead>
                  <TableHead>{tr("Tracker")}</TableHead>
                  <TableHead className="text-right">{tr("Upcoming visits")}</TableHead>
                  <TableHead>{tr("Status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tracked.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell data-primary className="font-medium">{v.name}</TableCell>
                    <TableCell data-label={tr("Model")}>{v.makeModel ?? "—"}</TableCell>
                    <TableCell data-label={tr("Tracker")} className="font-mono text-[0.8rem] text-muted-foreground">…{v.bouncieImei!.slice(-4)}</TableCell>
                    <TableCell data-label={tr("Upcoming visits")} className="text-right tabular-nums">{v.upcoming}</TableCell>
                    <TableCell data-label={tr("Status")}>
                      {v.isActive ? (
                        <Badge variant="success">{tr("In service")}</Badge>
                      ) : (
                        <Badge variant="muted" title={tr("Bouncie no longer shares this tracker")}>{tr("Not on the Bouncie account")}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {untracked.length > 0 && manage && (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-base font-semibold">{tr("Vehicles without a tracker")}</h2>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            Added by hand before vehicles came from Bouncie. Pick the tracker that&apos;s in each one to merge it with the vehicle Bouncie
            added (its past visits and trips stay together), or leave it.
          </p>
          <div className="overflow-hidden rounded-lg border">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("Vehicle")}</TableHead>
                  <TableHead>{tr("Tracker")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {untracked.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell data-primary className="font-medium">
                      {v.name}
                      {v.upcoming > 0 && <span className="ml-2 text-[0.8rem] font-normal text-muted-foreground">{v.upcoming} upcoming visits</span>}
                    </TableCell>
                    <TableCell data-label={tr("Tracker")} className="w-80">
                      <LinkDevice vehicleId={v.id} current={null} devices={deviceOptions} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}

async function FleetPage({ searchParams }: Pick<PageProps<"/fleet">, "searchParams">) {
  const [params, { fmt, tr }, today, status, user] = await Promise.all([searchParams, getI18n(), getToday(), getFleetStatus(), getCurrentUser()]);
  const manage = can(user, "fleet.manage");
  // the Setup tab (and finding properties on the map) is for those who manage the fleet
  const shownTabs = fleetTabs.filter((t) => t !== "setup" || manage);
  const rawTab = one(params.tab) as FleetTab;
  const tab: FleetTab = shownTabs.includes(rawTab) ? rawTab : "live";
  const day = parseDay(one(params.day), today);
  const connect = connectMessages[one(params.bouncie) ?? ""];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <MapPinned className="size-7 text-brand-blue" aria-hidden="true" />
            {tr("Fleet")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {status.source === "bouncie"
              ? tr("Live from Bouncie")
              : status.source === "simulated"
                ? isDemo()
                  ? tr("Simulated vans driving the demo schedule")
                  : "Simulated vehicles (development only)"
                : tr("Bouncie isn't connected")}
            {status.source && status.lastSyncedAt && ` · ${tr("updated {time}", { time: fmt.stamp(status.lastSyncedAt) })}`}
          </p>
        </div>
        {status.source && <RefreshButton />}
      </div>

      {connect && (
        <p
          role={connect.ok ? "status" : "alert"}
          className={cn(
            "mb-4 rounded-lg border px-4 py-2.5 text-sm font-medium",
            connect.ok ? "border-brand-green/40 bg-success text-success-foreground" : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {tr(connect.text)}
        </p>
      )}
      {status.source === "simulated" && isDemo() && (
        <p className="mb-4 rounded-lg border border-brand-green/40 bg-brand-green/10 px-4 py-2.5 text-sm">
          {tr(
            "In the demo, two simulated vans drive the day's schedule. Their trips go through the same visit detection as real Bouncie data: visits start when a van arrives and complete when it leaves.",
          )}
        </p>
      )}
      {status.source === "simulated" && !isDemo() && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-900 dark:text-amber-200">
          {/* development only, so not translated */}
          These vehicles, trips and readings are <strong>made up from your schedule</strong> so the page can be tried before Bouncie is
          connected. They never appear in production. Connect your account on the{" "}
          <Link href="/fleet?tab=setup" className="font-medium underline underline-offset-4">
            Setup
          </Link>{" "}
          tab to see your real vehicles.
        </p>
      )}
      {status.lastError && (
        <p role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {tr("The last update failed: {error}", { error: status.lastError })}
        </p>
      )}
      {status.pendingLookups > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-secondary/40 px-4 py-2.5 text-sm">
          <span>
            {plural(
              tr,
              status.pendingLookups,
              "{n} property doesn't have a map location yet, so visits there can't be detected.",
              "{n} properties don't have a map location yet, so visits there can't be detected.",
            )}
          </span>
          {manage && <LocateButton pending={status.pendingLookups} />}
        </div>
      )}

      <nav aria-label={tr("Fleet sections")} className="mb-5 flex gap-1 overflow-x-auto border-b">
        {shownTabs.map((t) => (
          <Link
            key={t}
            href={`/fleet?tab=${t}${t === "visits" || t === "routes" ? `&day=${day}` : ""}`}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground",
              "after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-full",
              tab === t && "text-foreground after:bg-brand-green",
            )}
          >
            {tr(tabLabels[t])}
          </Link>
        ))}
      </nav>

      {!status.source && tab !== "setup" ? (
        <Empty>
          {manage ? (
            <>
              Connect Bouncie on the{" "}
              <Link href="/fleet?tab=setup" className={linkClass}>
                Setup
              </Link>{" "}
              tab to see your vehicles here.
            </>
          ) : (
            tr("Bouncie isn't connected yet, so there's nothing to show. Ask the owner.")
          )}
        </Empty>
      ) : tab === "live" ? (
        <LiveTab day={today} fmt={fmt} />
      ) : tab === "visits" ? (
        <VisitsTab day={day} today={today} fmt={fmt} />
      ) : tab === "mileage" ? (
        <MileageTab range={mileageRange(one(params.range), one(params.from), one(params.to), today)} fmt={fmt} />
      ) : tab === "maintenance" ? (
        <MaintenanceTab today={today} fmt={fmt} />
      ) : tab === "routes" ? (
        <RoutesTab day={day} today={today} fmt={fmt} />
      ) : (
        <SetupTab status={status} fmt={fmt} />
      )}
    </>
  );
}

export default function Page(props: PageProps<"/fleet">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <FleetPage searchParams={props.searchParams} />
    </Suspense>
  );
}
