/** The default texts (copied from lib/texts.ts); the admin's changes (Admin → CMS, app_settings "texts") come from
 * GET /api/texts and win. Add a key here before using it with t(). */
export const TEXT_DEFAULTS = {
  "auth.signIn": "Sign in", "auth.signInSub": "Sign in to get back to your Reel studio.", "auth.email": "Email", "auth.emailPlaceholder": "you@email.com",
  "auth.password": "Password", "auth.passwordPlaceholder": "Your password", "auth.wait": "Please wait…", "auth.forgotLink": "Forgot your password?",
  "auth.newHere": "New here?", "auth.createLink": "Create an account", "auth.signUp": "Create your account",
  "auth.signUpSub": "Create your account and start making Reels with music.", "auth.signUpButton": "Create account",
  "auth.newPasswordPlaceholder": "At least 8 characters", "auth.haveAccount": "Already have an account?", "auth.back": "Back to sign in",
  "auth.forgotTitle": "Forgot your password?", "auth.forgotCodeText": "Enter your email: we'll send you a 6-digit code to choose a new password.",
  "auth.sendCode": "Send code", "auth.sending": "Sending…", "auth.resetCodeSent": "If an account exists for {email}, we've emailed it a 6-digit code. It works for 10 minutes.",
  "auth.otherEmail": "Use another email", "auth.resetTitle": "Choose a new password", "auth.newPassword": "New password", "auth.confirmPassword": "Confirm password",
  "auth.resetButton": "Reset password", "auth.saving": "Saving…", "auth.codeSentTo": "We sent a 6-digit code to {email}. Enter it below; it works for 10 minutes.",
  "auth.codeLabel": "6-digit code", "auth.verifyButton": "Verify", "auth.noCode": "Didn't get it?", "auth.resendCode": "Send a new code",
  "auth.codeResent": "A new code is on its way.", "auth.enterSixDigits": "Enter the 6-digit code from the email.",
  "auth.verifyTitle": "Verify your email", "auth.showPassword": "Show password", "auth.hidePassword": "Hide password", "auth.lengthHint": "At least 8 characters",
  "auth.strongEnough": "Strong enough", "auth.match": "Passwords match", "auth.confirmPlaceholder": "Type your password again",
  "auth.badEmail": "Enter a valid email address.", "auth.shortPassword": "Use a password of at least 8 characters.", "auth.mismatch": "The two passwords don't match.",
  "plan.adLabel": "Ad", "plan.removeAds": "remove ads", "plan.aiAdTitle": "Let Shubix AI edit your Reels",
  "plan.aiAdText": "The best moments, transitions and captions picked for you, no ads, no watermark · Editor from {price}/month", "plan.aiAdButton": "See plans",
  "auth.signOut": "Sign out", "home.welcome": "Welcome to Shubix", "home.signedInAs": "Signed in as {email}", "home.notVerified": "Your email is not verified yet.",
} as const;
export type TextKey = keyof typeof TEXT_DEFAULTS;
