"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { StoreBadges } from "@/components/molecules/StoreBadges";
import { api, errorMessage } from "@/lib/api";
import { emailOk, passwordOk } from "@/lib/validate";
import { clearRef, savedRef } from "@/lib/marketing";
import { useT } from "@/hooks/useApi";
import { Button, Card, Eyebrow, Icon, Input, Logo } from "@/components/atoms";
import { ErrorBanner, Field, PasswordInput } from "@/components/molecules";
import { LegalFooter } from "@/components/molecules/Legal";

/** Sign in, or create an account (accounts on: AUTH_ENABLED on the server). Each field says what is wrong as people
 * type (after they leave it); the button waits until the form is right. */
export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useT();
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
  const emailErr = email && !emailOk(email) ? t("auth.badEmail") : "";
  const pwErr = !signin && password && !passwordOk(password) ? t("auth.shortPassword") : "";
  const againErr = !signin && again && again !== password ? t("auth.mismatch") : "";
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
      router.replace(!signin ? "/verify?sent=1" : "adminCode" in r && r.adminCode ? "/admin?code=sent" : "/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell min-h-svh overflow-hidden bg-background text-foreground">
      <div className="mx-auto grid min-h-svh w-full max-w-[1600px] lg:grid-cols-[1.02fr_.98fr]">
        <section className="auth-stage relative flex min-h-[260px] flex-col overflow-hidden px-5 pb-8 pt-[max(20px,env(safe-area-inset-top))] sm:min-h-[310px] sm:px-9 sm:pb-11 lg:sticky lg:top-0 lg:h-svh lg:min-h-[680px] lg:px-12 lg:pb-12 lg:pt-10 xl:px-16" aria-label={t("nav.music")}>
          <span className="auth-stage-glow auth-glow-one" aria-hidden />
          <span className="auth-stage-glow auth-glow-two" aria-hidden />
          <div className="relative z-10 flex items-center justify-between gap-3">
            <Logo height={44} />
            <span className="auth-live-pill"><i />{t("nav.music")}</span>
          </div>

          <div className="auth-stage-body relative z-10 mt-5 flex flex-1 items-center justify-between gap-4 sm:mt-10 lg:my-auto lg:flex-col lg:items-start lg:justify-center lg:gap-10 xl:flex-row xl:items-center">
            <div className="auth-stage-copy min-w-0 flex-1 lg:max-w-[540px]">
              <Eyebrow className="auth-eyebrow flex items-center gap-2"><Icon name="sparkle" size={13} />{t("nav.create")}</Eyebrow>
              <h2 className="mt-3 max-w-[590px] font-[family-name:var(--font-display)] text-[clamp(28px,7vw,44px)] font-semibold leading-[1.02] tracking-[-0.045em] sm:mt-4 sm:text-[clamp(34px,5vw,54px)] lg:mt-6 lg:text-[clamp(42px,5vw,72px)]">
                {t("home.hero1")}<br /><span className="auth-gold-text">{t("home.hero2")}</span><br />{t("home.hero3")}
              </h2>
              <p className="mt-3 max-w-[45ch] text-[13px] leading-relaxed text-white/68 sm:mt-4 sm:text-[14px] lg:text-[15px]">{t("home.heroText")}</p>
              <div className="mt-5 hidden flex-wrap gap-2.5 text-[11px] font-semibold text-white/70 sm:flex lg:mt-7">
                <span className="auth-feature"><Icon name="music" size={14} />{t("nav.music")}</span>
                <span className="auth-feature"><Icon name="reels" size={14} />{t("nav.reels")}</span>
                <span className="auth-feature"><Icon name="sparkle" size={14} />{t("nav.create")}</span>
              </div>
            </div>

            <div className="auth-sound-card relative hidden shrink-0 sm:block lg:w-full lg:max-w-[470px] xl:w-[250px] xl:rotate-[4deg]">
              <div className="auth-sound-top flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2"><i className="auth-record-icon"><Icon name="music" size={15} /></i><span className="min-w-0"><b className="block truncate text-[11px] text-white">{t("nav.music")}</b><small className="text-[10px] text-white/45">SHUBIX · REEL STUDIO</small></span></span>
                <span className="auth-eq-mark" aria-hidden><i /><i /><i /><i /></span>
              </div>
              <div className="auth-artwork relative mt-3 overflow-hidden rounded-xl">
                <span className="auth-art-sun" aria-hidden />
                <span className="auth-art-horizon" aria-hidden />
                <div className="auth-art-copy"><small>MADE TO MOVE</small><b>{t("home.hero2")}</b></div>
              </div>
              <div className="auth-waveform" aria-hidden>{bars.map((h, i) => <i key={i} style={{ height: h + "%", animationDelay: ((i % 9) * -0.13) + "s" }} />)}</div>
              <div className="mt-2 flex items-center justify-between text-[9px] font-mono uppercase tracking-[.12em] text-white/45"><span>00:00</span><span className="text-accent">BEAT MATCH</span><span>00:24</span></div>
            </div>
          </div>

          <div className="relative z-10 mt-6 hidden items-center justify-between border-t border-white/10 pt-4 text-[10px] font-semibold uppercase tracking-[.16em] text-white/35 lg:flex">
            <span>SHUBIX · REELS VIDEO STUDIO</span><span>CREATE IN YOUR OWN RHYTHM</span>
          </div>
          <div className="auth-mini-wave sm:hidden" aria-hidden>{bars.slice(0, 28).map((h, i) => <i key={i} style={{ height: h + "%", animationDelay: ((i % 9) * -0.13) + "s" }} />)}</div>
        </section>

        <section className="auth-main relative -mt-5 flex min-h-[calc(100svh-260px)] flex-col justify-center rounded-t-[26px] border-t border-border bg-background px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-7 sm:px-8 lg:mt-0 lg:min-h-svh lg:rounded-none lg:border-0 lg:px-10 lg:py-12 xl:px-16">
          <div className="auth-form-wrap mx-auto w-full max-w-[440px]">
            <div className="mb-5 flex items-center justify-between gap-3 sm:mb-6">
              <div className="min-w-0"><Eyebrow className="auth-form-eyebrow">SHUBIX ACCOUNT</Eyebrow><p className="mt-1 text-[12px] text-muted">{t("auth.signIn")} · {t("auth.signUp")}</p></div>
              <span className="auth-secure"><Icon name="shield" size={13} />PRIVATE &amp; SECURE</span>
            </div>

            <div role="group" aria-label={t("auth.signIn")} className="auth-mode-switch mb-3 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1">
              <button type="button" aria-pressed={signin} onClick={() => changeMode("signin")} className={signin ? "auth-mode-tab is-active" : "auth-mode-tab"}>{t("auth.signIn")}</button>
              <button type="button" aria-pressed={!signin} onClick={() => changeMode("signup")} className={!signin ? "auth-mode-tab is-active" : "auth-mode-tab"}>{t("auth.createLink")}</button>
            </div>

            <Card key={mode} className="auth-form-card relative flex flex-col gap-4 overflow-hidden p-5 sm:gap-6 sm:p-7 lg:p-8">
              <div className="auth-card-light" aria-hidden />
              <div className="relative z-10">
                <h1 className="m-0 font-[family-name:var(--font-display)] text-[25px] font-semibold tracking-[-0.035em] sm:text-[28px]">{t(signin ? "auth.signIn" : "auth.signUp")}</h1>
                <p className="m-0 mt-1.5 text-[12.5px] leading-relaxed text-muted sm:text-[13px]">{t(signin ? "auth.signInSub" : "auth.signUpSub")}</p>
              </div>
              <form onSubmit={submit} noValidate className="relative z-10 flex flex-col gap-3 sm:gap-[18px]">
                <Field label={t("auth.email")} error={touched.email ? emailErr : ""}>
                  <Input type="email" autoComplete="email" placeholder={t("auth.emailPlaceholder")} value={email} aria-invalid={!!(touched.email && emailErr) || undefined}
                    className={touched.email && emailErr ? "border-danger" : undefined} onChange={(e) => setEmail(e.target.value)} onBlur={() => touch("email")} />
                </Field>
                <Field label={t("auth.password")}
                  error={touched.password ? pwErr : ""}
                  ok={!signin && passwordOk(password) ? t("auth.strongEnough") : ""}
                  hint={!signin ? t("auth.lengthHint") : undefined}>
                  <PasswordInput autoComplete={signin ? "current-password" : "new-password"} placeholder={t(signin ? "auth.passwordPlaceholder" : "auth.newPasswordPlaceholder")}
                    value={password} invalid={!!(touched.password && pwErr)} onChange={(e) => setPassword(e.target.value)} onBlur={() => touch("password")} />
                </Field>
                {!signin && (
                  <Field label={t("auth.confirmPassword")} error={touched.again || (again.length >= password.length && password) ? againErr : ""} ok={again && again === password ? t("auth.match") : ""}>
                    <PasswordInput autoComplete="new-password" placeholder={t("auth.confirmPlaceholder")} value={again} invalid={!!(touched.again && againErr)} onChange={(e) => setAgain(e.target.value)} onBlur={() => touch("again")} />
                  </Field>
                )}
                {error && <ErrorBanner message={error} />}
                <Button type="submit" size="lg" icon="sparkle" loading={busy} disabled={!valid} className="auth-submit mt-1 !h-12 w-full !rounded-xl !text-[13.5px]">
                  {busy ? t("auth.wait") : t(signin ? "auth.signIn" : "auth.signUpButton")}
                </Button>
              </form>
              <div className="relative z-10 flex min-h-5 flex-col items-center gap-2 pr-12 text-center text-[12px] sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pr-0 sm:text-left">
                <span className="text-muted">{t(signin ? "auth.newHere" : "auth.haveAccount")} <button type="button" className="font-bold text-accent hover:underline" onClick={() => changeMode(signin ? "signup" : "signin")}>{t(signin ? "auth.createLink" : "auth.signIn")}</button></span>
                {signin && <Link href="/forgot" className="shrink-0 font-bold text-accent hover:underline">{t("auth.forgotLink")}</Link>}
              </div>
            </Card>

            <Link href={emailOk(email) ? "/affiliate?email=" + encodeURIComponent(email.trim()) : "/affiliate"} className="mt-4 block text-center text-[12px] font-semibold text-muted transition-colors hover:text-foreground">
              {t("auth.partnerLink")}
            </Link>
            <div className="mt-4 flex justify-center"><StoreBadges compact className="w-full max-w-[340px]" /></div>
          </div>
          <LegalFooter className="mx-auto mt-6 w-full max-w-[440px] border-t border-border/70 pt-3 lg:mt-8" />
        </section>
      </div>
    </main>
  );
}
