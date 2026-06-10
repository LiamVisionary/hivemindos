"use client";

import { useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectPhoneModal } from "@/components/phone/ConnectPhoneModal";

// Floating "connect a phone" action, pinned to the dashboard's bottom-right.
// Opens the pairing QR in a modal so the user never leaves the current view.
export function ConnectPhoneFab() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="icon-lg"
        onClick={() => setOpen(true)}
        aria-label="Connect a phone"
        title="Connect a phone"
        className="fixed bottom-6 right-6 z-40 rounded-full shadow-lg"
      >
        <Smartphone aria-hidden="true" className="size-5" />
      </Button>
      <ConnectPhoneModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
