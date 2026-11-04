"use client";

import { TourOverlay, useTour } from "@/components/app/tour/TourEngine";
import type { TourDef } from "@/components/app/tour/types";

// The staff app's tour engine, for portals (the portal frame has no app shell).
export function PortalTour({ tours }: { tours: TourDef[] }) {
  const tour = useTour(tours);
  return <TourOverlay active={tour.active} go={tour.go} dismiss={tour.dismiss} />;
}
