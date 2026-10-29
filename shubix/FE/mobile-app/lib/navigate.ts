import { router } from "expo-router";
import { Linking } from "react-native";
import type { StudioTemplate } from "@shubix/core/lib/studio-templates";

/** A page of the app, another site, or the plans when the page is on a higher plan. */
export const open = (href: string, locked = false) =>
  locked ? router.push({ pathname: "/pricing", params: { need: href } }) : /^https?:/.test(href) ? void Linking.openURL(href) : router.push(href as never);
/** A template opens the Create flow of its kind with it picked (or the plans when it is on a higher plan). */
export const openTemplate = (t: StudioTemplate, locked = false) =>
  locked ? open(`template:${t.id}`, true) : router.push({ pathname: "/create/[kind]", params: { kind: t.kind === "talk" ? "talking" : t.kind, templateId: t.id } });
