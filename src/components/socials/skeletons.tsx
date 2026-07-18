"use client";

import { LoaderCircle } from "lucide-react";

/** Shape-matched loading state for the Socials desk (never a bare "Loading…"). */
export function SocialsDeskSkeleton() {
  return (
    <div className="sc-wrap" role="status" aria-label="Loading socials desk">
      <div className="sc-skel" style={{ height: 34, width: 260 }} />
      <div className="sc-body">
        <div className="sc-rail">
          {[0, 1, 2].map((i) => (
            <div key={i} className="sc-skel" style={{ height: 58 }} />
          ))}
        </div>
        <div className="sc-col">
          <div className="sc-skel" style={{ height: 96 }} />
          <div className="sc-skel" style={{ height: 150 }} />
          <div className="sc-skel" style={{ height: 120 }} />
        </div>
      </div>
    </div>
  );
}

/** Inline busy spinner for buttons (keeps the word, swaps the icon). */
export function SocialsSpinner({ size = 14 }: { size?: number }) {
  return <LoaderCircle aria-hidden="true" width={size} height={size} className="sc-spin" />;
}
