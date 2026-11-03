// Floor plans drawn in code from a unit type's beds, baths and square footage (image models draw
// them badly). Pure and deterministic: the same plan always gives the same layout. Units are feet;
// the renderer (tabs/FloorPlan.tsx) scales them to pixels.

export type Room = { kind: "living" | "kitchen" | "bed" | "bath" | "closet" | "open" | "office" | "storage"; label: string; x: number; y: number; w: number; h: number; door?: Door };
// A door on one wall of the room: offset (ft) from the wall's start, opening into the room.
export type Door = { wall: "top" | "bottom" | "left" | "right"; at: number; width: number };
export type Plan = { width: number; height: number; rooms: Room[]; entry: Door & { room: number } };

const r1 = (n: number) => Math.round(n * 10) / 10;

export function planLayout({ beds, baths, sqft }: { beds: number; baths: number; sqft: number }): Plan {
  const area = Math.max(300, sqft);
  const width = r1(Math.sqrt(area * 1.45));
  const height = r1(area / width);
  const commercial = beds === 0 && area > 1200;
  const fullBaths = Math.max(1, Math.floor(baths));
  const half = baths - Math.floor(baths) >= 0.5 ? 1 : 0;
  const rooms: Room[] = [];
  const add = (r: Omit<Room, "x" | "y" | "w" | "h"> & { x: number; y: number; w: number; h: number }) => rooms.push({ ...r, x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) });

  if (commercial) {
    const openW = width * 0.68;
    add({ kind: "open", label: "Open area", x: 0, y: 0, w: openW, h: height, door: { wall: "left", at: height * 0.45, width: 3.5 } });
    const colW = width - openW;
    add({ kind: "office", label: "Office", x: openW, y: 0, w: colW, h: height * 0.45, door: { wall: "left", at: height * 0.3, width: 3 } });
    add({ kind: "bath", label: "Restroom", x: openW, y: height * 0.45, w: colW, h: height * 0.25, door: { wall: "left", at: 1, width: 3 } });
    add({ kind: "storage", label: "Storage", x: openW, y: height * 0.7, w: colW, h: height * 0.3, door: { wall: "left", at: 1, width: 3 } });
    return { width, height, rooms, entry: { room: 0, wall: "left", at: height * 0.45, width: 3.5 } };
  }

  // Front band: living (and kitchen); back band: bedrooms then a column of baths and closet.
  const frontH = height * (beds === 0 ? 0.58 : 0.46);
  const kitchenW = width * (beds === 0 ? 0.36 : 0.32);
  add({ kind: "living", label: beds === 0 ? "Living / sleeping" : "Living", x: 0, y: 0, w: width - kitchenW, h: frontH });
  add({ kind: "kitchen", label: "Kitchen", x: width - kitchenW, y: 0, w: kitchenW, h: frontH });

  const backH = height - frontH;
  const bathCount = fullBaths + half;
  const colW = beds === 0 ? width * 0.45 : Math.max(6, width * (0.2 + 0.03 * bathCount));
  const bedsW = width - colW;
  if (beds === 0) {
    add({ kind: "closet", label: "Closet", x: 0, y: frontH, w: width - colW, h: backH, door: { wall: "top", at: 1.5, width: 2.5 } });
  } else {
    // The primary bedroom is a quarter larger than the others.
    const weights = Array.from({ length: beds }, (_, i) => (i === 0 ? 1.25 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let x = 0;
    weights.forEach((wgt, i) => {
      const w = (bedsW * wgt) / total;
      add({ kind: "bed", label: i === 0 ? (beds > 1 ? "Primary bedroom" : "Bedroom") : `Bedroom ${i + 1}`, x, y: frontH, w, h: backH, door: { wall: "top", at: Math.min(1.5, w / 4), width: 2.8 } });
      x += w;
    });
  }
  const slots = bathCount + (beds > 0 ? 1 : 0);
  const slotH = backH / slots;
  for (let i = 0; i < bathCount; i++) {
    const isHalf = i >= fullBaths;
    add({ kind: "bath", label: isHalf ? "Half bath" : bathCount > 1 ? `Bath ${i + 1}` : "Bath", x: bedsW, y: frontH + i * slotH, w: colW, h: slotH, door: { wall: "left", at: Math.min(1, slotH / 4), width: 2.5 } });
  }
  if (beds > 0) add({ kind: "closet", label: "W/D · closet", x: bedsW, y: frontH + bathCount * slotH, w: colW, h: slotH, door: { wall: "left", at: Math.min(1, slotH / 4), width: 2.5 } });

  return { width, height, rooms, entry: { room: 0, wall: "top", at: Math.min(3, rooms[0].w / 4), width: 3 } };
}

// 12.5 → 12'6"
export function feet(n: number) {
  const ft = Math.floor(n);
  const inches = Math.round((n - ft) * 12);
  return inches === 12 ? `${ft + 1}'0"` : `${ft}'${inches}"`;
}
