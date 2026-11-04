# Create a Reel: popup flow, acceptance criteria

These rules are the same on the website (computer and phone) and the Android app. Android and the website have separate code, so a change here is made in both places.

Status of each rule on each platform is at the end of this file.

## 1. Popups

- There are no toasts. A success says nothing, because its result is on the screen. An error or a notice is a popup with OK.
- All work runs in one big popup at the centre of the screen, with a live checklist: song, beats, clips, Shubix AI.
- Compress progress shows inside that same popup, never in a second window.
- The page behind a popup is frozen and cannot scroll.
- A popup closes only by its buttons. A click outside does not close it. The phone's back acts as Cancel, and does nothing once Cancel is off.
- The popup never scrolls. Its buttons are in one row. A long name stays on one line and is cut with `…`. Long button words wrap inside the button.
- The popup stays away from the screen's edges at every size.
- There is no separate "Analysing" page on any screen size.

## 2. Song and clips

- Adding a song or clips opens the popup with Cancel and Cancel Reel.
- Cancel deletes nothing. The song and every video stay, and the video count never grows.
- After Cancel, Next asks "Analysis not done" with Cancel, Proceed and Cancel Reel.
- Proceed goes on from where it stopped: clips already read are not read again, and an analysed song only finishes its beat check.
- Cancel Reel asks once, removes everything for this Reel and goes Home.
- Next and Generate are off without a song and clips, and while either is being worked on. After a Cancel, Generate says "Continue analysis" and only offers Proceed.
- Each clip plays in its own card, muted and looping, once the work is over. There is no play button. Only cards on the screen play, and only a few at once, so a phone does not run out of memory. Cards do not play during Shubix AI or in the editor.
- A clip is moved by dragging it: at once with a mouse, after holding it a moment with a finger. A quick swipe still scrolls. There is no arrow and no Reverse order. The Reel and the numbers follow the new order.

## 3. Shubix AI and credits

- Next shows Shubix AI's popup with the credits it uses and what is left. Proceed shows each step live, such as "clip 2 of 10".
- Editor and Pro cannot go on without Shubix AI. A plan without Shubix AI chooses Free or Upgrade.
- Cancel works until the AI's first answer. After that Cancel is off and the popup says it cannot be cancelled.
- Credits are taken after the AI answers, so a cancel before that takes nothing.
- The editor opens only after Shubix's plan has arrived.
- Shubix Edit's lines show no ticks before Generate.

## 4. Changes after a Reel is made

Every new Reel from Shubix AI costs credits. Shubix AI never runs by itself on changed clips or a changed song.

| The person | What happens | Credits |
|---|---|---|
| Goes back and changes nothing, then Next | The same Reel opens, with no popup | None |
| Changes video, audio, part or order, then Next | Asks "Make a new Reel with these changes?" | None yet |
| Says no | The old Reel opens, exactly as it was | None |
| Says yes | Shubix AI's popup opens | None yet |
| Says yes, then Use | A new Reel is made | Charged again |
| Says yes, then closes Shubix AI's popup | The old Reel opens, exactly as it was | None |
| Cancels before the AI's first answer | Nothing changes, and Next asks again | None |

While the inputs differ from the Reel that was made, the changes are not saved over that Reel.

- On the website, a change inside the editor is asked straight away, in the same way.
- Once a Reel has its plan, Shubix AI plans again only through Make new Reel or the chat, which have their own charges. A style change does not re-run it.
- The server decides too: other footage or another plan under the same Reel id, after its plan was delivered, takes a new charge. A retry of the same work does not.

## 5. Steps and Back

- On a computer one section is open at a time. Music is open first and Clips is minimised.
- When the song and beat check are done, Music minimises with a green tick and the song's name. Clips opens and the page goes there.
- When the clips are done, Clips minimises with a tick and the page goes to Shubix Edit.
- A section's head, or a finished or current step at the top, opens that section.
- Done steps are green with a tick on every platform.
- Back only ever goes back, including on a Reel opened part way and after a reload.
- Going Back from the editor to the clips and on again keeps the timeline.
- Next on Music never jumps the page to the top on a computer.

## 6. Editor (website)

- The header has no Reel Studio or saved line. The Reel's name is not cut.
- The ratio is in the header only. On a computer Ask Shubix is in the header only, with no floating button.
- On a computer the preview takes most of the screen's height with its controls in view. On a phone it takes the card's width.
- The time and the play button never touch. Under 340 px wide, Mix Video shows only its icon and full view stays visible.
- A tool's sheet has no empty space under Done.
- Buttons show the hand cursor, and a button that is off shows not-allowed and takes no click.

## Status

| Part | Website | Android |
|---|---|---|
| 1. Popups | Tested in the browser | Built, not run on a phone |
| 2. Cancel and Proceed | Tested in the browser | Engine tested, screens not run on a phone |
| 2. Clips play in their cards | Tested in the browser | Built, not run on a phone (the first 4 clips play) |
| 2. Drag to move a clip | Tested in the browser | Built, not run on a phone |
| 3. Shubix AI and credits | Tested with a fake AI | Engine tested, screens not run on a phone |
| 4. Changes after a Reel is made | Tested with a fake AI | Engine tested, screen not run on a phone |
| 5. Steps and Back | Tested in the browser | Green steps built; accordion is computer only |
| 6. Editor | Tested in the browser | Header line removed, the rest is website only |

Not yet tested anywhere: the real AI and real credits, a 4K compress, and a full export after these changes.
