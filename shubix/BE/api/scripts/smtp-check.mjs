// Checks the email settings in .env: for the main service (SMTP_*) and the fallback one (SMTP_FALLBACK_*), connects to
// the server and signs in, then stops (no email is sent). Prints each server, login and sender, and OK or why it failed;
// never a password.
// Run: node scripts/smtp-check.mjs
import fs from "node:fs";
import nodemailer from "nodemailer";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

async function check(label, p) {
  const host = env[`${p}HOST`], port = Number(env[`${p}PORT`] || 587), user = env[`${p}USER`], pass = env[`${p}PASSWORD`] ?? "", ssl = env[`${p}SSL`] === "true";
  console.log(`\n${label}: ${host || "(empty)"}:${port} · login ${user || "(empty)"} · from ${env[`${p}FROM`] || "(empty)"} · password ${pass ? "set" : "EMPTY"}`);
  if (!host) { console.log("  Not set up."); return false; }
  if (!user || !pass) { console.log(`  Not ready: fill ${p}USER and ${p}PASSWORD in .env.`); return false; }
  if (/^["']|["']$|\s/.test(pass)) console.log("  Warning: the password has quotes or spaces in it; paste it alone (a Gmail app password without its spaces).");
  try {
    await nodemailer.createTransport({ host, port, secure: ssl, requireTLS: !ssl, auth: { user, pass }, connectionTimeout: 20_000 }).verify();
    console.log("  OK: signed in. This service can send.");
    return true;
  } catch (e) {
    const why = String(e.response ?? e.message);
    console.log(`  FAILED: ${e.code ?? ""} ${why}`);
    if (/Unauthori[sz]ed IP|525/i.test(why)) console.log("  → Brevo blocks this computer's IP: Brevo → Security → Authorized IPs → turn off blocking for SMTP keys.");
    else if (/Application-specific password|InvalidSecondFactor|534/i.test(why)) console.log("  → Gmail wants an App password: turn on 2-Step Verification, then myaccount.google.com/apppasswords.");
    else if (/535|invalid|credentials|Username and Password not accepted/i.test(why)) console.log("  → The login or password is wrong (Gmail: use an App password, not the Gmail password; Brevo: a new SMTP key).");
    else if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout/i.test(why)) console.log("  → Could not reach the server: check the host and port, or this network blocks port 587.");
    return false;
  }
}

const main = await check("Main (sends first)", "SMTP_");
const fallback = await check("Fallback (used if the main one fails)", "SMTP_FALLBACK_");
console.log(`\n${main ? "Emails go through the main service" : fallback ? "Emails go through the fallback service (the main one is not working)" : "No service works: emails will not be sent"}${main && fallback ? ", with the fallback ready." : "."}`);
process.exit(main || fallback ? 0 : 1);
