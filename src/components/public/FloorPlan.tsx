// Schematic floor plan drawn from the plan's beds, baths and square feet. Room sizes are
// proportional to the total; the caption says it's illustrative, not to scale.

type Room = { name: string; x: number; y: number; w: number; h: number };

function layout(beds: number, baths: number): Room[] {
  const bathCount = Math.max(1, Math.round(baths));
  if (beds === 0) {
    return [
      { name: "Living / sleeping", x: 0, y: 0, w: 0.62, h: 1 },
      { name: "Kitchen", x: 0.62, y: 0, w: 0.38, h: 0.55 },
      { name: "Bath", x: 0.62, y: 0.55, w: 0.38, h: 0.45 },
    ];
  }
  const left = beds >= 3 ? 0.46 : 0.52;
  const rooms: Room[] = [
    { name: "Living", x: 0, y: 0, w: left, h: 0.6 },
    { name: "Kitchen", x: 0, y: 0.6, w: left * 0.62, h: 0.4 },
    { name: "Dining", x: left * 0.62, y: 0.6, w: left * 0.38, h: 0.4 },
  ];
  const right = 1 - left;
  const bathH = 0.26;
  const bedH = (1 - bathH) / Math.ceil(beds / 2);
  for (let i = 0; i < beds; i++) {
    const col = beds === 1 ? 0 : i % 2;
    const w = beds === 1 ? right : right / 2;
    rooms.push({ name: i === 0 ? "Primary bedroom" : `Bedroom ${i + 1}`, x: left + col * w, y: Math.floor(beds === 1 ? 0 : i / 2) * bedH, w, h: beds === 1 ? 1 - bathH : bedH });
  }
  for (let i = 0; i < bathCount; i++) rooms.push({ name: bathCount > 1 ? `Bath ${i + 1}` : "Bath", x: left + (i * right) / bathCount, y: 1 - bathH, w: right / bathCount, h: bathH });
  return rooms;
}

export function FloorPlan({ beds, baths, sqft, plan }: { beds: number; baths: number; sqft: number; plan: string }) {
  const ftW = Math.sqrt(sqft * 1.5);
  const ftH = sqft / ftW;
  const W = 360;
  const H = Math.round(W / 1.5);
  const rooms = layout(beds, baths);
  return (
    <figure className="space-y-2">
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="h-auto w-full text-foreground" role="img" aria-label={`Floor plan ${plan}: ${rooms.map((r) => r.name).join(", ")}; ${sqft} square feet`}>
        <rect x={0} y={0} width={W} height={H} rx={2} className="fill-muted/50" stroke="currentColor" strokeWidth={3} />
        {rooms.map((r) => {
          const x = r.x * W, y = r.y * H, w = r.w * W, h = r.h * H;
          const small = w < 80 || h < 50;
          return (
            <g key={r.name}>
              <rect x={x} y={y} width={w} height={h} fill="none" stroke="currentColor" strokeWidth={1.5} />
              <text x={x + 8} y={y + 18} className="fill-current" fontSize={small ? 9.5 : 11} fontWeight={600}>{r.name}</text>
              {!small && <text x={x + 8} y={y + 32} className="fill-muted-foreground" fontSize={10}>{`${Math.round(r.w * ftW)}′ × ${Math.round(r.h * ftH)}′`}</text>}
            </g>
          );
        })}
        <rect x={W * 0.18} y={H - 2} width={28} height={4} className="fill-background" />
      </svg>
      <figcaption className="text-[12.5px] text-muted-foreground">Plan {plan} · {sqft.toLocaleString("en-US")} sq ft. Illustrative layout, not to scale; room sizes are approximate.</figcaption>
    </figure>
  );
}
