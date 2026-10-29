import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { errorMessage, type ApiClient } from "@shubix/api-client";
import type { MeResponse } from "@shubix/types";
import { emailOk, passwordOk } from "@shubix/validations";
import { fill, TEXT_DEFAULTS } from "@shubix/core/lib/texts";

/** The logic both apps share (FE/web-app and FE/mobile-app). Only React, no DOM or React Native: the sign-in rules,
 * messages and flow exist once; each app only draws them with its own atoms/molecules. */
type Ctx = { api: ApiClient; texts: Record<string, string>; me: MeResponse | null; refresh: () => Promise<void> };
const ApiContext = createContext<Ctx | null>(null);

export function ApiProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [me, setMe] = useState<MeResponse | null>(null);
  const refresh = useCallback(async () => { setMe(await api.auth.me().catch(() => ({ authEnabled: true, user: null }))); }, [api]);
  useEffect(() => { api.texts().then(setTexts).catch(() => {}); void refresh(); }, [api, refresh]);
  return <ApiContext.Provider value={{ api, texts, me, refresh }}>{children}</ApiContext.Provider>;
}
export function useApi(): Ctx {
  const c = useContext(ApiContext);
  if (!c) throw new Error("useApi needs <ApiProvider>");
  return c;
}
/** Every text the person sees: the admin's (Admin → CMS) or the website's default (Shared/core/src/lib/texts.ts). */
export function useText() {
  const { texts } = useApi();
  return useCallback((key: string, vars?: Record<string, string | number>) => fill(texts[key] ?? TEXT_DEFAULTS[key] ?? key, vars), [texts]);
}

/** Sign in / create an account: fields, messages as people type, submit. `onDone(signedUp)` decides where to go. */
export function useAuthForm(onDone: (signedUp: boolean) => void) {
  const { api, refresh } = useApi(), text = useText();
  const [mode, setModeRaw] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [again, setAgain] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const signin = mode === "signin";
  const errors = {
    email: touched.email && email && !emailOk(email) ? text("auth.badEmail") : "",
    password: touched.password && !signin && password && !passwordOk(password) ? text("auth.shortPassword") : "",
    again: !signin && again && again.length >= password.length && again !== password ? text("auth.mismatch") : "",
  };
  const ok = { password: !signin && passwordOk(password) ? text("auth.strongEnough") : "", again: again && again === password ? text("auth.match") : "" };
  const valid = emailOk(email) && (signin ? !!password : passwordOk(password) && again === password);
  const setMode = (m: "signin" | "signup") => { setModeRaw(m); setError(null); setAgain(""); setTouched({}); };
  const touch = (k: "email" | "password" | "again") => setTouched((x) => ({ ...x, [k]: true }));
  async function submit() {
    setError(null); setTouched({ email: true, password: true, again: true });
    if (!valid) return;
    setBusy(true);
    try {
      if (signin) await api.auth.login(email.trim(), password); else await api.auth.register(email.trim(), password);
      await refresh();
      onDone(!signin);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return { mode, setMode, signin, email, setEmail, password, setPassword, again, setAgain, touch, errors, ok, valid, error, busy, submit, t: text };
}

/** Forgot password: the email, then the code + a new password (signed in at the end, every other session ends). */
export function useForgotFlow(onDone: () => void) {
  const { api, refresh } = useApi(), text = useText();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(""), [code, setCode] = useState(""), [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setError(null); setBusy(true); try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  const send = () => (emailOk(email) ? run(async () => { await api.auth.forgot(email.trim()); setStep("code"); }) : setError(text("auth.badEmail")));
  const reset = () => {
    if (!/^\d{6}$/.test(code.trim())) return setError(text("auth.enterSixDigits"));
    if (!passwordOk(password)) return setError(text("auth.shortPassword"));
    return run(async () => { await api.auth.reset(email.trim(), code.trim(), password); await refresh(); onDone(); });
  };
  return { step, setStep, email, setEmail, code, setCode, password, setPassword, error, busy, send, reset, t: text };
}

/** Verify the email with the 6-digit code from the sign-up email. */
export function useVerifyFlow(onDone: () => void) {
  const { api, me, refresh } = useApi(), text = useText();
  const [code, setCode] = useState(""), [error, setError] = useState<string | null>(null), [note, setNote] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const verify = async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError(text("auth.enterSixDigits"));
    setError(null); setBusy(true);
    try { await api.auth.verify(code.trim()); await refresh(); onDone(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const resend = async () => { setError(null); try { await api.auth.resendVerify(); setNote(text("auth.codeResent")); } catch (e) { setError(errorMessage(e)); } };
  return { email: me?.user?.email ?? "", code, setCode, error, note, busy, verify, resend, t: text };
}

/** Sign out on this device. */
export function useSignOut(onDone: () => void) {
  const { api, refresh } = useApi();
  return async () => { await api.auth.logout().catch(() => {}); await refresh(); onDone(); };
}
