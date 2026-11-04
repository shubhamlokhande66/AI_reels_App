import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, useText } from "@mobile/hooks";
import { errorMessage } from "@mobile/api-client";
import { Button, Card, ErrorBanner, Eyebrow, Icon, Input } from "@mobile/ui-mobile";

let later = false; // "Later" was chosen: not asked again until the app starts again

/** An administrator's daily code (the website's AdminGate): shown as soon as the code is due, still signed in. The code is
 * emailed at once (just after signing in the server sent it already: that answer is taken as sent). */
export function AdminCode({ onDone }: { onDone: () => void }) {
  const { api } = useApi(), text = useText(), insets = useSafeAreaInsets();
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const send = async (first = false) => {
    setError(null);
    try { await api.auth.adminCode(); } catch (e) { if (!(first && /VERIFY_TOO_SOON/.test(String((e as { code?: string }).code)))) setError(errorMessage(e)); }
  };
  useEffect(() => { void send(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const verify = async (c = code) => {
    if (c.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try { await api.auth.adminVerify(c); onDone(); } catch (e) { setError(errorMessage(e)); setCode(""); } finally { setBusy(false); }
  };
  return (
    <View className="flex-1 justify-center bg-background px-4" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Card className="gap-4 rounded-[22px] p-5">
        <View className="flex-row items-center gap-2"><Icon name="shield" size={14} color="muted" /><Eyebrow className="text-[10px] text-muted">{text("auth.adminEyebrow")}</Eyebrow></View>
        <Text className="text-[22px] font-semibold text-foreground">{text("auth.adminTitle")}</Text>
        <Text className="text-[12.5px] leading-[19px] text-muted">{text("auth.adminSent")}</Text>
        <Input value={code} onChangeText={(v) => { const c = v.replace(/\D/g, "").slice(0, 6); setCode(c); if (c.length === 6) void verify(c); }} keyboardType="number-pad" maxLength={6} autoFocus textContentType="oneTimeCode" placeholder="000000" />
        {error ? <ErrorBanner message={error} /> : null}
        <Button full size="lg" loading={busy} disabled={code.length !== 6} title={text("auth.adminVerify")} onPress={() => void verify()} />
        <View className="items-center gap-2">
          <Text onPress={() => void send()} accessibilityRole="link" className="text-[12px] font-bold text-accent">{text("auth.adminResend")}</Text>
          <Text onPress={() => { later = true; onDone(); }} accessibilityRole="link" className="text-[12px] text-muted">{text("auth.adminSkip")}</Text>
        </View>
      </Card>
    </View>
  );
}
/** whether the code may be asked now (not after "Later" in this run) */
export const adminCodeWanted = () => !later;
