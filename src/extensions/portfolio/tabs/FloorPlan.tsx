import { feet, planLayout, type Door, type Room } from "../floorplan";

// SVG floor plan from planLayout(). No hooks, so server and client components can both render it.
const PX = 14; // pixels per foot in the viewBox
const PAD = 26;

const FILL: Record<Room["kind"], string> = {
  living: "color-mix(in oklab, var(--chart-1) 7%, var(--card))",
  kitchen: "color-mix(in oklab, var(--chart-2) 9%, var(--card))",
  bed: "color-mix(in oklab, var(--chart-1) 12%, var(--card))",
  bath: "color-mix(in oklab, var(--chart-3) 11%, var(--card))",
  closet: "var(--muted)",
  open: "color-mix(in oklab, var(--chart-1) 7%, var(--card))",
  office: "color-mix(in oklab, var(--chart-1) 12%, var(--card))",
  storage: "var(--muted)",
};

// Door gap, leaf and swing arc, in viewBox pixels.
function DoorMark({ room, door }: { room: Room; door: Door }) {
  const x0 = PAD + room.x * PX, y0 = PAD + room.y * PX, w = room.w * PX, h = room.h * PX;
  const d = door.width * PX, at = door.at * PX;
  let hinge: [number, number], open: [number, number], closed: [number, number];
  if (door.wall === "top") { hinge = [x0 + at, y0]; closed = [x0 + at + d, y0]; open = [x0 + at, y0 + d]; }
  else if (door.wall === "bottom") { hinge = [x0 + at, y0 + h]; closed = [x0 + at + d, y0 + h]; open = [x0 + at, y0 + h - d]; }
  else if (door.wall === "left") { hinge = [x0, y0 + at]; closed = [x0, y0 + at + d]; open = [x0 + d, y0 + at]; }
  else { hinge = [x0 + w, y0 + at]; closed = [x0 + w, y0 + at + d]; open = [x0 + w - d, y0 + at]; }
  const sweep = door.wall === "top" || door.wall === "right" ? 1 : 0;
  return (
    <g>
      <line x1={hinge[0]} y1={hinge[1]} x2={closed[0]} y2={closed[1]} stroke="var(--card)" strokeWidth={4} />
      <line x1={hinge[0]} y1={hinge[1]} x2={open[0]} y2={open[1]} stroke="currentColor" strokeWidth={1.25} />
      <path d={`M ${open[0]} ${open[1]} A ${d} ${d} 0 0 ${sweep} ${closed[0]} ${closed[1]}`} fill="none" stroke="currentColor" strokeWidth={0.75} strokeDasharray="2 2" opacity={0.6} />
    </g>
  );
}

export function FloorPlan({ beds, baths, sqft, name, className }: { beds: number; baths: number; sqft: number; name: string; className?: string }) {
  const p = planLayout({ beds, baths, sqft });
  const W = p.width * PX + PAD * 2, H = p.height * PX + PAD * 2 + 18;
  const entryRoom = p.rooms[p.entry.room];
  const scaleFt = 10;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Floor plan ${name}: ${beds === 0 ? "studio or open plan" : `${beds} bed`}, ${baths} bath, ${sqft} square feet`} className={className} style={{ color: "var(--foreground)" }}>
      {p.rooms.map((r, i) => (
        <g key={i}>
          <rect x={PAD + r.x * PX} y={PAD + r.y * PX} width={r.w * PX} height={r.h * PX} fill={FILL[r.kind]} stroke="currentColor" strokeWidth={1.5} />
          <text x={PAD + (r.x + r.w / 2) * PX} y={PAD + (r.y + r.h / 2) * PX - 2} textAnchor="middle" fontSize={r.w * PX < 90 ? 9.5 : 11} fontWeight={600} fill="currentColor">{r.label}</text>
          <text x={PAD + (r.x + r.w / 2) * PX} y={PAD + (r.y + r.h / 2) * PX + 11} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">{feet(r.w)} × {feet(r.h)}</text>
        </g>
      ))}
      {p.rooms.map((r, i) => r.door && <DoorMark key={`d${i}`} room={r} door={r.door} />)}
      <DoorMark room={entryRoom} door={p.entry} />
      {/* Outer wall drawn last so it sits over room edges and door gaps on the shell. */}
      <rect x={PAD} y={PAD} width={p.width * PX} height={p.height * PX} fill="none" stroke="currentColor" strokeWidth={3.5} />
      <line x1={PAD + entryRoom.x * PX + p.entry.at * PX} y1={PAD} x2={PAD + entryRoom.x * PX + (p.entry.at + p.entry.width) * PX} y2={PAD} stroke="var(--card)" strokeWidth={5} style={{ display: p.entry.wall === "top" ? undefined : "none" }} />
      <text x={PAD + entryRoom.x * PX + (p.entry.at + p.entry.width / 2) * PX} y={PAD - 6} textAnchor="middle" fontSize={8.5} fill="var(--muted-foreground)" style={{ display: p.entry.wall === "top" ? undefined : "none" }}>ENTRY</text>
      {/* North arrow */}
      <g transform={`translate(${W - PAD + 8}, ${PAD - 4})`} fill="currentColor">
        <path d="M0 -10 L5 4 L0 1 L-5 4 Z" />
        <text y={14} textAnchor="middle" fontSize={8.5} fontWeight={600}>N</text>
      </g>
      {/* Scale bar */}
      <g transform={`translate(${PAD}, ${H - 14})`} fontSize={8.5} fill="var(--muted-foreground)">
        <rect width={scaleFt * PX / 2} height={4} fill="currentColor" style={{ color: "var(--foreground)" }} />
        <rect x={scaleFt * PX / 2} width={scaleFt * PX / 2} height={4} fill="none" stroke="var(--foreground)" strokeWidth={1} />
        <text x={0} y={-3}>0</text>
        <text x={scaleFt * PX} y={-3} textAnchor="end">{scaleFt} ft</text>
        <text x={W - PAD * 2} y={4} textAnchor="end">{sqft.toLocaleString("en-US")} sq ft · {beds === 0 ? (sqft > 1200 ? "Suite" : "Studio") : `${beds} bd`} · {baths} ba · not to scale for construction</text>
      </g>
    </svg>
  );
}
