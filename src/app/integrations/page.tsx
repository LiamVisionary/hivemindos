"use client";

import { useEffect } from "react";

export default function IntegrationsRoute() {
  useEffect(() => {
    window.location.replace("/?view=integrations");
  }, []);

  return null;
}
