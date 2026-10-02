import type { ReactNode } from 'react';

/** Compact single-line page header for admin (and dense screens). */
export function PageHead({
  title,
  meta,
  action,
  back,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="page-head">
      {back}
      <div className="page-head-main">
        <h1 className="page-head-title">{title}</h1>
        {meta != null && meta !== '' && <span className="page-head-meta">{meta}</span>}
      </div>
      {action && <div className="page-head-action">{action}</div>}
    </div>
  );
}
