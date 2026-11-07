"use client";

import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePortalAction } from "../usePortalAction";

// Submits a started application once the fee and the first documents are in.
export function SubmitApplication({ me }: { me: string }) {
  const { run, busy } = usePortalAction("applicants", me);
  return <Button className="max-md:h-11" disabled={!!busy} onClick={() => run("submit_application", {})}><Send data-icon="inline-start" />{busy ? "Submitting…" : "Submit application"}</Button>;
}
