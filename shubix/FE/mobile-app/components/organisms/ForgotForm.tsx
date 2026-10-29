import { router } from "expo-router";
import { Mail } from "lucide-react-native";
import { View } from "react-native";
import { useForgotFlow } from "@shubix/hooks";
import { emailOk, passwordOk } from "@shubix/validations";
import { AuthHeader, Button, ErrorBanner, Field, Input, LinkText, Page, PasswordInput, colors } from "@shubix/ui-mobile";

/** Forgot password: email → 6-digit code + new password (logic: @shubix/hooks useForgotFlow, the same as the website). */
export function ForgotForm() {
  const f = useForgotFlow(() => router.replace("/"));
  const { t: text } = f, first = f.step === "email";
  return (
    <Page>
      <AuthHeader onClose={() => router.back()} title={text(first ? "auth.forgotTitle" : "auth.resetTitle")} subtitle={first ? text("auth.forgotCodeText") : text("auth.resetCodeSent", { email: f.email })} />
      <View className="mt-6 gap-4">
        {first ? (
          <Field label={text("auth.email")}><Input icon={<Mail size={17} color={colors.muted} />} value={f.email} onChangeText={f.setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder={text("auth.emailPlaceholder")} /></Field>
        ) : (
          <>
            <Field label={text("auth.codeLabel")}><Input value={f.code} onChangeText={(v) => f.setCode(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" /></Field>
            <Field label={text("auth.newPassword")} hint={text("auth.lengthHint")}><PasswordInput value={f.password} onChangeText={f.setPassword} autoComplete="new-password" placeholder={text("auth.newPasswordPlaceholder")} /></Field>
            <LinkText title={text("auth.otherEmail")} onPress={() => f.setStep("email")} />
          </>
        )}
        {f.error ? <ErrorBanner message={f.error} /> : null}
        <Button size="lg" full title={first ? (f.busy ? text("auth.sending") : text("auth.sendCode")) : (f.busy ? text("auth.saving") : text("auth.resetButton"))} loading={f.busy} disabled={first ? !emailOk(f.email) : !/^\d{6}$/.test(f.code) || !passwordOk(f.password)} onPress={() => void (first ? f.send() : f.reset())} />
      </View>
    </Page>
  );
}
