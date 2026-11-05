/** Every text the administrator can change (Admin → CMS), page by page: a page has sections, a section has
 * cards, a card has its fields (Home → Create Your Reel → Music Reel → Line). Each field has its key, a label for the
 * admin and the default. The admin's changes are kept in app_settings (server/texts.ts); a text left as it is follows
 * the default here. `{name}` in a text is filled in by the app (a price, a plan's name…). `long`: a paragraph.
 * Keys never change: saved texts are kept by key. */

export interface TextDef { key: string; label: string; value: string; long?: boolean; section?: string; card?: string }
/** `area`: where the page sits in the CMS tree ("Pages", "On every page", "Plans & payments", "Studio") */
export interface TextGroup { id: string; name: string; area: string; items: TextDef[] }

const T = (key: string, label: string, value: string, long = false): TextDef => ({ key, label, value, ...(long ? { long } : {}) });
/** a section of a page: its fields and cards */
const S = (section: string, ...parts: (TextDef | TextDef[])[]): TextDef[] => parts.flat().map((t) => ({ ...t, section }));
/** a card in a section: its fields */
const C = (card: string, ...items: TextDef[]): TextDef[] => items.map((t) => ({ ...t, card }));
const page = (area: string, id: string, name: string, ...sections: TextDef[][]): TextGroup => ({ id, name, area, items: sections.flat() });

const PAGES = "Pages", EVERY = "On every page", PLANS = "Plans & payments";

const LEGAL_TERMS = `These terms apply when you use {name} (“we”, “the service”), an online tool that edits short videos (Reels) from your clips, music, photos and stories. By creating an account or using the service you agree to them.

## 1. Your account
- You must be at least 18, or have a parent's or guardian's permission.
- Keep your password safe. You are responsible for what happens in your account.
- You can delete your account and all its data at any time from the Account page.

## 2. Your content
- You keep all rights to the clips, music, photos and text you upload, and to the Reels made from them.
- You confirm you have the rights to everything you upload, including music. Do not upload content that is illegal, hateful, sexual involving minors, or that infringes someone else's rights.
- You allow us to process your content only to provide the service (analyse it, edit it, store it for the time shown in the app, and post it where you ask us to).
- Uploaded files are deleted automatically after a period shown in the app. Download your Reels before then.

## 3. AI features
- Some features use AI services (for example to plan scenes, write captions, make a voice or a picture). AI output can be wrong or imperfect: check your Reel before you post it.
- Pictures from public-domain artworks are credited in the app. AI pictures and voices may be used for your Reels freely.

## 4. Plans, credits and payments
- Prices are in Indian rupees and include GST. Payments are processed by Razorpay.
- Paid plans are prepaid for one month or one year and do **not** renew automatically. Plan credits refresh every 30 days during the paid period and do not carry over; starter and top-up credits do not expire.
- Credits are used when a Reel is made. If a Reel fails, its credits are returned automatically.
- All purchases are final and **non-refundable**; see our [Refund & Cancellation Policy](/refunds).

## 5. Invites, sending credits, coupons and affiliates
- **Invites:** when a friend joins with your link, you and your friend get the credits shown on the Invite & earn page, at the step shown there (for example when they verify their email, or make a first purchase). There is a monthly limit, and the amounts and rules can change for new invites.
- **Sending credits:** credits you send to another user by username are moved at once and cannot be taken back. Only top-up and gift credits can be sent, not a plan's monthly credits.
- **Coupons and offers:** each has its own rules (dates, plans, uses). They have no cash value and cannot be exchanged for money.
- **Affiliates:** an approved affiliate earns the commission shown on their dashboard, only on successful payments by the people who joined with their link, for the period shown. Commission is paid by UPI or bank transfer once it reaches the payout amount; you must give correct payout details and are responsible for your own taxes on it.
- **No abuse:** inviting yourself, fake or duplicate accounts, spam, or misleading promotion are not allowed. We may hold or cancel the credits or commission they earned, and pause or close the accounts involved.

## 6. Fair use
Do not try to break, overload or copy the service, share accounts, or use it to make spam or misleading content. We may limit or close accounts that do.

## 7. Availability and liability
We work to keep the service running well but cannot promise it is always available or error-free. To the extent the law allows, our liability for any claim is limited to the amount you paid us in the 3 months before it.

## 8. Changes
We may update these terms. If a change matters, we will tell you in the app or by email before it applies.

## 9. Law and contact
These terms are governed by the laws of India. Questions: {contact}. {business}.`;

const LEGAL_PRIVACY = `This policy explains what {name} collects, why, and the choices you have. We collect as little as we can and keep it only as long as needed.

## What we collect
- **Account:** your email address, your name if you add it, and a securely hashed password (we never see or store the password itself).
- **Your content:** the clips, music, photos and stories you upload, and the Reels made from them.
- **Usage:** your projects, credits and their history, and payment records (amount, date, plan).
- **Phone app:** on the Free plan, Google AdMob uses your device's Advertising ID to show ads.
- **Error reports:** when the website or the app breaks, the error message, the page and the type of browser or device, so we can fix it. Kept for 30 days.
- **Payments:** handled by Razorpay. Your card, UPI or bank details go to Razorpay, not to us; we only receive a payment confirmation.
- **Invites and rewards:** your username (people you share it with can send you credits with it), who invited you, and the credits you send or receive.
- **Affiliates:** if you join the affiliate program, the payout details you give us (a UPI ID or bank account), used only to pay your commission, and the sales made through your link (the customers' usernames are shown to you, never their emails).

## Why we use it
- To make your Reels, keep your account and credits, take payments and answer your questions.
- To keep the service secure and working, and to stop abuse of invites, coupons and the affiliate program.
- We do not sell your data. On the Free plan the app may show ads (see Ads and cookies below); paid plans see none.

## Services that help us
- AI services (for example Google Gemini) receive the text or keyframes needed for a feature you use, such as planning a story or making a narration.
- Cloud services host the app and its database, and may make AI pictures for story scenes.
- Razorpay processes payments. Social networks receive a Reel only when you ask us to post it.
- Google AdSense on the website and Google AdMob in the phone app may show ads on the Free plan (only on pages like Home and My Reels, never in the editor).
- An email service sends account emails (sign-up and password codes, a welcome email about the app and its plans, payment receipts) and notes about your invites, credits and affiliate earnings.
- The Help chat sends your questions to the AI service that answers them. Messages you send from the Contact page, and the questions you ask the Help chat, are kept so our team can help you and improve the answers.

## How long we keep it
- Uploaded clips and finished projects are deleted automatically after the period shown in the app.
- When you delete your account, your content, projects and credits are deleted. Payment records (and affiliate payouts) are kept as tax law requires, without the link to you.

## Ads and cookies
- We use one essential cookie to keep you signed in. Your browser also remembers a friend's invite link for 30 days, so the sign-up knows who invited you.
- On the Free plan, ads may be shown by Google AdSense. Google and its partners may use cookies to show ads based on your visits to this and other websites. You can turn off personalised ads in [Google's Ads Settings](https://adssettings.google.com), and read [how Google uses data](https://policies.google.com/technologies/partner-sites).
- In the phone app, ads on the Free plan are shown by Google AdMob, which uses your Advertising ID and may collect device and usage data. Where the law asks for consent, the app asks first, and you can change your choice in My account → Ad privacy choices. You can delete your Advertising ID in your phone's Google settings.
- Paid plans see no ads, and we do not use other advertising or tracking cookies.

## Your rights
You can see and download your Reels, correct your details, and delete your account and all its data at any time from the Account page. Under India's Digital Personal Data Protection Act you may also ask us about your data or raise a concern: write to {reach}.

## Security
Connections are encrypted (HTTPS), passwords are hashed, and each account can only reach its own data.

## Contact
{business}. {contact}.`;

