"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { useI18n } from "@/components/i18n-provider";

export type MapVehicle = { id: number; name: string; lat: number; lng: number; running: boolean; detail: string };
export type MapStop = { id: number; lat: number; lng: number; order: number; title: string; detail: string; state: "pending" | "here" | "done" };

// Names and addresses come from the database; never let them become markup.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const BALTIMORE: [number, number] = [39.29, -76.61];

// Live map: vehicles (green while driving, blue when parked) and the day's
// stops, numbered in order. Leaflet with OpenStreetMap tiles; it only runs in
// the browser, so it's loaded once the component mounts. Markers are redrawn
// when the data refreshes, without moving the view the user has panned to.
export function FleetMap({ vehicles, stops }: { vehicles: MapVehicle[]; stops: MapStop[] }) {
  const { tr } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      const L = mod.default ?? mod;
      if (cancelled || !el.current || map.current) return;
      leaflet.current = L;
      const m = L.map(el.current, { scrollWheelZoom: false }).setView(BALTIMORE, 11);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        // OpenStreetMap needs a referrer; send the site's origin only, never
        // page addresses (they contain customer ids)
        referrerPolicy: "strict-origin-when-cross-origin",
      }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leaflet.current;
    if (!ready || !L || !map.current || !layer.current) return;
    layer.current.clearLayers();
    const bounds: [number, number][] = [];
    for (const s of stops) {
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: "", html: `<div class="fleet-stop fleet-stop-${s.state}">${s.order}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        title: s.title,
      })
        .bindPopup(`<strong>${esc(s.title)}</strong><br>${esc(s.detail)}`)
        .addTo(layer.current);
      bounds.push([s.lat, s.lng]);
    }
    for (const v of vehicles) {
      L.marker([v.lat, v.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="fleet-vehicle${v.running ? " is-running" : ""}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 6h11v9H3zM14 9h4l3 3v3h-7zM7 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0m13 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0"/></svg></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        title: v.name,
        zIndexOffset: 1000,
      })
        .bindTooltip(esc(v.name), { permanent: true, direction: "right", offset: [14, 0], className: "fleet-label" })
        .bindPopup(`<strong>${esc(v.name)}</strong><br>${esc(v.detail)}`)
        .addTo(layer.current);
      bounds.push([v.lat, v.lng]);
    }
    if (!fitted.current && bounds.length) {
      map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      fitted.current = true;
    }
  }, [ready, vehicles, stops]);

  return (
    <div className="isolate overflow-hidden rounded-lg border">
      <div ref={el} className="h-[22rem] w-full bg-muted sm:h-[28rem]" role="region" aria-label={tr("Map of vehicles and today's stops")} />
    </div>
  );
}
