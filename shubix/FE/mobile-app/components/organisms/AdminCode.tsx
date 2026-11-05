import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, useCountdown, useText, waitOf } from "@mobile/hooks";
import { errorMessage } from "@mobile/api-client";
import { Button, Card, ErrorBanner, Eyebrow, Icon, Input } from "@mobile/ui-mobile";
import { KeyboardScroll } from "../molecules/KeyboardScroll";

let later = false; // "Later" was chosen: not asked again until the app starts again

/** An administrator's daily code (the website's AdminGate): shown as soon as the code is due, still signed in. The code is
 * emailed at once (just after signing in the server sent it already: that answer is taken as sent). */
export function AdminCode({ onDone }: { onDone: () => void }) {
  const { api } = useApi(), text = useText(), insets = useSafeAreaInsets();
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const wait = useCountdown();
  const send = async () => {
    setError(null);
    try { const r = await api.auth.adminCode(); wait.start(r.wait ?? 60); }
    catch (e) { const w = waitOf(e); if (w) wait.start(w); else setError(errorMessage(e)); } // just sent: its time left
  };
  useEffect(() => { void send(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const verify = async (c = code) => {
    if (c.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try { await api.auth.adminVerify(c); onDone(); } catch (e) { setError(errorMessage(e)); setCode(""); } finally { setBusy(false); }
  };
  return (
    <KeyboardScroll className="flex-1 bg-background" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Card className="gap-4 rounded-[22px] p-5">
        <View className="flex-row items-center gap-2"><Icon name="shield" size={14} color="muted" /><Eyebrow className="text-[10px] text-muted">{text("auth.adminEyebrow")}</Eyebrow></View>
        <Text className="text-[22px] font-semibold text-foreground">{text("auth.adminTitle")}</Text>
        <Text className="text-[12.5px] leading-[19px] text-muted">{text("auth.adminSent")}</Text>
        <Input editable={!busy} value={code} onChangeText={(v) => { const c = v.replace(/\D/g, "").slice(0, 6); setCode(c); if (c.length === 6) void verify(c); }} keyboardType="number-pad" maxLength={6} autoFocus textContentType="oneTimeCode" placeholder="000000" />
        {error ? <ErrorBanner message={error} /> : null}
        <Button full size="lg" loading={busy} disabled={code.length !== 6} title={text("auth.adminVerify")} onPress={() => void verify()} />
        <View className="items-center gap-2">
          {wait.left > 0 ? <Text className="text-[12px] text-muted">{text("auth.resendIn", { s: wait.left })}</Text> : <Text onPress={() => void send()} accessibilityRole="link" className="text-[12px] font-bold text-accent">{text("auth.adminResend")}</Text>}
          <Text onPress={() => { later = true; onDone(); }} accessibilityRole="link" className="text-[12px] text-muted">{text("auth.adminSkip")}</Text>
        </View>
      </Card>
    </KeyboardScroll>
  );
}
/** whether the code may be asked now (not after "Later" in this run) */
export const adminCodeWanted = () => !later;
