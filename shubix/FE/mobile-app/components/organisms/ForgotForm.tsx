import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { useForgotFlow } from "@shubix/hooks";
import { Button, ErrorBanner, Field, Icon, Input, OtpInput, PasswordInput } from "@shubix/ui-mobile";
import { emailOk, passwordOk } from "@shubix/validations";
import { AuthFrame } from "../templates/AuthFrame";

/** Forgot password (the website's app/forgot/page.tsx): the email, then the 6-digit code with a new password twice;
 * signed in at the end. Logic: @shubix/hooks useForgotFlow. */
export function ForgotForm() {
  const f = useForgotFlow(() => router.replace("/"));
  const { t: text } = f, first = f.step === "email", [touched, setTouched] = useState(false), [again, setAgain] = useState("");
  const emailErr = touched && f.email && !emailOk(f.email) ? text("auth.badEmail") : "";
  return (
    <AuthFrame title={text(first ? "auth.forgotTitle" : "auth.resetTitle")}>
      {first ? (
        <>
          <Text className="text-[12.5px] leading-[19px] text-muted">{text("auth.forgotCodeText")}</Text>
          <Field label={text("auth.email")} error={emailErr}>
            <Input icon={<Icon name="mail" size={17} color="muted" />} value={f.email} onChangeText={f.setEmail} onBlur={() => setTouched(true)} invalid={!!emailErr}
              autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder={text("auth.emailPlaceholder")} />
          </Field>
          {f.error ? <ErrorBanner message={f.error} /> : null}
          <Button full loading={f.busy} disabled={!emailOk(f.email)} title={f.busy ? text("auth.sending") : text("auth.sendCode")} onPress={() => void f.send()} />
        </>
      ) : (
        <>
          <Text className="text-[12.5px] leading-[19px] text-muted">{text("auth.resetCodeSent", { email: f.email.trim() })}</Text>
          <OtpInput label={text("auth.codeLabel")} value={f.code} onChange={f.setCode} invalid={!!f.error && !f.code} disabled={f.busy} />
          <Field label={text("auth.newPassword")} hint={text("auth.lengthHint")} error={f.password && !passwordOk(f.password) ? text("auth.shortPassword") : ""} ok={passwordOk(f.password) ? text("auth.strongEnough") : ""}>
            <PasswordInput value={f.password} onChangeText={f.setPassword} invalid={!!f.password && !passwordOk(f.password)} autoComplete="new-password" placeholder={text("auth.newPasswordPlaceholder")} />
          </Field>
          <Field label={text("auth.confirmPassword")} error={again && again !== f.password ? text("auth.mismatch") : ""} ok={again && again === f.password ? text("auth.match") : ""}>
            <PasswordInput value={again} onChangeText={setAgain} invalid={!!again && again !== f.password} autoComplete="new-password" placeholder={text("auth.confirmPlaceholder")} />
          </Field>
          {f.error ? <ErrorBanner message={f.error} /> : null}
          <Button full loading={f.busy} disabled={f.code.length !== 6 || !passwordOk(f.password) || again !== f.password} title={f.busy ? text("auth.saving") : text("auth.resetButton")} onPress={() => void f.reset()} />
          <Text className="text-center text-[12.5px] text-muted">{text("auth.noCode")}{" "}
            <Text onPress={() => void f.send()} className="font-bold text-accent">{text("auth.resendCode")}</Text>{" · "}
            <Text onPress={() => { f.setStep("email"); f.setCode(""); }} className="font-bold text-accent">{text("auth.otherEmail")}</Text>
          </Text>
          <Text className="text-center text-[11.5px] text-muted">{text("auth.checkSpam")}</Text>
        </>
      )}
    </AuthFrame>
  );
}
