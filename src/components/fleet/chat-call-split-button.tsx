"use client";

import type * as React from "react";
import { MessageSquare, PhoneCall } from "lucide-react";

export type ChatCallSplitButtonProps = {
  name: string;
  chatLabel?: string;
  callLabel?: string;
  onChat?: React.MouseEventHandler<HTMLButtonElement>;
  onCall?: React.MouseEventHandler<HTMLButtonElement>;
  singleClassName: string;
  splitClassName: string;
  chatClassName: string;
  callClassName: string;
};

export function ChatCallSplitButton({
  name,
  chatLabel = "Chat",
  callLabel = "Call agent",
  onChat,
  onCall,
  singleClassName,
  splitClassName,
  chatClassName,
  callClassName,
}: ChatCallSplitButtonProps) {
  if (onChat && onCall) {
    return (
      <div className={splitClassName} role="group" aria-label={`Chat and call ${name}`}>
        <button type="button" className={chatClassName} onClick={onChat} aria-label={`${chatLabel} with ${name}`}>
          <MessageSquare aria-hidden="true" />
          <span>{chatLabel}</span>
        </button>
        <button type="button" className={callClassName} onClick={onCall} aria-label={`Call ${name}`} title={`Call ${name}`}>
          <PhoneCall aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (onChat) {
    return (
      <button type="button" className={singleClassName} onClick={onChat} aria-label={`${chatLabel} with ${name}`}>
        <MessageSquare aria-hidden="true" />
        <span>{chatLabel}</span>
      </button>
    );
  }

  if (onCall) {
    return (
      <button type="button" className={singleClassName} onClick={onCall} aria-label={`Call ${name}`}>
        <PhoneCall aria-hidden="true" />
        <span>{callLabel}</span>
      </button>
    );
  }

  return null;
}
