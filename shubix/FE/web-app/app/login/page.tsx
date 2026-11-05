"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { StoreBadges } from "@/components/molecules/StoreBadges";
import { api, errorMessage } from "@/lib/api";
import { emailOk, passwordOk } from "@/lib/validate";
import { clearRef, savedRef } from "@/lib/marketing";
import { useText } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { Button, Card, Eyebrow, Icon, Input, Logo } from "@/components/atoms";
import { ErrorBanner, Field, PasswordInput, SoundBars } from "@/components/molecules";
import { LegalFooter } from "@/components/molecules/Legal";

// the page's repeated shapes: a frosted pill, a soft glow, the two sign-in / sign-up tabs
const PILL = "inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border";
const FROSTED = `${PILL} border-white/12 bg-white/[.045] text-white/72`;
const GLOW = "pointer-events-none absolute -z-1 aspect-square w-[270px] animate-drift rounded-full blur-[60px] motion-reduce:animate-none";
const TAB = "min-h-10 rounded-[9px] border-0 bg-transparent text-[12px] font-bold text-muted transition-[color,background-color,box-shadow,scale] duration-200 hover:text-foreground active:scale-[.985] motion-reduce:transition-none";
const TAB_ON = "bg-gold text-on-accent shadow-[0_5px_14px_-9px_var(--brand-glow),inset_0_1px_0_rgba(255,255,255,.28)] hover:text-on-accent";
const EQ = [[8, 0], [16, -0.3], [11, -0.5], [6, -0.2]];

/** Sign in, or create an account (accounts on: AUTH_ENABLED on the server). Each field says what is wrong as people
 * type (after they leave it); the button waits until the form is right. */
