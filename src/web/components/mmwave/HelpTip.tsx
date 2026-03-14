import type { ReactNode } from "react";

interface HelpTipProps {
  title: string;
  children: ReactNode;
  align?: "left" | "right";
}

export function HelpTip({ title, children, align = "left" }: HelpTipProps) {
  return (
    <details className={`help-tip${align === "right" ? " align-right" : ""}`}>
      <summary aria-label={title} title={title}>
        <span aria-hidden="true">?</span>
      </summary>
      <div className="help-popover" role="note">
        <strong>{title}</strong>
        <div className="help-popover-body">{children}</div>
      </div>
    </details>
  );
}
