// Page heading inside a portal: larger and friendlier than the staff app, still plain.
export function PortalTitle({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-[12px] font-medium text-muted-foreground">{eyebrow}</p>}
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-balance md:text-[24px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-muted-foreground text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
