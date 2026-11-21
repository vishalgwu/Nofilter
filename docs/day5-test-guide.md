# Day 5: test with friends

Stage 1 is finished when two numbers are true:

1. **The average laugh score is at least 2 out of 3.**
2. **90% of roasts start speaking in under 3 seconds** (already true in the Day 4 measurements; Day 5 re-checks it with real people).

The plan: **10 friends, 3 sessions each**, every roast scored 0 to 3 by the person who heard it.

## 1. Before the first friend arrives

- [ ] `npm test` passes, then `npm start`.
- [ ] Open **http://localhost:3000/?test=1** and run one roast yourself. The dashed **Tester** bar should appear.
- [ ] Headphones for whoever is playing (otherwise the roast gets heard by the mic and the detector pauses itself, which makes sessions feel broken).
- [ ] A quiet room, and a game or a funny video ready.
- [ ] Check your ElevenLabs credits. About 300 roasts is roughly 18,000 characters of speech. If credits run out, the voice switches to OpenAI automatically, but the voice will change mid-test, so top up first if you can.

## 2. Two ways to run it

**A. In person, on your laptop (simplest, nothing is shared).** Each friend sits at your laptop, opens `?test=1`, types their name in the Tester box and goes. The microphone works on `localhost`.

**B. Friends at home.** Microphones need HTTPS, so you need a tunnel. This puts your app on the internet, and your API keys pay for everything a visitor does, so do all three of these:

1. Put a secret in `.env`: `ACCESS_CODE=pick-something-long` and restart the server. Without the code the API and the microphone refuse to work.
2. Start a tunnel to port 3000 (for example `cloudflared tunnel --url http://localhost:3000`, or ngrok). It prints an `https://...` address.
3. Send each friend: `https://<tunnel-address>/?code=<your code>&test=1`. The first visit stores a cookie and removes the code from the address bar.

Built-in limits protect your bills: 20 roasts per minute and 5 open microphones at once (change them with `MAX_ROASTS_PER_MIN` and `MAX_MICS`). **Stop the tunnel and remove `ACCESS_CODE` when testing is over.** Do not post the link publicly.

## 3. The three sessions (about 10 minutes each)

| Session | What the friend does | Why |
| --- | --- | --- |
| 1. Warm up | Pick the quick moments (Crash, Scream, Silence, Lucky win, Rage quit, Panic), then type one of their own. Try all three levels. 6 to 8 roasts. | Cheap, covers every moment type and level. |
| 2. Live play | Press **Start listening** and play a game (or do the voice acting for one) with headphones on. Let it auto-roast. | Tests the real thing: the mic, the detector, the timing. |
| 3. Watching | Watch a funny video or someone's stream with **Start listening** on, or just chat with friends in the room. | Tests the quiet and chatty cases and the callbacks. |

After a session press **New session**. The counter goes up and the roaster forgets the earlier jokes, like a fresh group would.

Mix it up across friends so no level or style is under-tested: friends 1 to 3 start on Gentle, 4 to 7 on Spicy, 8 to 10 on Savage; and use **Best of 3** for the first 5 friends and **Quick** for the other 5. The report groups by level and style, so you can see which works better.

## 4. What to tell each friend (copy and paste)

> This is a talking AI that roasts you while you play. Put on headphones, type your name in the Tester box, and press Start listening (or pick a moment). After **every** roast, tap a number under it:
> **0** nothing, **1** a smile, **2** a real laugh, **3** laughed out loud.
> Be honest. A low score helps me more than a polite one. It teases how you play, never who you are. If it ever goes too far, tell me.

You tap the number only if the friend can't, and never choose for them. Roasts left unrated are counted in the report as "unrated" and do not count toward the average.

## 5. After every few friends: read the results

```powershell
npm run laughs
```

The report shows the Stage 1 check, laugh score by **moment type** (weakest first), level, style and tester, and names the weakest type with its worst and best roasts. Add `--write` to save it to `docs/laugh-report.md`. Rows without a tester name are ignored unless you add `--all`.

## 6. Fix the weakest moment type, then retest

1. Run `npm run laughs` and read **Fix this first**.
2. Open `humor/moments.json` and find that type. Replace its weakest examples with roasts that scored 3 (from the report or `--winners`), and rewrite its three joke shapes in the spirit of what got laughs.
3. Run `npm run eval` to read what the new version writes. Re-run until it sounds right to you.
4. Restart the server and give the same moment type to 2 or 3 friends.
5. Compare: `npm run laughs -- --since 2026-11-22T14:00:00Z` (use the time you made the change) shows only the newer roasts.

A type needs at least 3 ratings before the report will call it the weakest, so one unlucky roast cannot send you the wrong way.

## 7. Save the winners

```powershell
npm run laughs -- --winners
```

This writes every roast that scored 3 to `data/winners.jsonl`. They feed the example set now and become the training data in Stage 3. The file is not committed (the whole `data/` log folder is ignored by git), because it holds your friends' names and what they typed.

## 8. Demo clip v1 (30 to 60 seconds)

Ask each friend before you record their face or voice.

| Time | Show | Notes |
| --- | --- | --- |
| 0 to 5 s | The page, then the line "Say something. Get roasted." | A title card works too. |
| 5 to 20 s | **Live mic.** Scream or crash at the game: the reaction sound plays instantly, then the roast arrives with its words on screen. | This is the money shot. Capture the screen **and** the computer's audio. |
| 20 to 35 s | **Speech.** Say something dramatic and get roasted for it, ideally with a callback to an earlier moment. | Pick from your score-3 roasts. |
| 35 to 50 s | A friend laughing (with permission). Then the **Roast starts** number and the laugh average on screen. | The proof: fast and funny. |
| 50 to 60 s | End card: the project name and where to try it. | |

Record with OBS, or Windows Game Bar (`Win + G`). If you record with speakers instead of headphones, the roast will leak into the mic, so use "desktop audio" in OBS instead.

## 9. Done when

- [ ] 10 friends, 3 sessions each (the report shows the count)
- [ ] Average laugh score 2.0 or more (`npm run laughs`)
- [ ] 90% of roasts start in under 3 s (same report)
- [ ] The weakest moment type was rewritten and retested
- [ ] Score-3 roasts saved with `--winners`
- [ ] Demo clip v1 recorded

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Type your name in the Tester box first" | Test mode needs a name so ratings are saved under it. |
| "Access code needed" | Open the full link you were sent, the one ending in `?code=...`. |
| "Slow down a little" | More than 20 roasts in a minute. Wait a moment. |
| "Too many microphones are open" | 5 people are listening at once. Try again shortly. |
| It roasts itself over and over | The mic hears the speakers. Use headphones. |
| No captions appear | Check the Deepgram key and that the page status says Ready. |
| The voice changed halfway | ElevenLabs credits ran out and OpenAI took over. |