const LEGAL_REFUNDS = `## Cancellation
Plans do not renew automatically, so there is nothing to cancel: a plan simply ends at the end of the month or year you paid for. You keep using your credits until then.

## Failed Reels
If a Reel cannot be made, the credits it used are returned to your account automatically. No request is needed.

## No refunds
- All purchases (plans and credit top-ups) are **final and non-refundable**, whether the credits are used or not.
- You can make Reels on your phone with the Free plan before you buy, so you know what you get.
- Unused credits are not exchanged for money.

## A problem with a payment
If you were charged twice, or a payment did not add your plan or credits, write to {reach} from your account's email with the payment date and amount. We check it within 3 working days and make it right by adding what you paid for.

## Delivery
{name} is a digital service. Plans and credits are added to your account immediately after a successful payment; nothing is shipped.`;

const LEGAL_ABOUT = `{name} is a Reels video studio for creators, small businesses and anyone who wants short videos without learning a complicated editor. You bring the clips, the photos and the song; {name} finds the beats and cuts everything to the music.

## What you can make
- **Music Reel:** choose a song and your clips, and the cuts land on the beat.
- **Talking Reel:** turn a video of someone speaking into a Reel with captions.
- **Photo Reel:** make a moving Reel from your photos.
- **Copy a Reel:** start from the rhythm and style of a Reel you like.
- **Story Maker:** write a story, and it becomes scenes with a narration and captions.

## How it works
Pick a sound, add your clips, and let {name} make the first edit. Then change anything you like in the editor: clips, text, filters, effects and sound. Your video is made on your own device, so your original clips stay with you unless you use a feature that needs them on our servers. The [Privacy Policy](/privacy) explains exactly what is sent and why.

## Plans
You can start on the Free plan. Paid plans add more tools and credits and show no ads. See [Pricing](/pricing).

## Contact
Questions or ideas: {contact}. {business}.`;

const HOME_ABOUT = `## Reels that move with your music
Shubix is a video studio for short vertical videos. Choose a song, add your clips or photos, and Shubix finds the beats and places every cut on them, so your Reel feels edited by hand. It works in your browser and in the Android app, with no complicated timeline to learn before your first video.

## How to make a Reel
- **Pick a sound:** choose a song from your device and the part of it you want. Shubix reads its beats, drops and quiet moments.
- **Add your moments:** select your clips or photos, in the order you like or in the order Shubix suggests.
- **Get your first edit:** the clips are cut to the music, with transitions and effects that follow the song.
- **Make it yours:** change the clips, add text and captions, adjust colour and sound, then export in 9:16.

## Made for every kind of Reel
A Music Reel is cut to a song. A Talking Reel keeps the words of someone speaking and adds captions. A Photo Reel brings your pictures to life. Copy a Reel starts from the rhythm of a Reel you like, and Story Maker turns your written story into scenes with a narration.

## Tips for a better Reel
Start with your strongest moment, because people decide in the first seconds. Use several short clips instead of one long clip, keep your subject in the centre of the 9:16 frame, and use music you have the right to use. Read more about [Shubix](/about), or see the [plans](/pricing).`;

const LEGAL_DELETE = `This page explains how to delete your {name} account and its data, from the app or without it.

## In the app or on the website
- Open **My account** (the phone app or the website), then **Delete account**.
- Type your email and your password to confirm, then **Delete everything**.

## Without the app
Write to {reach} from your account's email with the subject “Delete my account”. We delete it within 7 days and reply when it is done.

## What is deleted
- Your account, profile, sign-in sessions and devices
- Your projects, uploaded clips, songs and photos, saved Reels, brands, templates and voice profiles
- Your credits and plan (unused credits are not refunded)

## What is kept
- Payment records (and affiliate payouts), as tax law requires, without the link to you, for up to 8 years
- Drafts on your phone stay on your phone until you delete them or remove the app

## Contact
{business}. {contact}.`;

