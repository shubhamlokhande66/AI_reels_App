import { useEffect } from "react";
import { router } from "expo-router";
import { Mail } from "lucide-react-native";
import { View } from "react-native";
import { useAuthForm } from "@shubix/hooks";
import { AuthHeader, Button, ErrorBanner, Field, Input, LinkText, Page, PasswordInput, Segmented, colors } from "@shubix/ui-mobile";

/** Sign in / create an account (logic: @shubix/hooks useAuthForm, the same as the website). */
export function SignInForm({ initial = "signin" }: { initial?: "signin" | "signup" }) {
  const f = useAuthForm((signedUp) => router.replace(signedUp ? "/verify" : "/"));
  const { t: text } = f;
  useEffect(() => { if (initial !== "signin") f.setMode(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Page>
      <AuthHeader onClose={() => router.back()} title={text(f.signin ? "auth.signIn" : "auth.signUp")} subtitle={text(f.signin ? "auth.signInSub" : "auth.signUpSub")} />
      <View className="mt-6"><Segmented full value={f.mode} onChange={f.setMode} options={[{ value: "signin", label: text("auth.signIn") }, { value: "signup", label: text("auth.createLink") }]} /></View>
      <View className="mt-5 gap-4">
        <Field label={text("auth.email")} error={f.errors.email}>
          <Input icon={<Mail size={17} color={colors.muted} />} value={f.email} onChangeText={f.setEmail} onBlur={() => f.touch("email")} invalid={!!f.errors.email}
            autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder={text("auth.emailPlaceholder")} />
        </Field>
        <Field label={text("auth.password")} error={f.errors.password} ok={f.ok.password} hint={f.signin ? undefined : text("auth.lengthHint")}>
          <PasswordInput value={f.password} onChangeText={f.setPassword} onBlur={() => f.touch("password")} invalid={!!f.errors.password}
            autoComplete={f.signin ? "password" : "new-password"} placeholder={text(f.signin ? "auth.passwordPlaceholder" : "auth.newPasswordPlaceholder")} showLabel={text("auth.showPassword")} hideLabel={text("auth.hidePassword")} />
        </Field>
        {!f.signin && (
          <Field label={text("auth.confirmPassword")} error={f.errors.again} ok={f.ok.again}>
            <PasswordInput value={f.again} onChangeText={f.setAgain} onBlur={() => f.touch("again")} invalid={!!f.errors.again} autoComplete="new-password" placeholder={text("auth.confirmPlaceholder")} />
          </Field>
        )}
        {f.error ? <ErrorBanner message={f.error} /> : null}
      </View>
      {f.signin && <LinkText className="mt-3 self-end" title={text("auth.forgotLink")} onPress={() => router.push("/forgot")} />}
      <View className="mt-6"><Button size="lg" full title={f.busy ? text("auth.wait") : text(f.signin ? "auth.signIn" : "auth.signUpButton")} loading={f.busy} disabled={!f.valid} onPress={() => void f.submit()} /></View>
      <LinkText className="mt-5 self-center" title={`${text(f.signin ? "auth.newHere" : "auth.haveAccount")} ${text(f.signin ? "auth.createLink" : "auth.signIn")}`} onPress={() => f.setMode(f.signin ? "signup" : "signin")} />
    </Page>
  );
}
