import { router } from "expo-router";
import { Mail } from "lucide-react-native";
import { View } from "react-native";
import { useForgotFlow } from "@shubix/hooks";
import { AuthHeader, Button, colors, ErrorBanner, Field, Input, LinkText, Page, PasswordInput } from "@shubix/ui-mobile";

/** Forgot password: email → 6-digit code + new password (logic: @shubix/hooks useForgotFlow, the same as the website). */
export function ForgotForm() {
  const f = useForgotFlow(() => router.replace("/(tabs)"));
  const { t } = f, first = f.step === "email";
  return (
    <Page>
      <AuthHeader onClose={() => router.back()} title={t(first ? "auth.forgotTitle" : "auth.resetTitle")} subtitle={first ? t("auth.forgotCodeText") : t("auth.resetCodeSent", { email: f.email })} />
      <View className="mt-6 gap-4">
        {first ? (
          <Field label={t("auth.email")}><Input icon={<Mail size={17} color={colors.muted} />} value={f.email} onChangeText={f.setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder={t("auth.emailPlaceholder")} /></Field>
        ) : (
          <>
            <Field label={t("auth.codeLabel")}><Input value={f.code} onChangeText={(v) => f.setCode(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" /></Field>
            <Field label={t("auth.newPassword")} hint={t("auth.lengthHint")}><PasswordInput value={f.password} onChangeText={f.setPassword} autoComplete="new-password" placeholder={t("auth.newPasswordPlaceholder")} /></Field>
            <LinkText title={t("auth.otherEmail")} onPress={() => f.setStep("email")} />
          </>
        )}
        {f.error ? <ErrorBanner message={f.error} /> : null}
        <Button title={first ? (f.busy ? t("auth.sending") : t("auth.sendCode")) : (f.busy ? t("auth.saving") : t("auth.resetButton"))} loading={f.busy} onPress={() => void (first ? f.send() : f.reset())} />
      </View>
    </Page>
  );
}
