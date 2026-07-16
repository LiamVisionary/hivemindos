"use client";

import { useEffect } from "react";

export default function BeelineRoute() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "beeline");
    window.location.replace(`/?${params.toString()}`);
  }, []);

  return null;
}

