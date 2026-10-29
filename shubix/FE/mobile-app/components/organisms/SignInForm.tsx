import { useEffect } from "react";
import { router } from "expo-router";
import { Mail } from "lucide-react-native";
import { View } from "react-native";
import { useAuthForm } from "@shubix/hooks";
import { AuthHeader, Button, ErrorBanner, Field, Input, LinkText, Page, PasswordInput, Segmented, colors } from "@shubix/ui-mobile";

/** Sign in / create an account (logic: @shubix/hooks useAuthForm, the same as the website). */
export function SignInForm({ initial = "signin" }: { initial?: "signin" | "signup" }) {
  const f = useAuthForm((signedUp) => router.replace(signedUp ? "/auth/verify" : "/(tabs)"));
  const { t } = f;
  useEffect(() => { if (initial !== "signin") f.setMode(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Page>
      <AuthHeader onClose={() => router.back()} title={t(f.signin ? "auth.signIn" : "auth.signUp")} subtitle={t(f.signin ? "auth.signInSub" : "auth.signUpSub")} />
      <View className="mt-6"><Segmented full value={f.mode} onChange={f.setMode} options={[{ value: "signin", label: t("auth.signIn") }, { value: "signup", label: t("auth.createLink") }]} /></View>
      <View className="mt-5 gap-4">
        <Field label={t("auth.email")} error={f.errors.email}>
          <Input icon={<Mail size={17} color={colors.muted} />} value={f.email} onChangeText={f.setEmail} onBlur={() => f.touch("email")} invalid={!!f.errors.email}
            autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder={t("auth.emailPlaceholder")} />
        </Field>
        <Field label={t("auth.password")} error={f.errors.password} ok={f.ok.password} hint={f.signin ? undefined : t("auth.lengthHint")}>
          <PasswordInput value={f.password} onChangeText={f.setPassword} onBlur={() => f.touch("password")} invalid={!!f.errors.password}
            autoComplete={f.signin ? "password" : "new-password"} placeholder={t(f.signin ? "auth.passwordPlaceholder" : "auth.newPasswordPlaceholder")} showLabel={t("auth.showPassword")} hideLabel={t("auth.hidePassword")} />
        </Field>
        {!f.signin && (
          <Field label={t("auth.confirmPassword")} error={f.errors.again} ok={f.ok.again}>
            <PasswordInput value={f.again} onChangeText={f.setAgain} onBlur={() => f.touch("again")} invalid={!!f.errors.again} autoComplete="new-password" placeholder={t("auth.confirmPlaceholder")} />
          </Field>
        )}
        {f.error ? <ErrorBanner message={f.error} /> : null}
      </View>
      {f.signin && <LinkText className="mt-3 self-end" title={t("auth.forgotLink")} onPress={() => router.push("/auth/forgot")} />}
      <View className="mt-6"><Button size="lg" full title={f.busy ? t("auth.wait") : t(f.signin ? "auth.signIn" : "auth.signUpButton")} loading={f.busy} disabled={!f.valid} onPress={() => void f.submit()} /></View>
      <LinkText className="mt-5 self-center" title={`${t(f.signin ? "auth.newHere" : "auth.haveAccount")} ${t(f.signin ? "auth.createLink" : "auth.signIn")}`} onPress={() => f.setMode(f.signin ? "signup" : "signin")} />
    </Page>
  );
}
