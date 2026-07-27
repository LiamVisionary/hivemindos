"use client";

import { useEffect } from "react";

export default function IntegrationsRoute() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "integrations");
    window.location.replace(`/?${params.toString()}`);
  }, []);

  return null;
}
