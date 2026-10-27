"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Mail, MessageSquare, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import { useI18n } from "@/components/i18n-provider";

const big = "flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-[0.8rem] font-medium transition-colors active:scale-[0.98]";

// the message itself is for the customer, so it stays in English
const greeting = (firstName: string, company: string, url: string) =>
  `Hi ${firstName}! Here's your cleaning estimate from ${company}:\n\n${url}\n\nYou can review it and accept it right from the link. Any questions, just reply here.\n\nThank you!\n${company}`;

// Shows the message like a text bubble, with the link standing out.
function Bubble({ text, url }: { text: string; url: string }) {
  const [before, ...rest] = text.split(url);
  return (
    <div className="rounded-2xl rounded-bl-md bg-secondary px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
      {before}
      {rest.length > 0 && (
        <>
          <span className="font-mono text-[0.75rem] break-all text-link">{url}</span>
          {rest.join(url)}
        </>
      )}
    </div>
  );
}

// Sending the estimate: a text or an email with the link, or copy it. Using
// any of them marks a draft as sent. Made for thumbs first. The page keys
// this by the link, so a new estimate or a new link starts a fresh message.
export function SharePanel({ url, firstName, phone, email, markSent, company }: { url: string; firstName: string; phone: string | null; email: string | null; markSent: (via: string) => Promise<{ message?: string }>; company: string }) {
  const [message, setMessage] = useState(() => greeting(firstName, company, url));
  const [editing, setEditing] = useState(false);
  const { tr } = useI18n();
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  const smsDigits = phone?.replace(/[^\d+]/g, "") ?? "";
  // edits can't lose the link: it's added back at the end if removed
  const full = message.includes(url) ? message : `${message.trim()}\n\n${url}`;

  async function copy(what: "link" | "message") {
    await navigator.clipboard.writeText(what === "link" ? url : full).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
    markSent("copy");
  }

  return (
    <section className="grid gap-3 rounded-lg border p-4">
      <div>
        <h2 className="font-semibold">{tr("Send it")}</h2>
        <p className="text-[0.8rem] text-muted-foreground">{tr("They review and sign it online from the link.")}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <a href={smsDigits ? `sms:${smsDigits}?&body=${encodeURIComponent(full)}` : `sms:?&body=${encodeURIComponent(full)}`} onClick={() => markSent("text")} className={cn(big, "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}>
          <MessageSquare className="size-5" aria-hidden="true" />
          {tr("send|Text")}
        </a>
        <a href={`mailto:${email ?? ""}?subject=${encodeURIComponent(`Your estimate from ${company}`)}&body=${encodeURIComponent(full)}`} onClick={() => markSent("email")} className={cn(big, "hover:bg-secondary")}>
          <Mail className="size-5" aria-hidden="true" />
          {tr("Email")}
        </a>
        <button type="button" onClick={() => copy("link")} className={cn(big, copied === "link" ? "border-brand-green text-brand-green" : "hover:bg-secondary")}>
          {copied === "link" ? <Check className="size-5" aria-hidden="true" /> : <Copy className="size-5" aria-hidden="true" />}
          {copied === "link" ? tr("Copied") : tr("Copy link")}
        </button>
      </div>
      {(phone || email) && <p className="truncate text-[0.75rem] text-muted-foreground">{tr("To {who}", { who: [phone, email].filter(Boolean).join(" · ") })}</p>}

      <div className="grid gap-2 border-t pt-3">
        <p className="text-[0.75rem] font-medium tracking-wide text-muted-foreground uppercase">{tr("The message")}</p>
        {editing ? (
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={8} aria-label={tr("Message")} className="text-sm" autoFocus />
        ) : (
          <Bubble text={full} url={url} />
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => copy("message")}>
            {copied === "message" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied === "message" ? tr("Copied") : tr("Copy message")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
            {editing ? <Check aria-hidden="true" /> : <Pencil aria-hidden="true" />}
            {editing ? tr("Done") : tr("Edit")}
          </Button>
        </div>
      </div>
      <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 justify-self-start text-[0.8rem] text-link hover:underline">
        <ExternalLink className="size-3.5" aria-hidden="true" />
        {tr("Open as the customer sees it")}
      </a>
    </section>
  );
}
