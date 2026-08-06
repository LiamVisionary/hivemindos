import { LoaderCircle } from "lucide-react";

/** Content-shaped loading state for the redesigned Socials command center. */
export function SocialsDeskSkeleton() {
  return (
    <div className="sc-redesign-skeleton" role="status" aria-label="Loading socials desk">
      <div className="sc-skeleton-head">
        <div><div className="sc-skel" /><div className="sc-skel" /></div>
        <div className="sc-skel" />
      </div>
      <div className="sc-skeleton-chips">{Array.from({ length: 4 }, (_, index) => <div key={index} className="sc-skel" />)}</div>
      <div className="sc-skeleton-tabs">{Array.from({ length: 4 }, (_, index) => <div key={index} className="sc-skel" />)}</div>
      <div className="sc-skeleton-body">
        <div className="sc-skeleton-stats">{Array.from({ length: 4 }, (_, index) => <div key={index} className="sc-skel" />)}</div>
        <div className="sc-skeleton-grid"><div className="sc-skel" /><div><div className="sc-skel" /><div className="sc-skel" /></div></div>
      </div>
    </div>
  );
}

export function SocialsSpinner({ size = 14 }: { size?: number }) {
  return <LoaderCircle aria-hidden="true" width={size} height={size} className="sc-spin" />;
}
