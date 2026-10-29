import { router } from "expo-router";
import { View } from "react-native";
import { useVerifyFlow } from "@shubix/hooks";
import { AuthHeader, Button, ErrorBanner, Field, Input, LinkText, NoteBanner, Page } from "@shubix/ui-mobile";

/** The 6-digit code from the sign-up email (logic: @shubix/hooks useVerifyFlow, the same as the website). */
export function VerifyForm() {
  const f = useVerifyFlow(() => router.replace("/"));
  const { t: text } = f;
  return (
    <Page>
      <AuthHeader onClose={() => router.replace("/")} title={text("auth.verifyTitle")} subtitle={text("auth.codeSentTo", { email: f.email })} />
      <View className="mt-6 gap-4">
        <Field label={text("auth.codeLabel")}><Input value={f.code} onChangeText={(v) => f.setCode(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" /></Field>
        {f.error ? <ErrorBanner message={f.error} /> : null}
        {f.note ? <NoteBanner message={f.note} /> : null}
        <Button size="lg" full title={text("auth.verifyButton")} loading={f.busy} disabled={!/^\d{6}$/.test(f.code)} onPress={() => void f.verify()} />
        <LinkText className="self-center" title={`${text("auth.noCode")} ${text("auth.resendCode")}`} onPress={() => void f.resend()} />
      </View>
    </Page>
  );
}
