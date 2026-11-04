import { cn } from "@/lib/utils";

// Page frame used by every /app page: header (title, description, actions) and a padded body.
// Content fills the width; no centred narrow columns (brief §5.2).

export function PageHeader({ title, description, actions, icon, meta, className, children }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  meta?: React.ReactNode;                 // small line under the title: counts, scope, as-of
  className?: string;
  children?: React.ReactNode;             // tabs or a filter row under the header
}) {
  return (
    <div className={cn("px-4 pt-5 md:px-6", className)}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-3">
          {icon && <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-xs [&_svg]:size-4">{icon}</span>}
          <div className="min-w-0">
            <h1 className="truncate text-[20px] leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
            {description && <p className="mt-0.5 max-w-3xl text-muted-foreground">{description}</p>}
            {meta && <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex max-w-full flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-5 px-4 pt-4 pb-10 md:px-6", className)}>{children}</div>;
}

// Titled block inside a page (dashboards, settings, the kit).
export function Section({ title, description, actions, children, className, id }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("min-w-0 scroll-mt-4", className)}>
      {(title || actions) && (
        <div className="mb-2.5 flex flex-wrap items-end gap-x-3 gap-y-2">
          <div className="min-w-[min(100%,16rem)] flex-1">
            {title && <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>}
            {description && <p className="text-[12.5px] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
