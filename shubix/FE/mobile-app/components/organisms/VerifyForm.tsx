import { router } from "expo-router";
import { View } from "react-native";
import { useVerifyFlow } from "@shubix/hooks";
import { AuthHeader, Button, ErrorBanner, Field, Input, LinkText, NoteBanner, Page } from "@shubix/ui-mobile";

/** The 6-digit code from the sign-up email (logic: @shubix/hooks useVerifyFlow, the same as the website). */
export function VerifyForm() {
  const f = useVerifyFlow(() => router.replace("/(tabs)"));
  const { t } = f;
  return (
    <Page>
      <AuthHeader onClose={() => router.replace("/(tabs)")} title={t("auth.verifyTitle")} subtitle={t("auth.codeSentTo", { email: f.email })} />
      <View className="mt-6 gap-4">
        <Field label={t("auth.codeLabel")}><Input value={f.code} onChangeText={(v) => f.setCode(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" /></Field>
        {f.error ? <ErrorBanner message={f.error} /> : null}
        {f.note ? <NoteBanner message={f.note} /> : null}
        <Button title={t("auth.verifyButton")} loading={f.busy} onPress={() => void f.verify()} />
        <LinkText className="self-center" title={`${t("auth.noCode")} ${t("auth.resendCode")}`} onPress={() => void f.resend()} />
      </View>
    </Page>
  );
}
