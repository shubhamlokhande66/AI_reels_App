import { Text } from "react-native";
import { router } from "expo-router";
import { useVerifyFlow } from "@mobile/hooks";
import { Button, ErrorBanner, OtpInput } from "@mobile/ui-mobile";
import { AuthFrame } from "../templates/AuthFrame";

/** Verify the email with the 6-digit code from the sign-up email (the website's app/verify/page.tsx); the sixth digit
 * sends it. Logic: @mobile/hooks useVerifyFlow. */
export function VerifyForm() {
  const f = useVerifyFlow(() => router.replace("/"));
  const { t: text } = f;
  return (
    <AuthFrame title={text("auth.verifyTitle")}>
      <Text className="text-[13px] leading-5 text-muted">{text("auth.codeSentTo", { email: f.email })}</Text>
      <OtpInput label={text("auth.codeLabel")} value={f.code} onChange={f.setCode} invalid={!!f.error} disabled={f.busy} />
      {f.error ? <ErrorBanner message={f.error} /> : null}
      {f.note && !f.error ? <Text className="text-[12.5px] font-semibold text-success">{f.note}</Text> : null}
      <Button full loading={f.busy} disabled={f.code.length !== 6} title={text("auth.verifyButton")} onPress={() => void f.verify()} />
      <Text className="text-center text-[12.5px] text-muted">{text("auth.noCode")} <Text onPress={() => void f.resend()} className="font-bold text-accent">{text("auth.resendCode")}</Text></Text>
      <Text className="text-center text-[11.5px] text-muted">{text("auth.checkSpam")}</Text>
    </AuthFrame>
  );
}
