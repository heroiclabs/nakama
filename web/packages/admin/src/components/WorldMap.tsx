import { useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { ISO_NUMERIC, countryName } from "@/lib/iso-countries";

export interface CountryDatum {
  country: string; // ISO alpha-2
  users: number;
}

interface WorldMapProps {
  data: CountryDatum[];
  height?: number;
}

// Violet ramp matched to the admin --primary token. Index by intensity 0..1.
function colorFor(intensity: number): string {
  if (intensity <= 0) return "hsl(215 28% 17%)"; // muted (no data)
  // Interpolate lightness of the brand violet from dim → bright.
  const light = 26 + Math.round(intensity * 38); // 26%..64%
  return `hsl(263 70% ${light}%)`;
}

export function WorldMap({ data, height = 360 }: WorldMapProps) {
  const [topo, setTopo] = useState<unknown | null>(null);
  const [hover, setHover] = useState<{ name: string; users: number } | null>(null);

  // Lazy-load the ~100KB topojson only when the map mounts.
  useEffect(() => {
    let alive = true;
    import("world-atlas/countries-110m.json")
      .then((m) => {
        if (alive) setTopo((m as { default: unknown }).default ?? m);
      })
      .catch(() => {
        if (alive) setTopo(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const byA2 = useMemo(() => {
    const map: Record<string, number> = {};
    let max = 0;
    for (const d of data) {
      const cc = (d.country || "").toUpperCase();
      if (!cc) continue;
      map[cc] = (map[cc] || 0) + d.users;
      if (map[cc] > max) max = map[cc];
    }
    return { map, max };
  }, [data]);

  if (!topo) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-muted/30 text-sm text-muted-foreground"
        style={{ height }}
      >
        Loading map…
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card">
      <ComposableMap
        projection="geoEqualEarth"
        projectionConfig={{ scale: 150 }}
        height={height}
        width={800}
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography={topo as never}>
          {({ geographies }: { geographies: any[] }) =>
            geographies.map((geo) => {
              const meta = ISO_NUMERIC[String(geo.id)];
              const a2 = meta?.a2 ?? "";
              const users = a2 ? byA2.map[a2] || 0 : 0;
              const intensity = byA2.max > 0 ? users / byA2.max : 0;
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={colorFor(intensity)}
                  stroke="hsl(224 71% 4%)"
                  strokeWidth={0.3}
                  onMouseEnter={() =>
                    setHover({
                      name: meta?.name ?? "Unknown",
                      users,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                  style={{
                    default: { outline: "none" },
                    hover: { outline: "none", fill: "hsl(263 70% 62%)" },
                    pressed: { outline: "none" },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>
      {hover && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
          <span className="font-medium">{hover.name}</span>
          <span className="ml-2 tabular-nums text-muted-foreground">
            {hover.users} {hover.users === 1 ? "user" : "users"}
          </span>
        </div>
      )}
    </div>
  );
}

export { countryName };
