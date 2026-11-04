import { currentPersona } from "@/auth/session";
import { settingsNav } from "@/extensions/settings/nav";
import { SettingsNav } from "@/extensions/settings/ui/SettingsNav";

// Settings frame: a section nav beside every /app/settings page.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const persona = await currentPersona();
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <SettingsNav groups={settingsNav(persona.role)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
