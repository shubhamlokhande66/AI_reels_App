import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthForm } from "@mobile/hooks";
import { Button, Card, ErrorBanner, Eyebrow, Field, Gold, Icon, Input, PasswordInput } from "@mobile/ui-mobile";
import { Logo } from "../atoms/Logo";
import { KeyboardScroll } from "../molecules/KeyboardScroll";
import { SoundBars } from "./HomeHero";

// the website's legal links under the form (components/molecules/Legal.tsx, compact): the pages the app has
const LEGAL = [["/terms", "legal.terms"], ["/privacy", "legal.privacy"], ["/contact", "legal.contact"]] as const;

/** Sign in, or create an account (the website's app/login/page.tsx on a phone): the dark studio band (the logo, the
 * three-line title, the soundtrack's bars), then the form sheet: the two tabs, the card with the fields (each says what
 * is wrong once left), the button that waits until the form is right, and the links. Logic: @mobile/hooks useAuthForm. */
export function SignInForm({ initial = "signin" }: { initial?: "signin" | "signup" }) {
  const f = useAuthForm((signedUp) => router.replace(signedUp ? "/verify" : "/"));
  const { t: text, signin } = f, insets = useSafeAreaInsets();
  useEffect(() => { if (initial !== "signin") f.setMode(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const tab = (mode: "signin" | "signup", label: string) => (
    <Pressable onPress={() => f.setMode(mode)} disabled={f.busy} accessibilityRole="button" accessibilityState={{ selected: f.mode === mode }} className="min-h-10 flex-1 items-center justify-center overflow-hidden rounded-[9px]">
      {f.mode === mode && <Gold />}
      <Text className={`text-[12px] font-bold ${f.mode === mode ? "text-on-accent" : "text-muted"}`}>{label}</Text>
    </Pressable>
  );
  return (
    <KeyboardScroll className="flex-1 bg-background" showsVerticalScrollIndicator={false}>
      <View className="min-h-[260px] overflow-hidden px-5 pb-10" style={{ paddingTop: Math.max(20, insets.top) }}>
        <LinearGradient colors={["#111110", "#171613", "#252117"]} locations={[0, 0.57, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: "absolute", inset: 0 }} />
        <View className="absolute -right-24 -top-28 h-[340px] w-[340px] rounded-full border border-[rgba(240,217,155,0.09)]" />
        <View className="flex-row items-center justify-between gap-3">
          <Logo height={44} />
          <View className="flex-row items-center gap-[7px] rounded-full border border-white/10 bg-white/5 px-[11px] py-[7px]">
            <View className="h-1.5 w-1.5 rounded-full bg-[#d8bd7b]" />
            <Text className="text-[10px] font-bold uppercase tracking-[1px] text-white/70">{text("nav.music")}</Text>
          </View>
        </View>
        <View className="mt-5">
          <View className="flex-row items-center gap-2"><Icon name="sparkle" size={13} color="#d8bd7b" /><Eyebrow className="text-[#d8bd7b]">{text("nav.create")}</Eyebrow></View>
          <Text className="mt-3 text-[30px] font-semibold leading-[31px] tracking-[-1.3px] text-[#f4f0e7]">
            {text("home.hero1")}{"\n"}<Text className="text-[#dfc47e]">{text("home.hero2")}</Text>{"\n"}{text("home.hero3")}
          </Text>
          <Text className="mt-3 max-w-[300px] text-[13px] leading-5 text-white/70">{text("home.heroText")}</Text>
        </View>
        <View className="absolute bottom-7 right-5 w-[118px] opacity-70"><SoundBars height={20} /></View>
      </View>

      <View className="-mt-5 rounded-t-[26px] border-t border-border bg-background px-4 pt-7" style={{ paddingBottom: Math.max(24, insets.bottom + 12) }}>
        <View className="mb-5 flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1"><Eyebrow className="text-[10px] text-accent">SHUBIX ACCOUNT</Eyebrow><Text className="mt-1 text-[12px] text-muted">{text("auth.signIn")} · {text("auth.signUp")}</Text></View>
          <View className="flex-row items-center gap-[7px] rounded-full border border-border bg-surface px-[9px] py-1.5"><Icon name="shield" size={13} color="muted" /><Text className="text-[9px] font-bold tracking-[0.7px] text-muted">PRIVATE & SECURE</Text></View>
        </View>
        <View accessibilityRole="tablist" className="mb-3 flex-row gap-1 rounded-xl border border-border bg-surface-2 p-1">{tab("signin", text("auth.signIn"))}{tab("signup", text("auth.createLink"))}</View>

        <Card className="gap-4 overflow-hidden rounded-[22px] p-5">
          <View>
            <Text className="text-[25px] font-semibold tracking-[-0.9px] text-foreground">{text(signin ? "auth.signIn" : "auth.signUp")}</Text>
            <Text className="mt-1.5 text-[12.5px] leading-[19px] text-muted">{text(signin ? "auth.signInSub" : "auth.signUpSub")}</Text>
          </View>
          <View className="gap-3">
            <Field label={text("auth.email")} error={f.errors.email}>
              <Input editable={!f.busy} icon={<Icon name="mail" size={17} color="muted" />} value={f.email} onChangeText={f.setEmail} onBlur={() => f.touch("email")} invalid={!!f.errors.email}
                autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder={text("auth.emailPlaceholder")} />
            </Field>
            <Field label={text("auth.password")} error={f.errors.password} ok={f.ok.password} hint={signin ? undefined : text("auth.lengthHint")}>
              <PasswordInput editable={!f.busy} value={f.password} onChangeText={f.setPassword} onBlur={() => f.touch("password")} invalid={!!f.errors.password}
                autoComplete={signin ? "password" : "new-password"} placeholder={text(signin ? "auth.passwordPlaceholder" : "auth.newPasswordPlaceholder")} showLabel={text("auth.showPassword")} hideLabel={text("auth.hidePassword")} />
            </Field>
            {!signin && (
              <Field label={text("auth.confirmPassword")} error={f.errors.again} ok={f.ok.again}>
                <PasswordInput editable={!f.busy} value={f.again} onChangeText={f.setAgain} onBlur={() => f.touch("again")} invalid={!!f.errors.again} autoComplete="new-password" placeholder={text("auth.confirmPlaceholder")} />
              </Field>
            )}
            {f.error ? <ErrorBanner message={f.error} /> : null}
            <Button full size="lg" icon="sparkle" className="mt-1" loading={f.busy} disabled={!f.valid} title={f.busy ? text("auth.wait") : text(signin ? "auth.signIn" : "auth.signUpButton")} onPress={() => void f.submit()} />
          </View>
          <View className="items-center gap-2">
            <Text className="text-center text-[12px] text-muted">{text(signin ? "auth.newHere" : "auth.haveAccount")}{" "}
              <Text onPress={() => f.setMode(signin ? "signup" : "signin")} accessibilityRole="link" className="font-bold text-accent">{text(signin ? "auth.createLink" : "auth.signIn")}</Text>
            </Text>
            {signin && <Text onPress={() => router.push("/forgot")} accessibilityRole="link" className="text-[12px] font-bold text-accent">{text("auth.forgotLink")}</Text>}
          </View>
        </Card>

        <View className="mt-6 flex-row flex-wrap justify-center gap-x-4 gap-y-1 border-t border-border/70 pt-3">
          {LEGAL.map(([href, key]) => <Text key={href} onPress={() => router.push(href)} accessibilityRole="link" className="py-1.5 text-xs text-muted">{text(key)}</Text>)}
        </View>
      </View>
    </KeyboardScroll>
  );
}