export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const text = useText();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState(""); // creating an account: the password a second time
  const [touched, setTouched] = useState<Record<string, boolean>>({}); // the fields left once: their message shows
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signin = mode === "signin";
  const touch = (k: string) => setTouched((x) => ({ ...x, [k]: true }));

  // what is wrong with each field (shown once the field was left, or the form sent)
  const emailErr = email && !emailOk(email) ? text("auth.badEmail") : "";
  const pwErr = !signin && password && !passwordOk(password) ? text("auth.shortPassword") : "";
  const againErr = !signin && again && again !== password ? text("auth.mismatch") : "";
  const valid = emailOk(email) && (signin ? !!password : passwordOk(password) && again === password);
  const bars = [12, 20, 30, 17, 34, 23, 13, 27, 38, 20, 31, 15, 26, 36, 18, 29, 12, 23, 34, 16, 28, 38, 19, 11, 27, 35, 17, 25, 13, 32, 20, 37, 16, 28, 12, 22];

  function changeMode(next: "signin" | "signup") {
    setMode(next);
    setError(null);
    setAgain("");
    setTouched({});
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setTouched({ email: true, password: true, again: true });
    if (!valid) return;
    setBusy(true);
    try {
      const r = signin ? await api.login(email.trim(), password) : await api.register(email.trim(), password, savedRef());
      if (!signin) clearRef(); // the invite is used
      await qc.invalidateQueries();
      // a new account: the code from the email first; an administrator: the admin code (emailed now) first
      router.replace(!signin || r.user?.emailVerified === false ? "/verify?sent=1" : "adminCode" in r && r.adminCode ? "/admin?code=sent" : "/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="isolate min-h-svh overflow-hidden bg-background bg-[image:radial-gradient(950px_520px_at_90%_-20%,color-mix(in_srgb,var(--accent)_10%,transparent),transparent_68%)] text-foreground">
      <div className="mx-auto grid min-h-svh w-full max-w-[1600px] lg:grid-cols-[1.02fr_.98fr]">
        <section className="before:pointer-events-none before:absolute before:-top-[44%] before:-right-[34%] before:-z-1 before:aspect-square before:w-[min(80vw,720px)] before:rounded-full before:border before:border-[rgba(240,217,155,.09)] before:shadow-[0_0_0_28px_rgba(240,217,155,.018),0_0_0_64px_rgba(240,217,155,.014),0_0_100px_rgba(216,189,123,.08)] before:content-[''] after:pointer-events-none after:absolute after:-bottom-[48%] after:-left-1/4 after:-z-1 after:aspect-square after:w-[min(50vw,420px)] after:rounded-full after:bg-[radial-gradient(circle,rgba(216,189,123,.13),transparent_70%)] after:blur-[5px] after:content-[''] isolate relative flex bg-[linear-gradient(142deg,#111110_0%,#171613_57%,#252117_100%)] text-[#f4f0e7] min-h-[260px] flex-col overflow-hidden px-5 pb-8 pt-[max(20px,env(safe-area-inset-top))] sm:min-h-[310px] sm:px-9 sm:pb-11 lg:sticky lg:top-0 lg:h-svh lg:min-h-[680px] lg:px-12 lg:pb-12 lg:pt-10 xl:px-16" aria-label={text("nav.music")}>
          <span className={cn(GLOW, "top-[24%] right-[16%] bg-[rgba(185,150,77,.16)]")} aria-hidden />
          <span className={cn(GLOW, "bottom-[7%] left-[12%] bg-[rgba(116,94,51,.12)] [animation-delay:-4s]")} aria-hidden />
          <div className="relative z-10 flex items-center justify-between gap-3">
            <Logo height={44} />
            <span className={cn(FROSTED, "px-[11px] py-[7px] text-[10px] font-bold uppercase tracking-[.1em]")}><i className="size-1.5 rounded-full bg-[#d8bd7b] shadow-[0_0_12px_rgba(216,189,123,.8)]" />{text("nav.music")}</span>
          </div>

          <div className="relative z-10 mt-5 flex flex-1 items-center justify-between gap-4 sm:mt-10 lg:my-auto lg:flex-col lg:items-start lg:justify-center lg:gap-10">
            <div className="min-w-0 flex-1 lg:max-w-[540px]">
              <Eyebrow className="flex items-center gap-2 text-[#d8bd7b]"><Icon name="sparkle" size={13} />{text("nav.create")}</Eyebrow>
              <h2 className="mt-3 max-w-[590px] font-[family-name:var(--font-display)] text-[clamp(28px,7vw,44px)] font-semibold leading-[1.02] tracking-[-0.045em] sm:mt-4 sm:text-[clamp(34px,5vw,54px)] lg:mt-6 lg:text-[clamp(42px,5vw,72px)]">
                {text("home.hero1")}<br /><span className="text-[#dfc47e] [text-shadow:0_8px_32px_rgba(216,189,123,.14)]">{text("home.hero2")}</span><br />{text("home.hero3")}
              </h2>
              <p className="mt-3 max-w-[45ch] text-[13px] leading-relaxed text-white/68 sm:mt-4 sm:text-[14px] lg:text-[15px]">{text("home.heroText")}</p>
              <div className="mt-5 hidden flex-wrap gap-2.5 text-[11px] font-semibold text-white/70 sm:flex lg:mt-7">
                <span className={cn(FROSTED, "px-2.5 py-[7px] tracking-[.02em]")}><Icon name="music" size={14} />{text("nav.music")}</span>
                <span className={cn(FROSTED, "px-2.5 py-[7px] tracking-[.02em]")}><Icon name="reels" size={14} />{text("nav.reels")}</span>
                <span className={cn(FROSTED, "px-2.5 py-[7px] tracking-[.02em]")}><Icon name="sparkle" size={14} />{text("nav.create")}</span>
              </div>
            </div>

            <div className="relative hidden w-[min(38%,270px)] shrink-0 animate-[enter_.8s_.12s_both_cubic-bezier(.2,.7,.25,1)] rounded-[18px] border border-white/13 bg-[linear-gradient(145deg,rgba(255,255,255,.09),rgba(255,255,255,.035))] p-3.5 shadow-[0_30px_80px_-44px_rgba(0,0,0,.95),inset_0_1px_0_rgba(255,255,255,.06)] backdrop-blur-[18px] motion-reduce:animate-none sm:block lg:w-[min(100%,470px)] xl:rotate-[4deg]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2"><i className="grid size-8 flex-none place-items-center rounded-[10px] border border-[rgba(240,217,155,.27)] bg-[rgba(216,189,123,.12)] text-[#e5ca83]"><Icon name="music" size={15} /></i><span className="min-w-0"><b className="block truncate text-[11px] text-white">{text("nav.music")}</b><small className="text-[10px] text-white/45">SHUBIX · REEL STUDIO</small></span></span>
                <span className="flex h-5 items-center gap-[3px]" aria-hidden>{EQ.map(([h, d]) => <i key={h} className="w-[3px] animate-[wave_.8s_ease-in-out_infinite_alternate] rounded-full bg-[#d8bd7b] motion-reduce:animate-none" style={{ height: h, animationDelay: d + "s" }} />)}</span>
              </div>
              <div className="relative mt-3 h-[clamp(112px,16vw,168px)] overflow-hidden rounded-xl bg-[linear-gradient(160deg,#806541_0%,#473b2b_43%,#1b1a17_100%)] lg:h-[clamp(150px,22vh,220px)]">
                <span className="absolute top-[13%] left-[58%] aspect-square w-[28%] animate-breathe rounded-full bg-[radial-gradient(circle_at_35%_35%,#ffe9b3,#d3ae65_76%)] shadow-[0_0_50px_16px_rgba(230,196,124,.22)] motion-reduce:animate-none" aria-hidden />
                <span className="absolute inset-x-[-5%] top-[34%] bottom-[-20%] bg-[linear-gradient(180deg,rgba(29,27,23,.18),#111110_72%)] [clip-path:polygon(0_56%,18%_22%,38%_57%,59%_14%,78%_47%,100%_18%,100%_100%,0_100%)]" aria-hidden />
                <div className="absolute inset-x-3.5 bottom-3 grid gap-0.5 text-white [text-shadow:0_2px_14px_rgba(0,0,0,.55)]"><small className="text-[10px] font-extrabold tracking-[.18em] text-white/65">MADE TO MOVE</small><b className="text-[clamp(16px,2vw,22px)] font-[650] tracking-[-.04em]">{text("home.hero2")}</b></div>
              </div>
              <SoundBars bars={bars} unit="%" step={-0.13} speed="animate-[wave_.9s_ease-in-out_infinite_alternate]" barClassName="max-w-[5px]" className="mt-3 h-[26px] gap-[3px]" />
              <div className="mt-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-[.12em] text-white/45"><span>00:00</span><span className="text-accent">BEAT MATCH</span><span>00:24</span></div>
            </div>
          </div>

          <div className="relative z-10 mt-6 hidden items-center justify-between border-t border-white/10 pt-4 text-[10px] font-semibold uppercase tracking-[.16em] text-white/35 lg:flex">
            <span>SHUBIX · REELS VIDEO STUDIO</span><span>CREATE IN YOUR OWN RHYTHM</span>
          </div>
          <SoundBars bars={bars.slice(0, 28)} unit="%" step={-0.13} speed="animate-[wave_.9s_ease-in-out_infinite_alternate]" barClassName="max-w-[5px]" className="absolute right-5 bottom-6 z-1 h-5 w-[118px] gap-[3px] opacity-[.66] sm:hidden" />
        </section>

        <section className="isolate relative -mt-5 flex min-h-[calc(100svh-260px)] flex-col justify-center rounded-t-[26px] border-t border-border bg-background px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-7 sm:px-8 lg:mt-0 lg:min-h-svh lg:rounded-none lg:border-0 lg:px-10 lg:py-12 xl:px-16">
          <div className="mx-auto w-full max-w-[440px] animate-[enter_.55s_.05s_both_cubic-bezier(.2,.7,.25,1)] motion-reduce:animate-none">
            <div className="mb-5 flex items-center justify-between gap-3 sm:mb-6">
              <div className="min-w-0"><Eyebrow className="text-[10px] text-accent">SHUBIX ACCOUNT</Eyebrow><p className="mt-1 text-[12px] text-muted">{text("auth.signIn")} · {text("auth.signUp")}</p></div>
              <span className={cn(PILL, "border-border bg-surface px-[9px] py-1.5 text-[10px] font-bold tracking-[.08em] text-muted")}><Icon name="shield" size={13} />PRIVATE &amp; SECURE</span>
            </div>

            <div role="group" aria-label={text("auth.signIn")} className="mb-3 shadow-[0_8px_24px_-20px_rgba(0,0,0,.35)] grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1">
              <button type="button" aria-pressed={signin} onClick={() => changeMode("signin")} className={cn(TAB, signin && TAB_ON)}>{text("auth.signIn")}</button>
              <button type="button" aria-pressed={!signin} onClick={() => changeMode("signup")} className={cn(TAB, !signin && TAB_ON)}>{text("auth.createLink")}</button>
            </div>

            <Card key={mode} className="relative rounded-[22px] bg-[color:color-mix(in_srgb,var(--surface)_96%,var(--accent))] shadow-[0_24px_60px_-38px_rgba(0,0,0,.36),inset_0_1px_0_rgba(255,255,255,.45)] flex flex-col gap-4 overflow-hidden p-5 sm:gap-6 sm:p-7 lg:p-8">
              <div className="pointer-events-none absolute -top-[90px] -right-[70px] z-0 size-[210px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--accent)_13%,transparent),transparent_70%)]" aria-hidden />
              <div className="relative z-10">
                <h1 className="m-0 font-[family-name:var(--font-display)] text-[25px] font-semibold tracking-[-0.035em] sm:text-[28px]">{text(signin ? "auth.signIn" : "auth.signUp")}</h1>
                <p className="m-0 mt-1.5 text-[12.5px] leading-relaxed text-muted sm:text-[13px]">{text(signin ? "auth.signInSub" : "auth.signUpSub")}</p>
              </div>
              <form onSubmit={submit} noValidate className="relative z-10 flex flex-col gap-3 sm:gap-[18px]">
                <Field label={text("auth.email")} error={touched.email ? emailErr : ""}>
                  <Input type="email" autoComplete="email" placeholder={text("auth.emailPlaceholder")} value={email} aria-invalid={!!(touched.email && emailErr) || undefined}
                    className={touched.email && emailErr ? "border-danger" : undefined} onChange={(e) => setEmail(e.target.value)} onBlur={() => touch("email")} />
                </Field>
                <Field label={text("auth.password")}
                  error={touched.password ? pwErr : ""}
                  ok={!signin && passwordOk(password) ? text("auth.strongEnough") : ""}
                  hint={!signin ? text("auth.lengthHint") : undefined}>
                  <PasswordInput autoComplete={signin ? "current-password" : "new-password"} placeholder={text(signin ? "auth.passwordPlaceholder" : "auth.newPasswordPlaceholder")}
                    value={password} invalid={!!(touched.password && pwErr)} onChange={(e) => setPassword(e.target.value)} onBlur={() => touch("password")} />
                </Field>
                {!signin && (
                  <Field label={text("auth.confirmPassword")} error={touched.again || (again.length >= password.length && password) ? againErr : ""} ok={again && again === password ? text("auth.match") : ""}>
                    <PasswordInput autoComplete="new-password" placeholder={text("auth.confirmPlaceholder")} value={again} invalid={!!(touched.again && againErr)} onChange={(e) => setAgain(e.target.value)} onBlur={() => touch("again")} />
                  </Field>
                )}
                {error && <ErrorBanner message={error} />}
                <Button type="submit" size="lg" icon="sparkle" loading={busy} disabled={!valid} className="mt-1 !shadow-[0_14px_26px_-16px_var(--brand-glow),inset_0_1px_0_rgba(255,255,255,.26)] !h-12 w-full !rounded-xl !text-[13.5px]">
                  {busy ? text("auth.wait") : text(signin ? "auth.signIn" : "auth.signUpButton")}
                </Button>
              </form>
              <div className="relative z-10 flex min-h-5 flex-col items-center gap-2 pr-12 text-center text-[12px] sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pr-0 sm:text-left">
                <span className="text-muted">{text(signin ? "auth.newHere" : "auth.haveAccount")} <button type="button" className="font-bold text-accent hover:underline" onClick={() => changeMode(signin ? "signup" : "signin")}>{text(signin ? "auth.createLink" : "auth.signIn")}</button></span>
                {signin && <Link href="/forgot" className="shrink-0 font-bold text-accent hover:underline">{text("auth.forgotLink")}</Link>}
              </div>
            </Card>

            <Link href={emailOk(email) ? "/affiliate?email=" + encodeURIComponent(email.trim()) : "/affiliate"} className="mt-4 block text-center text-[12px] font-semibold text-muted transition-colors hover:text-foreground">
              {text("auth.partnerLink")}
            </Link>
            <div className="mt-4 flex justify-center"><StoreBadges compact className="w-full max-w-[340px]" /></div>
          </div>
          <LegalFooter compact className="mx-auto mt-6 w-full max-w-[440px] border-t border-border/70 pt-3 lg:mt-8" />
        </section>
      </div>
    </main>
  );
}