export const TEXT_GROUPS: TextGroup[] = [
  // ---------------------------------------------------------------- pages
  page(PAGES, "home", "Home",
    S("Hero",
      C("Title", T("home.hero1", "Line 1", "Your clips."), T("home.hero2", "Line 2 (champagne accent)", "On the beat."), T("home.hero3", "Line 3", "Your Reel.")),
      C("Text and button", T("home.heroText", "Text", "Choose a track, add your favorite moments, and let Shubix cut them into a Reel that moves with the music.", true), T("home.heroButton", "Button", "Create Music Reel")),
      C("Tag and steps", T("home.heroTag", "Tag above the title", "Beat-synced reel studio"), T("home.step1", "Step 1", "Pick a sound"), T("home.step2", "Step 2", "Cut to the beat"), T("home.step3", "Step 3", "Export your Reel")),
      C("Studio picture", T("home.mockPreview", "On the Reel", "9:16 PREVIEW"), T("home.mockMove", "Under the Reel", "MADE TO MOVE"), T("home.mockSound", "Sound card", "Soundtrack"), T("home.mockBeat", "Under the sound", "BEAT MATCH"),
        T("home.mockClips", "Clips card", "Your clips"), T("home.mockMoments", "Clips count", "3 moments"), T("home.mockSync", "Last line", "Clips, music, perfectly in sync"))),
    S("Create Your Reel", C("Section", T("home.createTitle", "Title", "Create Your Reel"))),
    S("About Shubix (lower on Home)", C("Section", T("home.aboutBody", "The text", HOME_ABOUT, true))),
    S("Popular Templates", C("Section", T("home.templatesTitle", "Title", "Popular Templates"), T("home.seeAll", "“See all” link (every section)", "See All"))),
    S("Continue Editing",
      C("Section", T("home.continueTitle", "Title", "Continue Editing"), T("common.edited", "Under a draft ({when})", "Edited {when}")),
      C("No drafts yet", T("home.emptyTitle", "Title", "No Reels yet"), T("home.emptyText", "Line", "Pick a song and a few clips: your first Reel is ready in seconds, cut to the beat.", true), T("home.emptyButton", "Button", "Make your first Reel"))),
    S("Saved in My Reels", C("Section", T("home.savedTitle", "Title", "Saved in My Reels"))),
    S("Tips for Better Reels", C("Section", T("home.tipsTitle", "Title", "Tips for Better Reels"), T("home.tipsSub", "Line on the tips banner", "Simple tips to get more views"))),
  ),
  page(PAGES, "pricing", "Pricing & plans",
    S("Hero",
      C("Title", T("pricing.badge", "Badge above", "Pricing"), T("pricing.title1", "First part", "Simple plans."), T("pricing.title2", "Coloured part", "Pay for what you make.")),
      C("Text", T("pricing.sub", "Line ({aiCost}: credits of an AI Reel)", "Make Reels free on your phone. Shubix AI edits them for you in Editor and Pro: an AI Reel uses {aiCost} credits. No card for Free, nothing renews by itself, every price includes GST.", true)),
      C("Monthly / Yearly switch", T("pricing.monthly", "Monthly", "Monthly"), T("pricing.yearly", "Yearly", "Yearly"), T("pricing.monthsFree", "Saving ({n}: months)", "{n} months free"))),
    S("Plan cards",
      C("Card top", T("pricing.popular", "Badge on the popular plan", "Most popular"), T("pricing.perMonth", "After a monthly price", "/month"), T("pricing.perYear", "After a yearly price", "/year"),
        T("pricing.freeForever", "Under the Free price", "Free forever"), T("pricing.billedMonthly", "Under a monthly price", "Billed monthly · nothing renews by itself"),
        T("pricing.billedYearly", "Under a yearly price ({price}: a month)", "{price} a month, billed yearly"), T("pricing.credits", "Credits (“250 credits …”)", "credits")),
      C("Card buttons", T("pricing.makeReel", "Free plan (signed in)", "Make a Reel"), T("pricing.startFree", "Free plan (signed out)", "Start free"),
        T("pricing.choose", "Paid plan ({plan})", "Choose {plan}"), T("pricing.extend", "Your plan ({plan})", "Extend {plan}"), T("pricing.signInFor", "Paid plan, signed out ({plan})", "Sign in to choose {plan}"),
        T("pricing.opensSoon", "Payments closed", "Opens soon"), T("pricing.currentPlan", "Your plan, payments closed", "Your current plan"), T("pricing.opening", "While the payment opens", "Opening payment…"))),
    S("What each plan unlocks",
      C("Table", T("pricing.compareTitle", "Title", "What each plan unlocks"),
        T("pricing.compareSub", "Line", "Most of the editor is free. 👑 tools open on their plan; 👑 effects, filters and fonts can be tried by everyone, and exporting with them needs their plan.", true),
        T("pricing.rowQuality", "Row: export quality", "Best export quality"), T("pricing.row60", "Row: 60 fps", "60 fps"), T("pricing.rowWatermark", "Row: watermark", "No watermark"))),
    S("Credits",
      C("Your credits card", T("pricing.yourCredits", "Title", "Your credits"), T("pricing.planBadge", "Plan badge ({plan})", "{plan} plan"),
        T("pricing.activeUntil", "Plan end ({date})", "Active until {date}"), T("pricing.renews", "Next credits ({date})", "New credits on {date}"),
        T("pricing.extraLeft", "Top-ups left ({n})", "{n} top-up credits never expire"), T("pricing.freeNote", "On Free", "Edit Reels on your phone for free; Shubix AI needs credits")),
      C("Top-up card", T("pricing.topUpTitle", "Title", "Need more credits?"), T("pricing.topUpSub", "Line", "Top up any time. Top-up credits never expire."), T("pricing.perCredit", "Price of a credit ({price})", "{price} a credit"))),
    S("What a credit buys",
      C("Section", T("pricing.costsTitle", "Title", "What a credit buys"), T("pricing.costsSub", "Line", "Previews and the edits made on your phone are free. A Reel that fails gives its credits back.", true),
        T("pricing.costFree", "Free", "Free"), T("pricing.costCredit", "1 credit", "1 credit"), T("pricing.costCredits", "More ({n})", "{n} credits"))),
    S("Questions", C("Section", T("pricing.faqTitle", "Title", "Questions"), T("pricing.faqSub", "Line", "Everything about plans, credits and payments."))),
    S("Payments",
      C("Notes", T("pricing.secure", "At the end: payments open", "Payments are handled securely by Razorpay. We never see your card or UPI details."),
        T("pricing.soon", "At the end: payments closed", "Online payment opens soon."), T("pricing.paid", "After a payment ({item})", "Payment received: {item} is active. Thank you!"))),
    S("Coupons & offers",
      C("Checkout", T("pricing.checkoutTitle", "Title", "Your order"), T("pricing.checkoutPrice", "Price line", "Price"), T("pricing.checkoutOffer", "Offer line ({title})", "{title}"),
        T("pricing.checkoutCoupon", "Coupon line ({code})", "Coupon {code}"), T("pricing.checkoutTotal", "Total line", "You pay"), T("pricing.couponLabel", "Coupon field label", "Have a coupon code?"),
        T("pricing.couponPlaceholder", "Coupon placeholder", "Enter code"), T("pricing.couponApply", "Apply button", "Apply"), T("pricing.couponRemove", "Remove button", "Remove"),
        T("pricing.couponApplied", "After applying ({label})", "Applied: {label}"), T("pricing.payNow", "Pay button ({price})", "Pay {price}"), T("pricing.checking", "While checking the price", "Checking your price…")),
      C("Offer", T("pricing.offerEnds", "Banner: ends ({when})", "ends {when}"), T("pricing.offerSee", "Banner: link", "See plans"), T("pricing.offerTag", "Price tag ({percent})", "{percent}% off"),
        T("pricing.offerNew", "Banner: first purchase only", "on your first purchase"))),
  ),
  page(PAGES, "affiliate", "Affiliate dashboard",
    S("Page", C("Header", T("nav.affiliate", "Title (also in the menu)", "Affiliate dashboard"), T("aff.sub", "Line under the title", "Your link, your customers and what you earn."),
      T("aff.loading", "While loading", "Loading your dashboard…"), T("aff.notYet", "Not an affiliate", "You are not in the affiliate program yet."), T("aff.toRewards", "Link to Invite & earn", "Go to Invite & earn"),
      T("aff.pendingTitle", "Waiting: title", "Your request is with our team"), T("aff.pausedTitle", "Paused: title", "Your affiliate account is paused"), T("aff.open", "Button on Invite & earn", "Open dashboard"))),
    S("Sign in & join", C("Sign in (by email code)", T("aff.signTitle", "Title", "Affiliate partner dashboard"),
      T("aff.signLine", "Line ({percent}, {months})", "Earn {percent}% of what the people you bring pay, for {months} months. Enter your email: we send you a code, no password needed.", true),
      T("aff.sendCode", "Send code button", "Send me a code"), T("aff.codeTitle", "Code step: title", "Check your email"), T("aff.otherEmail", "Use another email", "Use another email"),
      T("aff.haveShubix", "Shubix users line", "Use Shubix?"), T("aff.signInShubix", "Shubix sign-in link", "Sign in there and open it from Invite & earn")),
      C("Ask to join", T("aff.applyTitle", "Title", "Join the affiliate program"), T("aff.applyAs", "Signed in as ({email})", "Signed in as {email}"),
        T("aff.noteLabel", "Note label", "How will you share your link? (optional)"), T("aff.notePlaceholder", "Note placeholder", "Instagram @yourpage, YouTube channel, website…"),
        T("aff.applyButton", "Button", "Send my request"), T("aff.closed", "Program closed", "The affiliate program is not taking new partners right now."),
        T("aff.pendingLine", "Waiting: line", "We will email you as soon as you are approved. Then open this page again to see your link.")),
      C("Top bar", T("aff.signOut", "Sign out", "Sign out"), T("aff.toShubix", "Back to the studio", "Back to Shubix"))),
    S("Link & terms", C("Card", T("aff.link", "Link label", "Your affiliate link"), T("aff.termPercent", "Term: % ({n})", "{n}% commission"), T("aff.termMonths", "Term: months ({n})", "for {n} months a customer"),
      T("aff.termUntil", "Term: link end ({date})", "link valid until {date}"), T("aff.termNoEnd", "Term: no end", "link never ends"), T("aff.termPayout", "Term: payout ({n})", "paid out from ₹{n}"))),
    S("Numbers", C("Tiles", T("aff.clicks", "Clicks", "Link clicks"), T("aff.last30", "Clicks note ({n})", "{n} in 30 days"), T("aff.customers", "Customers", "Customers"),
      T("aff.buyers", "Customers note ({n})", "{n} bought"), T("aff.revenue", "Paid note ({n})", "from {n} in sales"))),
    S("Lists", C("Tabs & rows", T("aff.sales", "Sales tab", "Sales"), T("aff.payouts", "Payouts tab", "Payouts"), T("aff.statusDue", "Due", "Due"), T("aff.statusPaid", "Paid", "Paid"),
      T("aff.joined", "Customer joined ({date})", "joined {date}"), T("aff.countsUntil", "Customer counts until ({date})", "counts until {date}"), T("aff.afterEnd", "Joined after the link ended", "joined after your link ended"),
      T("aff.payoutSales", "Payout: sales ({n})", "{n} sales"), T("aff.noSales", "No sales", "No sales yet. Share your link to start earning."), T("aff.noCustomers", "No customers", "No one has joined with your link yet."),
      T("aff.noPayouts", "No payouts", "No payouts yet."), T("aff.ref", "Payout reference ({ref})", "Ref {ref}"))),
    S("Payout details", C("Card", T("aff.payTitle", "Title", "Where we pay you"), T("aff.paySub", "Line", "Your commission is sent here by UPI or bank transfer once it reaches the payout amount."),
      T("aff.payMissing", "Not given yet", "Add your UPI ID or bank account so we can pay you."), T("aff.payUpi", "UPI tab", "UPI"), T("aff.payBank", "Bank tab", "Bank account"),
      T("aff.upiLabel", "UPI ID label", "UPI ID"), T("aff.upiHint", "UPI ID hint", "Like yourname@okaxis"), T("aff.bankName", "Account holder label", "Account holder's name"),
      T("aff.bankAccount", "Account number label", "Account number"), T("aff.bankAccountKeep", "Account number placeholder when saved ({last4})", "Saved: ending {last4} · type again to change"),
      T("aff.bankIfsc", "IFSC label", "IFSC code"), T("aff.paySave", "Save button", "Save payout details"), T("aff.payEdit", "Change button", "Change"), T("aff.paySaved", "After saving", "Saved. We pay you here."),
      T("aff.payConfirm", "Confirm ({where})", "Get paid at {where}?"), T("aff.payNow", "Saved: where ({where})", "Paid to {where}"))),
  ),
  page(PAGES, "rewards", "Invite & earn",
    S("Page", C("Header", T("nav.rewards", "Title (also in the menu)", "Invite & earn"), T("rewards.sub", "Line under the title", "Invite friends, send credits and earn with Shubix."),
      T("rewards.loading", "While loading", "Loading your rewards…"), T("rewards.off", "Billing off", "Rewards need accounts and credits, which are off in this studio."))),
    S("Invite friends",
      C("Card", T("rewards.inviteTitle", "Title", "Invite friends, you both get credits"), T("rewards.inviteLine2", "Line ({friend} {friendWhen} {you} {youWhen})", "Your friend gets {friend} credits when they {friendWhen}; you get {you} when they {youWhen}.", true),
        T("rewards.whenSignup", "When: sign up", "sign up"), T("rewards.whenVerified", "When: verify their email", "join and verify their email"), T("rewards.whenPurchase", "When: first purchase", "make their first purchase"),
        T("rewards.yourLink", "Link label", "Your invite link"), T("rewards.copy", "Copy button", "Copy link"), T("rewards.copied", "After copying", "Copied!"), T("rewards.whatsapp", "WhatsApp button", "WhatsApp"),
        T("rewards.creditsFreeAi", "On Free: what credits do ({n})", "On Free, credits pay for Shubix AI: {n} credits make 1 AI Reel"), T("rewards.creditsKept", "On Free: credits kept", "Your credits are kept for Shubix AI when you upgrade"),
        T("rewards.shareText", "Message shared ({link})", "Make stunning Reels with Shubix, edited on the beat by AI. Join with my link and get free credits: {link}", true)),
      C("Your invites", T("rewards.invited", "Friends joined", "Friends joined"), T("rewards.rewarded", "Rewarded", "Rewarded"), T("rewards.earned", "Credits earned", "Credits earned"),
        T("rewards.inviteOff", "Invites turned off", "Invites are paused right now."))),
    S("Send credits",
      C("Form", T("rewards.sendTitle", "Title", "Send credits to a friend"), T("rewards.sendLine", "Line ({min} {max} {left})", "Send {min} to {max} credits at a time · {left} left to send today.", true),
        T("rewards.sendExtraOnly", "Which credits", "Top-up and gift credits can be sent; a plan's monthly credits stay with the plan."),
        T("rewards.to", "To label", "Friend's username"), T("rewards.toPlaceholder", "To placeholder", "@username"), T("rewards.amount", "Amount label", "Credits"),
        T("rewards.send", "Button", "Send credits"), T("rewards.sending", "While sending", "Sending…"), T("rewards.confirm", "Confirm ({n} {to})", "Send {n} credits to @{to}?"),
        T("rewards.sent", "After sending ({n} {to})", "Sent {n} credits to @{to}."), T("rewards.sendOff", "Sending off", "Sending credits is paused right now."))),
    S("Affiliate",
      C("Program", T("rewards.affTitle", "Title", "Affiliate program"), T("rewards.affLine", "Line ({percent} {months})", "Earn {percent}% of what the people you bring pay in their first {months} months.", true),
        T("rewards.affApply", "Apply button", "Apply to join"), T("rewards.affPending", "Waiting", "Your request is with our team. We will let you know."),
        T("rewards.affPaused", "Paused", "Your affiliate account is paused. Contact us to know more."), T("rewards.affClosed", "Closed", "The program is not taking new partners right now."),
        T("rewards.affUntil", "Link end date ({date})", "Your link brings new customers until {date}.")),
      C("Your earnings", T("rewards.affDue", "Due", "To be paid"), T("rewards.affPaid", "Paid", "Paid so far"), T("rewards.affSales", "Sales", "Sales"),
        T("rewards.affPayout", "Payout note ({min})", "Paid out by bank or UPI from ₹{min}.", true), T("rewards.affRecent", "Recent", "Recent sales"))),
    S("Username",
      C("Form", T("rewards.userTitle", "Title", "Your username"), T("rewards.userLine", "Line", "Friends send you credits with it, and it is your invite code."),
        T("rewards.userSave", "Save button", "Save"), T("rewards.userSaved", "After saving", "Saved"))),
  ),
  page(PAGES, "auth", "Sign in & passwords",
    S("Sign in",
      C("Form", T("auth.signIn", "Title and button", "Sign in"), T("auth.signInSub", "Line under sign in title", "Sign in to get back to your Reel studio."), T("auth.email", "Email label", "Email"), T("auth.emailPlaceholder", "Email placeholder", "you@email.com"),
        T("auth.password", "Password label", "Password"), T("auth.passwordPlaceholder", "Password placeholder", "Your password"), T("auth.wait", "While signing in", "Please wait…")),
      C("Links", T("auth.adminEyebrow", "Admin code: small heading", "Admin security"), T("auth.adminTitle", "Admin code: title", "Confirm it's you"), T("auth.adminSent", "Admin code: line", "We emailed a 6-digit code to your administrator account. Enter it to use the admin powers for the next 24 hours."), T("auth.adminVerify", "Admin code: button", "Confirm"), T("auth.adminResend", "Admin code: send again", "Send a new code"), T("auth.adminSkip", "Admin code: continue without", "Continue without admin powers"), T("auth.forgotLink", "Forgot password", "Forgot your password?"), T("auth.newHere", "Before “Create an account”", "New here?"), T("auth.createLink", "Create an account", "Create an account"),
        T("auth.partnerLink", "Affiliate partners link", "Affiliate partner? Open your dashboard"))),
    S("Create an account",
      C("Form", T("auth.signUp", "Title", "Create your account"), T("auth.signUpSub", "Line under sign up title", "Create your account and start making Reels with music."), T("auth.signUpButton", "Button", "Create account"), T("auth.newPasswordPlaceholder", "Password placeholder", "At least 8 characters"),
        T("auth.haveAccount", "Before “Sign in”", "Already have an account?"))),
    S("Forgot password",
      C("Form", T("auth.back", "Back link", "Back to sign in"), T("auth.forgotTitle", "Title", "Forgot your password?"), T("auth.forgotText", "Line", "We'll email you a link to choose a new one."),
        T("auth.sendLink", "Button (old link emails)", "Send reset link"), T("auth.sending", "While sending", "Sending…"),
        T("auth.forgotCodeText", "Line", "Enter your email: we'll send you a 6-digit code to choose a new password."), T("auth.sendCode", "Button", "Send code")),
      C("Code and new password", T("auth.resetCodeSent", "Line ({email})", "If an account exists for {email}, we've emailed it a 6-digit code. It works for 10 minutes.", true),
        T("auth.otherEmail", "Use another email", "Use another email")),
      C("After sending", T("auth.forgotSent", "Message ({email})", "If an account exists for {email}, we've emailed it a link to choose a new password. The link works for one hour. Check your spam folder too.", true))),
    S("Choose a new password",
      C("Form", T("auth.resetTitle", "Title", "Choose a new password"), T("auth.newPassword", "New password", "New password"), T("auth.confirmPassword", "Confirm", "Confirm password"),
        T("auth.resetButton", "Button", "Reset password"), T("auth.saving", "While saving", "Saving…")),
      C("Bad link", T("auth.badLink", "Incomplete link", "This link is incomplete."), T("auth.askNew", "Ask again (incomplete)", "Ask for a new one"), T("auth.askNewLink", "Ask again (expired)", "Ask for a new link"))),
    S("Verify email",
      C("Code", T("auth.codeSentTo", "Line ({email})", "We sent a 6-digit code to {email}. Enter it below; it works for 10 minutes.", true), T("auth.codeLabel", "Code boxes (screen readers)", "6-digit code"),
        T("auth.verifyButton", "Button", "Verify"), T("auth.noCode", "Before resend", "Didn't get it?"), T("auth.resendCode", "Resend", "Send a new code"),
        T("auth.resendIn", "Resend wait ({s})", "Send again in {s}s"), T("auth.codeResent", "After resending", "A new code is on its way."),
        T("auth.checkSpam", "Spam hint", "Check your spam folder too."), T("auth.useOtherEmail", "Use another email", "Use another email"), T("auth.enterSixDigits", "Code missing", "Enter the 6-digit code from the email."),
        T("auth.enterCode", "Banner button", "Enter code"), T("auth.signInToVerify", "Signed out", "Sign in to verify your email.")),
      C("Verify page", T("auth.verifyTitle", "Title", "Verify your email"), T("auth.verifying", "While checking", "Checking your link…"),
        T("auth.verifiedTitle", "Done: title", "Email verified"), T("auth.verifiedText", "Done: line ({email})", "Thanks! {email} is confirmed.", true), T("auth.continue", "Done: button", "Continue to Shubix")),
      C("Banner (not verified yet)", T("auth.verifyBannerCode", "Line ({email})", "Verify your email: enter the code we sent to {email}.", true), T("auth.resend", "Resend button", "Resend link"),
        T("auth.resent", "After resending", "Sent! Check your inbox and spam."), T("auth.verifiedBadge", "My account: verified", "Verified"), T("auth.unverifiedBadge", "My account: not verified", "Not verified"))),
    S("Password help",
      C("As people type", T("auth.showPassword", "Eye: show the password", "Show password"), T("auth.hidePassword", "Eye: hide the password", "Hide password"),
        T("auth.lengthHint", "New password: the rule", "At least 8 characters"), T("auth.strongEnough", "New password: good", "Strong enough"),
        T("auth.match", "Confirm: they match", "Passwords match"), T("auth.confirmPlaceholder", "Confirm: placeholder", "Type your password again"))),
    S("Errors",
      C("Messages", T("auth.badEmail", "Bad email", "Enter a valid email address."), T("auth.shortPassword", "Short password", "Use a password of at least 8 characters."),
        T("auth.noPassword", "No password", "Enter your password."), T("auth.mismatch", "Passwords differ", "The two passwords don't match."))),
  ),
  page(PAGES, "account", "My account",
    S("Page", C("Header", T("nav.myAccount", "Title (also in the menu)", "My account"), T("account.loading", "While loading", "Loading your account…"), T("account.signingIn", "While signing in", "Signing in…"),
      T("account.noAccounts", "Studio without accounts", "This studio runs without accounts, so there is nothing to manage here.")),
      C("Tabs", T("account.tabPassword", "Password", "Password"), T("account.tabSessions", "Sessions", "Sessions"), T("account.tabDelete", "Delete", "Delete"))),
    S("Profile & plan",
      C("Profile card", T("account.manage", "Button on a paid plan", "Manage plan"), T("account.upgrade", "Button on Free", "Upgrade"),
        T("account.freeLine", "Line on Free", "Make Reels free on your phone. Upgrade for Shubix AI, no ads and no watermark.", true)),
      C("Tiles", T("account.statCredits", "Credits left", "Credits left"), T("account.statPlan", "Plan", "Plan"), T("account.statExtra", "Top-up credits", "Top-up credits"),
        T("account.until", "Plan ends ({date})", "Until {date}"), T("account.forever", "Free plan: no end", "Free forever"), T("account.neverExpire", "Top-ups: never expire", "Never expire"),
        T("account.monthly", "Left of this month's plan credits ({n})", "{n} from this month's plan"))),
    S("Settings list",
      C("Rows", T("account.security", "Heading: security", "Security"), T("account.rowPassword", "Change password: line", "Choose a new password for this account"),
        T("account.rowSessions", "Devices: line", "Sign out on every other phone and computer"), T("account.paymentsTitle", "Payments: title", "Payments & receipts"), T("account.rowPayments", "Payments: row line", "Your purchases and receipt numbers"),
        T("account.paymentsNote", "Payments: note", "A receipt for every payment was emailed to you. All purchases are final."), T("account.noPayments", "Payments: none", "No payments yet."),
        T("account.paid", "Payments: paid", "Paid"), T("account.notPaid", "Payments: not finished", "Not completed"), T("account.devices", "Devices: title", "Signed-in devices"),
        T("account.adChoices", "Ad consent button (where the law asks for it)", "Ad privacy choices"), T("account.danger", "Heading: danger zone", "Danger zone"), T("account.rowDelete", "Delete: line", "Remove your account and everything in it"),
        T("account.lookHeading", "Heading: appearance", "Appearance"))),
    S("Password",
      C("Change password card", T("account.changeTitle", "Title", "Change password"), T("account.current", "Current password", "Current password"), T("account.newPassword", "New password", "New password"),
        T("account.confirmNew", "Confirm", "Confirm new password"), T("account.update", "Button", "Update password"), T("account.saving", "While saving", "Saving…"),
        T("account.updated", "After changing", "Password updated. You've been signed out on your other devices.")),
      C("Errors", T("account.errCurrent", "No current password", "Enter your current password."), T("account.errShort", "Too short", "Your new password needs at least 8 characters."),
        T("account.errMismatch", "Passwords differ", "The two new passwords don't match."), T("account.errSame", "Same password", "The new password is the same as your current one."))),
    S("Sessions",
      C("Sessions card", T("account.sessionsTitle", "Title", "Signed in somewhere else?"), T("account.thisDevice", "This device", "This device"), T("account.signedIn", "Badge", "Signed in"),
        T("account.sessionsText", "Line", "Sign out on every other phone and computer. You stay signed in here."), T("account.everywhere", "Button", "Sign out everywhere else"),
        T("account.everywhereDone", "After it", "Done: you're signed out everywhere else."))),
    S("Delete",
      C("Delete account card", T("account.deleteTitle", "Title", "Delete account"), T("account.deleteText", "Line", "Removes your projects, clips and songs. This cannot be undone. Download anything you want to keep first.", true),
        T("account.deleteOpen", "First button", "Delete my account"), T("account.typeEmail", "Type your email ({email})", "Type {email} to confirm"), T("account.yourPassword", "Password", "Your password"),
        T("account.keep", "Keep button", "Keep my account"), T("account.deleteAll", "Final button", "Delete everything"), T("account.deleting", "While deleting", "Deleting…"),
        T("account.errEmail", "Wrong email", "Type your email address exactly to confirm."))),
    S("Appearance",
      C("Appearance card", T("look.title", "Title", "Appearance"), T("look.text", "Line", "How Shubix looks on this device. Every page follows it."),
        T("look.choiceLight", "Light", "Light"), T("look.choiceDark", "Dark", "Dark"), T("look.choiceSystem", "Same as the phone", "Same as my phone"))),
  ),
  page(PAGES, "reels", "My Reels",
    S("Page", C("Header", T("reels.sub", "Line under the title", "Drafts stay on this phone. Saved Reels are kept in your account."), T("reels.drafts", "Tab: drafts", "Drafts"), T("reels.saved", "Tab: saved", "Saved"),
      T("reels.makeReel", "Button: make a Reel", "Make a Reel"))),
    S("Drafts",
      C("No drafts", T("reels.noDrafts", "Title", "No drafts yet"), T("reels.noDraftsText", "Line", "The Reels you make are kept on this phone and show up here.")),
      C("A draft", T("reels.edited", "When edited ({when})", "Edited {when}"), T("reels.open", "Open ({name})", "Open {name}"), T("reels.talking", "Kind: talking", "Talking"), T("reels.deleteDraft", "Delete (hover)", "Delete this draft"), T("common.open", "Menu: open", "Open")),
      C("Delete a draft", T("reels.deleteDraftTitle", "Title ({name})", "Delete “{name}”?"), T("reels.deleteDraftText", "Line", "This draft and its clips are removed from this phone. This cannot be undone."),
        T("reels.delete", "Button", "Delete"), T("reels.deleted", "After it ({name})", "“{name}” was deleted."), T("reels.deleteFailed", "Failed", "That draft could not be deleted. Please try again."))),
    S("Saved",
      C("Space card", T("reels.spaceTitle", "Title", "Your space"), T("reels.space", "Used ({used} of {limit})", "{used} of {limit} Reels"), T("reels.moreSpace", "Link", "More space"),
        T("reels.keepDays", "Kept for ({days})", "Saved Reels are kept for {days} days on your plan; download the ones you want to keep for longer.", true)),
      C("Nothing saved", T("reels.noSaved", "Title", "Nothing saved yet"), T("reels.noSavedText", "Line", "When you export, keep “Save to My Reels” on to keep a finished Reel here, ready to watch, download or share from any phone.", true)),
      C("A saved Reel", T("reels.watch", "Watch ({name})", "Watch {name}"), T("reels.download", "Download", "Download"), T("reels.share", "Share", "Share a link"), T("reels.linkOn", "Link on", "link on"),
        T("reels.copied", "Link copied", "Link copied"), T("reels.downloaded", "Saved to the phone (app)", "Saved to your phone"), T("reels.failed", "Failed", "That did not work. Please try again."),
        T("reels.deleteSavedText", "Delete: line", "It is removed from My Reels in your account. A copy you saved on your phone stays there."))),
  ),
  page(PAGES, "brands", "Brands",
    S("Page", C("Header", T("nav.myBrands", "Title", "My Brands"), T("brands.sub", "Line", "A brand is a look and a set of defaults. Apply it to any project."), T("brands.new", "New brand button", "New brand")),
      C("No brands", T("brands.none", "Title", "No brands yet"), T("brands.create", "Button", "Create brand"))),
    S("Brand list",
      C("A brand", T("brands.colours", "Colours (screen readers)", "Brand colours"), T("brands.captions", "Caption style ({style})", "{style} captions"), T("brands.edit", "Edit button", "Edit")),
      C("Delete a brand", T("brands.deleteTitle", "Title ({name})", "Delete the brand “{name}”?"), T("brands.deleteText", "Line", "Its logo, colours and defaults are removed. Reels already made keep their look."))),
    S("Brand form",
      C("Look", T("brands.details", "Title: editing", "Brand details"), T("brands.newTitle", "Title: new", "New brand"), T("brands.name", "Brand name", "Brand name"), T("brands.namePlaceholder", "Name placeholder", "e.g. My Brand"),
        T("brands.coloursLabel", "Colours", "Colours"), T("brands.main", "Main colour", "Main (captions)"), T("brands.background", "Background colour", "Background"), T("brands.accent", "Accent colour", "Accent")),
      C("Logo & watermark", T("brands.logo", "Logo", "Logo"), T("brands.logoAdded", "Logo added", "Logo added"), T("brands.changeLogo", "Change logo", "Change logo"), T("brands.chooseLogo", "Choose logo", "Choose logo file"),
        T("brands.position", "Position", "Watermark position"), T("brands.opacity", "Opacity ({n}%)", "Opacity · {n}%"), T("brands.showLogo", "Show logo", "Show the logo on every Reel"),
        T("brands.posBR", "Bottom right", "Bottom right"), T("brands.posBL", "Bottom left", "Bottom left"), T("brands.posTR", "Top right", "Top right"), T("brands.posTL", "Top left", "Top left"), T("brands.posC", "Centre", "Center")),
      C("Defaults for new Reels", T("brands.defaults", "Heading", "Defaults for new Reels"), T("brands.style", "Edit style", "Edit style"), T("brands.captionsLabel", "Captions", "Captions"),
        T("brands.language", "Language", "Language"), T("brands.tone", "Script tone", "Script tone"), T("brands.tonePlaceholder", "Tone placeholder", "Warm"), T("brands.more", "More defaults", "More defaults"),
        T("brands.voice", "Voice", "Voice"), T("brands.none2", "None option", "None"), T("brands.pace", "Pace", "Pace"), T("brands.paceCalm", "Calm", "Calm"), T("brands.paceBalanced", "Balanced", "Balanced"), T("brands.paceFast", "Fast", "Fast"),
        T("brands.look", "Brand look", "Brand look (when a project's style is automatic)"), T("brands.cta", "Call to action", "Call to action at the end"), T("brands.ctaPlaceholder", "Call to action placeholder", "Shop the collection"),
        T("brands.music", "Music style", "Music style"), T("brands.musicPlaceholder", "Music placeholder", "Warm acoustic, no vocals")),
      C("Buttons", T("brands.cancel", "Cancel", "Cancel"), T("brands.save", "Save", "Save brand"), T("brands.saving", "While saving", "Saving…"))),
  ),
  page(PAGES, "voices", "Voice profiles",
    S("Page",
      C("Header", T("voices.sub", "Line under the title", "Your own voices for voice-overs: the voice, speed, tone and how words are said."), T("voices.new", "New profile button", "New voice profile"),
        T("voices.loading", "While loading", "Loading your voices…")),
      C("No profiles yet", T("voices.none", "Title", "No voice profiles yet"), T("voices.noneText", "Line", "A profile sets the voice, speed and tone of your voice-overs. Use it in a brand or a Story Reel.", true))),
    S("Your voices",
      C("A profile", T("voices.play", "Play a sample ({name})", "Play a sample of {name}"), T("voices.edit", "Edit", "Edit"), T("voices.delete", "Delete", "Delete"),
        T("voices.deleteTitle", "Delete: title ({name})", "Delete the voice profile “{name}”?"), T("voices.speed", "Speed ({n})", "{n}× speed"))),
    S("Profile form",
      C("Fields", T("voices.formNew", "Title: new", "New voice profile"), T("voices.formEdit", "Title: edit", "Edit voice profile"), T("voices.name", "Name", "Name"),
        T("voices.namePlaceholder", "Name placeholder", "e.g. My Marathi voice"), T("voices.language", "Language", "Language"), T("voices.voice", "Voice", "Voice"),
        T("voices.auto", "Voice: automatic", "Automatic (by language)"), T("voices.noLanguage", "Language without a voice", "This language has no voice yet: the voice-over may use another language's voice."), T("voices.emotion", "Emotion", "Emotion"), T("voices.energy", "Energy", "Energy"), T("voices.pauses", "Pauses", "Pauses"),
        T("voices.speedLabel", "Speaking speed", "Speaking speed"), T("voices.pitch", "Pitch", "Pitch"),
        T("voices.pron", "Pronunciation", "Pronunciation (one per line: written word = how to say it)"), T("voices.save", "Save", "Save voice profile"), T("voices.saving", "While saving", "Saving…"),
        T("voices.note", "Note under the form", "Pitch, energy and emotion are applied as speech prosody by the voice engine.", true))),
  ),
  page(PAGES, "templates", "Templates",
    S("Page", C("Header", T("templates.sub", "Line under the title", "Pick a ready-made Reel, add your clips: the style, look, length and text are done for you."),
      T("templates.search", "Search placeholder", "Search templates"), T("templates.none", "Nothing found ({q})", "No template matches “{q}”."), T("templates.all", "Filter: all", "All"), T("templates.newChip", "Filter: new", "New"),
      T("templates.noneHint", "Nothing found: line", "Try another word, or pick a group."), T("templates.clear", "Nothing found: button", "Clear search"),
      T("templates.count", "Number of templates ({n})", "{n} templates"), T("templates.loading", "While loading", "Loading templates…")),
    C("Header line", T("templates.eyebrow", "Small line above the line", "Shubix · Reel collection")),
    C("Poster tags", T("templates.newTag", "New", "✨ New"), T("templates.kindTalk", "Talking template", "Talk"), T("templates.kindPhotos", "Photo template", "Photos"), T("templates.kindMusic", "Music template without a length", "Music")))),
  page(PAGES, "contact", "Contact us",
    S("Page", C("Header", T("nav.contact", "Title (also in the menu)", "Contact us"), T("contact.title", "Big title", "We're here to help"), T("contact.sub", "Line", "Questions about a Reel, credits or your account."))),
    S("Ways to reach us", C("Cards", T("contact.email", "Email card", "Email"), T("contact.whatsapp", "WhatsApp card", "WhatsApp"))),
    S("Message",
      C("Message form", T("contact.formTitle", "Title", "Send us a message"), T("contact.yourEmail", "Your email", "Your email"), T("contact.message", "Message", "Message"),
        T("contact.messagePlaceholder", "Message placeholder", "How can we help?"), T("contact.send", "Button", "Send"), T("contact.subject", "Email subject", "Help with Shubix"),
        T("contact.opensMail", "Note (old)", "This opens your email app with the message ready. We reply within 3 working days.", true),
        T("contact.yourName", "Your name", "Your name (optional)"), T("contact.namePlaceholder", "Name placeholder", "Riya"), T("contact.topic", "Topic", "What is it about?"),
        T("contact.topic.account", "Topic: account", "Account & sign-in"), T("contact.topic.payment", "Topic: payment", "Payments & credits"), T("contact.topic.reels", "Topic: Reels", "Making Reels"),
        T("contact.topic.rewards", "Topic: rewards", "Invites & affiliates"), T("contact.topic.other", "Topic: other", "Something else"),
        T("contact.paymentHint", "Payment topic hint", "Add your receipt number (from the receipt email) or the payment date and amount, so we can find it quickly.", true),
        T("contact.replyNote", "Note under the button", "We reply by email within 3 working days, usually much sooner.", true)),
      C("After sending", T("contact.sentTitle", "Title", "Message sent"), T("contact.sentText", "Line ({ticket} {email})", "Your ticket is {ticket}. We've emailed a copy to {email} and will reply there soon.", true),
        T("contact.another", "Button", "Send another message")),
      C("Support not set up yet", T("contact.soonTitle", "Title", "Support is being set up"), T("contact.soonText", "Line", "Our support email will be here very soon. Please check back in a little while.", true))),
  ),
  page(PAGES, "legal", "Legal pages",
    S("How to write them", C("Help", T("legal.help", "How to write these pages (not shown)", "“## ” starts a heading, “- ” a list item, a blank line a new paragraph; **bold**, [a link](/refunds). {name}: the business, {reach}: how to reach us, {contact}: email and phone, {business}: name and address.", true))),
    S("Terms of Service", C("Page", T("legal.termsTitle", "Title", "Terms of Service"), T("legal.termsBody", "The page", LEGAL_TERMS, true))),
    S("Privacy Policy", C("Page", T("legal.privacyTitle", "Title", "Privacy Policy"), T("legal.privacyBody", "The page", LEGAL_PRIVACY, true))),
    S("Refund & Cancellation", C("Page", T("legal.refundsTitle", "Title", "Refund & Cancellation Policy"), T("legal.refundsBody", "The page", LEGAL_REFUNDS, true))),
    S("Delete your account", C("Page", T("legal.deleteTitle", "Title", "Delete your account"), T("legal.deleteBody", "The page", LEGAL_DELETE, true))),
    S("About Shubix", C("Page", T("legal.aboutTitle", "Title", "About Shubix"), T("legal.aboutBody", "The page", LEGAL_ABOUT, true))),
    S("Around the pages",
      C("Tabs & footer links", T("legal.about", "About", "About"), T("legal.terms", "Terms", "Terms"), T("legal.privacy", "Privacy", "Privacy"), T("legal.refunds", "Refunds", "Refunds & cancellation"), T("legal.delete", "Delete account", "Delete account"), T("legal.contact", "Contact", "Contact"), T("legal.pricing", "Pricing", "Pricing")),
      C("Details", T("nav.legal", "Phone top bar title", "Legal"), T("legal.updated", "Last updated ({date})", "Last updated {date}"), T("legal.sections", "Sections list (screen readers)", "Sections"),
        T("legal.writeUs", "{contact} with no email set", "write to us from the Contact page"))),
  ),
  page(PAGES, "notfound", "Page not found",
    S("Page", C("Message", T("notFound.title", "Title", "This page is not here"), T("notFound.text", "Line", "The link may be old, or the page has moved. Your Reels and projects are safe."),
      T("notFound.home", "Button", "Go to Home"), T("notFound.make", "Second button", "Make a Music Reel")))),

  // ---------------------------------------------------------------- on every page
  page(EVERY, "nav", "Menu & top bar",
    S("Menu",
      C("Headings", T("nav.studio", "Studio", "Studio"), T("nav.library", "Library", "Library"), T("nav.account", "Account", "Account")),
      C("Links", T("nav.voices", "Voice profiles", "Voice profiles"), T("nav.rewardsLink", "Invite & earn", "Invite & earn"), T("nav.home", "Home", "Home"), T("nav.music", "Music Reel", "Music Reel"), T("nav.talking", "Talking Reel", "Talking Reel"), T("nav.photo", "Photo Reel", "Photo Reel"),
        T("nav.copy", "Copy a Reel", "Copy a Reel"), T("nav.story", "Story Maker", "Story Maker"), T("nav.reels", "My Reels", "My Reels"), T("nav.templates", "Templates", "Templates"),
        T("nav.brands", "Brands", "Brands"), T("nav.pricing", "Pricing & plans", "Pricing & plans")),
      C("Bottom", T("nav.newReel", "New Reel button", "New Reel"), T("nav.adminDashboard", "Phone app menu: the administrators' link", "Admin dashboard"), T("nav.signOut", "Sign out", "Sign out"), T("nav.studioTag", "Tag next to the email", "STUDIO"), T("common.adminDashboard", "Admin dashboard", "Admin dashboard"))),
    S("Top bar",
      C("Titles", T("nav.yourReel", "Editor page", "Your Reel"), T("nav.eyebrow", "Small line above the title", "Shubix · Studio")),
      C("Credits pill", T("nav.credits", "After the number", "credits"), T("nav.creditsHint", "Hover", "Your credits: plans and top-ups"), T("nav.planSuffix", "Plan (“{plan} plan”)", "{plan} plan")),
      C("Header (computers)", T("templates.headerSearch", "Search placeholder", "Search templates, music, effects…"), T("common.account", "Account menu", "Account")),
      C("Buttons (screen readers)", T("common.back", "Back", "Back"), T("common.openMenu", "Open menu", "Open menu"), T("common.closeMenu", "Close menu", "Close menu"), T("common.close", "Close", "Close"))),
    S("Bottom bar (phones)", C("Tabs", T("nav.create", "Create", "Create"), T("nav.more", "More", "More"))),
    S("Notifications", C("Bell", T("bell.title", "Title", "Notifications"), T("bell.new", "Unread ({n})", "Notifications, {n} new"), T("bell.empty", "None", "You're all caught up. Reels you save to My Reels show up here.", true),
      T("bell.open", "A message's link (when it has no button text)", "Open"))),
    S("Look switch", C("Switch", T("look.dark", "Dark", "Dark look"), T("look.light", "Light", "Light look"), T("look.toLight", "Hover: to light", "Switch to the light look"), T("look.toDark", "Hover: to dark", "Switch to the dark look"))),
    S("Help chat (on/off: Admin → Support)",
      C("Button & panel", T("help.button", "Button", "Help"), T("help.open", "Button (screen readers)", "Open the Help chat"), T("help.title", "Title", "Shubix Help"),
        T("help.sub", "Line under the title", "Answers in seconds, any time"), T("help.close", "Close (screen readers)", "Close"), T("help.clear", "Clear", "Clear"),
        T("help.welcome", "First message", "Hi! I'm Shubix Help. Ask me anything about making Reels, credits, plans, payments or your account.", true),
        T("help.placeholder", "Box placeholder", "Ask a question…"), T("help.send", "Send (screen readers)", "Send"), T("help.thinking", "While answering (screen readers)", "Thinking"),
        T("help.contact", "Button to the team", "Contact our team"), T("help.footer", "Note under the box", "AI answers can be wrong. For payments and account problems, contact our team.", true)),
      C("Starter questions", T("help.q1", "Question 1", "How do I make my first Reel?"), T("help.q2", "Question 2", "How do credits work?"),
        T("help.q3", "Question 3", "I didn't get my code"), T("help.q4", "Question 4", "Which plan is right for me?"))),
    S("Install the app",
      C("Banner", T("install.title", "Title", "Get the Shubix app"), T("install.sub", "Line", "full screen, one tap from your home screen"), T("install.button", "Button", "Install"), T("install.notNow", "Close", "Not now")),
      C("Store badges (links: Admin → Settings → Business details)", T("store.title", "Home: title", "Get the Shubix app"), T("store.sub", "Home: line", "Make Reels anywhere: Shubix on Android and iPhone."),
        T("store.playTop", "Google Play: small line", "Get it on"), T("store.play", "Google Play: name", "Google Play"), T("store.appleTop", "App Store: small line", "Download on the"),
        T("store.apple", "App Store: name", "App Store"), T("store.soon", "No link yet", "Coming soon"), T("store.soonShort", "No link yet (small)", "Soon")),
      C("Sidebar", T("install.sidebar", "Button", "Install the Shubix app"), T("install.ios", "iPhone steps", "In Safari, tap the **Share** button, then **Add to Home Screen**. Shubix then opens full screen like any app.", true))),
  ),
  page(EVERY, "plan", "Plan pill & upgrade",
    S("Plan pill",
      C("Pill", T("plan.free", "On Free", "Free"), T("plan.freeUpgrade", "On Free, after the name", "· Upgrade"), T("plan.upgrade", "On Free: the upgrade chip", "Upgrade"), T("plan.plans", "Before sign-in", "Plans"), T("common.planHint", "Hover on Free", "Free plan: see Editor & Pro"),
        T("plan.admin", "For the administrator (everything open)", "Admin · all open"))),
    S("Locked pages", C("Upgrade tag", T("plan.lockTag", "Tag (cards and menu)", "Upgrade"), T("plan.lockHint", "Hover", "In a paid plan: see the plans"), T("plan.lockTagApp", "Tag in the Android app", "Plan"), T("credits.notInPlan", "Android app: a page outside the plan", "This isn't in your current plan."))),
    S("Upgrade banners",
      C("Home banner", T("plan.bannerTitle", "Title", "Go Pro with Shubix"), T("plan.bannerText", "Line", "More templates, premium styles and advanced Shubix edits."), T("plan.bannerButton", "Button", "Upgrade")),
      C("Sidebar card", T("plan.bannerTitleSmall", "Title", "Upgrade to Pro"), T("plan.bannerTextSmall", "Line", "Premium templates & Shubix edits"))),
    S("Shubix AI card",
      C("Card", T("plan.aiAdTitle", "Title", "Let Shubix AI edit your Reels"), T("plan.aiAdText", "Line ({price}: the first paid plan)", "The best moments, transitions and captions picked for you, no ads, no watermark · Editor from {price}/month"),
        T("plan.aiAdButton", "Button", "See plans")),
      C("Above an ad", T("plan.adLabel", "Label", "Ad"), T("plan.removeAds", "Link", "remove ads")),
      C("Watch an ad for credits (phone app, Credits page)", T("ads.rewardTitle", "Title ({n}: credits)", "Watch an ad, get {n} free credits"),
        T("ads.rewardSub", "Line ({n}: a day)", "A short video ad. Up to {n} times a day."), T("ads.rewardWatch", "Button", "Watch ad"),
        T("ads.rewardLoading", "Button while loading", "Loading ad…"), T("ads.rewardDone", "After the ad ({n})", "Thanks! {n} credits are on their way."),
        T("ads.rewardNone", "No reward", "No ad right now, or it was closed early. Try again later.")),
      C("Invite card (in an ad spot without AdSense)", T("plan.inviteAdTitle", "Title", "Invite friends, earn credits"),
        T("plan.inviteAdText", "Line", "Share your link: your friend gets free credits, and so do you."), T("plan.inviteAdButton", "Button", "Invite & earn"))),
    S("Not enough credits",
      C("Dialog", T("plan.noCreditsTitle", "Title", "Not enough credits"), T("plan.noCreditsText", "Line", "Top up or choose a plan to keep making Reels."),
        T("plan.noCreditsButton", "Button", "See plans & top-ups"), T("plan.noCreditsLater", "Close", "Not now"))),
  ),
  page(EVERY, "common", "Messages & dialogs",
    S("Dialogs", C("Confirm", T("common.cancel", "Cancel", "Cancel"), T("common.ok", "OK", "OK"))),
    S("Errors", C("Error card", T("common.connecting", "Checking who is signed in", "Connecting to Shubix…"), T("common.offline", "The server cannot be reached", "Shubix can't be reached right now. Check your internet and try again."), T("common.pageBroke", "A page that broke: title", "Something went wrong"), T("common.pageBrokeText", "A page that broke: line", "We have been told about it. Please try again."), T("common.error", "Title", "Please check"), T("common.retry", "Button", "Try again"), T("studio.failed", "Studio could not start", "The editor could not start"))),
    S("Files", C("File drop", T("common.chooseFiles", "Button", "Choose files"), T("common.more", "More actions menu", "More actions"))),
    S("Admin-only pages", C("Notice", T("common.adminOnly", "Label", "Admin only"), T("common.adminTitle", "Title", "This page is for the administrator"),
      T("common.adminText", "Line", "Please sign in with an admin account to continue."), T("common.adminSignIn", "Button", "Admin sign-in"))),
    S("Pages turned off", C("Notice", T("common.offTitle", "Title ({page})", "{page} is turned off"), T("common.offText", "Line", "The studio's administrator has switched this part of the app off. Everything else works as usual.", true),
      T("common.backHome", "Button", "Back to Home"), T("common.offAdmin", "Note to the admin ({page})", "{page} is turned off for everyone else. You see it because you are the administrator."))),
  ),

  // ---------------------------------------------------------------- plans & payments
  page(PLANS, "checkout", "Payment window (Razorpay)",
    S("Payment window", C("Look", T("checkout.name", "Business name at the top", "Shubix"),
      T("checkout.logo", "Logo (a square picture: a link, or /icon-512.png from this site)", "/icon-512.png"), T("checkout.color", "Colour (#rrggbb)", "#d8bd7b")),
      C("Phone app", T("checkout.needsApp", "Paying in Expo Go (it has no Razorpay)", "Payments work in the Shubix app from the Play Store. Here (Expo Go) you can look around, but not pay.")))),
];

export const TEXT_DEFAULTS: Record<string, string> = Object.fromEntries(TEXT_GROUPS.flatMap((g) => g.items.map((t) => [t.key, t.value])));
export type Texts = Record<string, string>;

/** A text with its `{name}` parts filled in. */
export const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);
