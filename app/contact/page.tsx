"use client";

import { useState } from "react";
import { Icon } from "@/components/atoms";
import { Hero } from "@/components/molecules";
import { siteOr, useSite } from "@/components/molecules/Legal";
import { useMe } from "@/hooks/useApi";

/** Contact us (design: "Contact"): email, WhatsApp, and a message that opens in your email app. */
export default function ContactPage() {
  const s = siteOr(useSite().data);
  const me = useMe();
  const [from, setFrom] = useState("");
  const [text, setText] = useState("");
  const email = from || me.data?.user?.email || "";
  const realEmail = !!s.email;
  const wa = s.phone.replace(/[^\d]/g, "");
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const body = `${text.trim()}\n\n— ${email}`;
    window.location.href = `mailto:${s.email}?subject=${encodeURIComponent("Help with Shubix")}&body=${encodeURIComponent(body)}`;
  };
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <Hero title="We're here to help" subtitle="Questions about a Reel, credits or your account." />
      {realEmail && (
        <a href={`mailto:${s.email}`} className="card" style={{ flexDirection: "row", alignItems: "center" }}>
          <span className="it b1" style={{ width: 38, height: 38 }}>
            <Icon name="mail" size={18} />
          </span>
          <span className="flex min-w-0 flex-col">
            <b>Email</b>
            <span className="mu sm truncate">{s.email}</span>
          </span>
        </a>
      )}
      {s.phone && (
        <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="card" style={{ flexDirection: "row", alignItems: "center" }}>
          <span className="it b6" style={{ width: 38, height: 38 }}>
            <Icon name="chat" size={18} />
          </span>
          <span className="flex min-w-0 flex-col">
            <b>WhatsApp</b>
            <span className="mu sm">{s.phone}</span>
          </span>
        </a>
      )}
      {realEmail && <form className="card" onSubmit={send} aria-label="Send us a message">
        <span className="h2">Send us a message</span>
        <label className="f">
          Your email
          <input type="email" required className="inp" placeholder="you@email.com" value={email} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="f">
          Message
          <textarea required className="ta" placeholder="How can we help?" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="submit" className="btn g" disabled={!text.trim()}>
          Send
        </button>
        <span className="mu xs">
          This opens your email app with the message ready. We reply within 3 working days.
        </span>
      </form>}
      {!realEmail && !s.phone && (
        <div className="card">
          <b>Support is being set up</b>
          <span className="mu sm">Our support email will be here very soon. Please check back in a little while.</span>
        </div>
      )}
      <p className="mu xs text-center">
        {s.name}
        {s.address ? ` · ${s.address}` : ""}
      </p>
    </div>
  );
}
