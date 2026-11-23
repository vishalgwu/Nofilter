# RoastCast

**A live AI voice that makes people laugh while they play.**

RoastCast is a web app that listens to a player or streamer in real time and answers, within a few seconds, with a funny, well-timed roast spoken in a cast of different AI voices.

> **Status:** Planning. The repository currently contains only the project plan ([RoastCast_Project_Plan.pdf](RoastCast_Project_Plan.pdf)). Everything below describes the intended design, and all speed figures are planning targets, not measurements.

## Run it locally (Stage 1, Days 1-2)

Requires Node.js 20.6 or newer.

1. Copy `.env.example` to `.env` and fill in `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` and `DEEPGRAM_API_KEY`.
2. Install the one dependency (`ws`) and start the server:

   ```
   npm install
   npm start
   ```

3. Open http://localhost:3000.
   - **Type a moment** (or pick a chip), choose a roast level and press **Roast me**, or
   - press **Start listening**, allow the microphone, and just play. Use headphones so the roast does not hear itself.

Run the detector tests with `npm test`.

**Day 1:** typed moments, the roast writer (OpenAI, 15 words max), a streamed voice (ElevenLabs, with OpenAI TTS as fallback), the mic permission and level meter, and a per-roast speed log written to `data/timing-log.jsonl`.

**Day 2:** the live loop. Mic audio is captured in an AudioWorklet (16 kHz, 100 ms chunks), streamed over a WebSocket to the server, and relayed to Deepgram (`nova-3`) for live captions. A moment detector in the browser (`client/detector.js`) watches loudness and words and decides when to roast:

| Moment | Heard as | Cooldown |
| --- | --- | --- |
| Scream | about 300 ms of sustained loud audio | 10 s between roasts |
| Crash | a short, sharp, near-clipping spike that dies away | |
| Silence | 8 s of quiet | |
| Speech | a spoken line of 4+ words, once the player stops talking | |

The detector pauses while a roast is playing, so RoastCast never roasts its own voice. The last 30 seconds of speech go into the prompt as context.

**Day 3:** the humor. The roast writer is built from a written humor guide ([humor/guide.md](humor/guide.md): voice, the six ingredients, the three levels, the hard rules) and 30 hand-written example roasts ([humor/moments.json](humor/moments.json): 5 for each of crash, scream, silence, lucky win, rage quit and panic, each with its own joke shapes). Every moment is classified into one of those types (or "general"), so a crash and a long silence get different kinds of jokes. For each moment the model writes **three candidates in one call**, anything over 15 words (or lifted from the examples) is dropped, and a quick **pick step** chooses the funniest. The server remembers the session's earlier moments and roasts, so callbacks ("third time in the ocean") can happen. The page shows all three takes and which one won.

**Day 4:** speed. Every roast is timed step by step (`data/timing-log.jsonl`), and `npm run speed` turns the log into the speed table ([docs/speed-table.md](docs/speed-table.md)). What changed:

- **Fast lane.** The moment a roast is triggered, an instant reaction sound (gasp, oooh, laugh, crickets...) plays from memory while the roast is still being written. The ten sounds in `client/sounds/` are made by `scripts/make-sounds.mjs` with ElevenLabs sound effects.
- **Self-pick.** The writer now writes three takes *and* picks its own best in one call, instead of a second judge call. The judge version is still available as `?mode=best` for comparison. A **Quick** style (one roast) is available in the page.
- **Voice starts early.** The server starts the text-to-speech request as soon as the roast text exists, so it overlaps the trip to the browser, and replays are served from memory.
- **Warm start.** The server resolves the voice and opens connections on startup, and the page triggers the same on load.
- **Measured and rejected:** streaming text into ElevenLabs over a WebSocket (first audio was slower than plain HTTP), prompt caching (cached 90% of the prompt but changed latency by about 2%), a keep-alive HTTP agent (no measurable gain), and a different small model (no faster).

Measured with 37 roasts through the real page (median, from the trigger to the first word of the roast):

| Style | Roast starts speaking (p50) | p90 |
| --- | --- | --- |
| Quick (one roast) | 0.76 s | 1.00 s |
| Best of 3, self-pick (default) | 1.02 s | 1.26 s |
| Best of 3 + separate judge (Day 3) | 1.39 s | 1.57 s |

The biggest remaining delay is not the roast: when you talk, it takes about 0.7 s (median, only 4 samples) after your last word before RoastCast decides you have finished.

**Day 5:** testing with friends. The full plan is in [docs/day5-test-guide.md](docs/day5-test-guide.md): 10 friends, 3 sessions each, every roast scored 0 to 3. What was added to make that work:

- **Tester mode.** Open the page with `?test=1`: a Tester box and a session counter appear, and every roast and score is logged under that name and session. Every roast in the session list has its own 0-3 buttons.
- **`npm run laughs`.** Turns the log into the laugh report: the Stage 1 check (average 2.0 or more, 90% of roasts under 3 s), scores by moment type, level, style and tester, and the weakest type with its best and worst roasts. `--winners` saves every score-3 roast for Stage 3 training, `--write` saves `docs/laugh-report.md`.
- **Sharing safely.** With `ACCESS_CODE` set in `.env`, the API and the microphone only work for people who opened the link ending in `?code=...`. Roasts are capped at 20 a minute and open microphones at 5 (`MAX_ROASTS_PER_MIN`, `MAX_MICS`).
- **Cliche filter.** Roasts that use the stock phrases the humor guide bans ("official ceremony", "filed a complaint", "masterclass", ...) are dropped in code when a fresher take is available.

**Day 6 (Stage 2 begins): the voice cast.** Instead of one voice there are now four characters plus the original, all defined in [humor/cast.json](humor/cast.json):

| Character | Voice (ElevenLabs) | How it talks | Speaks for (in Auto) |
| --- | --- | --- | --- |
| The Announcer | Daniel | breathless play-by-play ("folks", "And he's...") | crash, panic |
| Tired Friend | Roger, slowed and flattened | flat, ten words at most, opens with "Great." / "Cool." | silence |
| Hyper Kid | Jessica, sped up | "whoa", "no way", exclamation marks | scream, lucky win |
| Grandma | Lily, slowed and steadied | "oh dear", "sweetheart", "bless your heart" | rage quit |
| Classic | Adam | the original single voice (for side-by-side tests) | only when picked |

What each character has: a voice chosen from your account by name (falling back to matching labels, so a different account still works), its own voice tuning (speed and expressiveness), its own **writing style** so the words match the voice, a "signature" of words it must use (checked in code, so a roast that is not in voice loses to one that is), and an OpenAI fallback voice with acting direction if ElevenLabs fails. In **Auto**, the moment decides who speaks, and free text rotates through the cast without repeating. The page has a voice picker (clicking a character plays a sample of its voice), a "speaking as" tag, and a ring that takes on the character's colour. The laugh report now has a **By voice** table, which is how Stage 2 gets judged against Classic.

Honest limits: your ElevenLabs account has no child or elderly voices, so the Kid and Grandma are existing voices tuned to fit. Real custom voices would come from ElevenLabs Voice Design (it adds voices to your account, so it is not done automatically). To hear every character write the same moment, run `npm run eval -- --cast`; to re-record the picker samples after changing a voice, run `node --env-file=.env scripts/make-cast-samples.mjs --force`.

**Day 7 (Stage 2): the sound bank and the layered mixer.** A roast is now a small score instead of one sound:

| When | Layer | Example |
| --- | --- | --- |
| 0 ms (the instant it is triggered) | an opening sound | tire screech, gasp, drum roll, record scratch |
| about 300 ms | a one-word interjection from **another** character than the one speaking the roast | the Kid's "Whoa!" before the Announcer's punchline |
| with the roast | an optional quiet bed (a silence gets tumbleweed) | tumbleweed under the Tired Friend |
| just after the last word | a sting, for about 7 roasts in 10 | rimshot, sad trombone, air horn, crowd laugh |

- **The sound bank** ([client/soundbank.js](client/soundbank.js)): 24 effects and 14 interjections, each tagged by moment type, level (gentle sounds soft, savage sounds big) and role (open, sting, bed). The picker never repeats the same sound twice in a row. Effects are made with `node --env-file=.env scripts/make-sounds.mjs`, interjections (recorded in each character's own voice) with `scripts/make-voice-lines.mjs`; the mp3 files in `client/sounds/` and `client/voices/` are committed.
- **The mixer** ([client/mixer.js](client/mixer.js)): schedules layers on the Web Audio timeline. The first layer always starts at time zero, so layering cannot delay the first sound, and the opening layers fade out the moment the roast voice arrives rather than talking over it. Listening resumes only after the sting has finished, so the microphone never hears our own effects.
- **The page** shows exactly what layered into each roast (for example `Drum roll > Grandma: "Bless." > Roast: Hyper Kid > Record scratch`), and has a **Sound layers** switch. With it off you get just the single Day 4 reaction, which is how layered and plain roasts get compared. The laugh report has a **By sound** table for that comparison.
- **Speed:** layering costs nothing measurable. In warm runs the browser's voice time was the same with and without layers (246 vs 250 ms), and every roast started in under 3 s.
- **A bug found and fixed:** the leveling step used on the Day 4 reaction sounds (`ffmpeg loudnorm`) silently cut 1.2 s clips down to 0.8 s and left no fade-out. `scripts/audio-polish.mjs` now levels with a plain gain, limits peaks, fades the end, and refuses to keep any file that comes out shorter. The old reactions were re-leveled with it (`make-sounds.mjs --repolish`, free).

To tune the humor, edit the guide or the examples and run `npm run eval`, which prints every candidate and the pick for a spread of moments. Real quality is measured with friends' laugh scores (Day 5), which the page logs to `data/timing-log.jsonl` with the candidates.

## What success looks like

- A stranger opens the link, plays for two minutes, and laughs out loud at least once.
- The first spoken reaction arrives in under 3 seconds, and in under 1.5 seconds where possible.
- A short clip of the roast is funny enough that people post it themselves.
- The project shows real-time voice engineering: speed numbers, a humor quality score, and a clear build story.

## The experience

1. **Open the page.** Press one button to start listening, and pick a roast level: Gentle, Spicy or Savage.
2. **Play.** The page hears the player and the game through the microphone or the stream audio.
3. **Something happens.** A scream, a crash, a long silence, a panic, a lucky escape, a rage quit.
4. **A reaction lands.** A quick sound within a second (a gasp, a laugh), then the roast itself in a character voice.
5. **Running jokes build.** The roaster remembers what happened five minutes ago and brings it back later.
6. **Share.** One tap saves the last 30 seconds as a short clip with the roast audio and captions.

### Where it runs

| Surface | Role | When |
| --- | --- | --- |
| Web page | The core product. Works on any phone or laptop. | Stage 1 |
| Stream overlay (OBS browser source) | Same page, shown on stream so viewers hear the roast. | Stage 1 to 2 |
| Chrome extension | Adds the roaster to any stream a viewer is watching. | After Stage 3 |

## Humor design

The gap between what happened and what the roaster says is the whole project, so the humor gets its own design.

**Six ingredients of a good roast**

| Ingredient | Meaning | Example |
| --- | --- | --- |
| Specific | Mentions the exact thing that just happened | "You braked for a pigeon and hit a bus." |
| Short | Under 15 words | "Parking like a raccoon with a license." |
| Exaggerated | Takes the real moment one step too far | "That escape plan had the energy of a toddler hiding behind a curtain." |
| Callback | Brings back an earlier moment from the session | "Third time in the ocean. Is the car a boat now?" |
| Rule of three | Two normal beats and a surprise | "Fast, loud, and completely lost." |
| Warm underneath | Teases the play, never the person | "Brave. Wrong, but brave." |

**Roast levels:** *Gentle* (friendly teasing), *Spicy* (sharper, more exaggeration, still playful), *Savage* (big, theatrical, aimed at gameplay only).

**How humor is built and tested**

- **Humor guide:** one page holding the voice, the six ingredients, and 30 hand-written example roasts.
- **Moment types:** each detected moment (crash, scream, silence, lucky win, rage quit, panic) gets its own joke shapes.
- **Generate several, pick one:** the model writes three candidates fast; a pick step chooses the funniest and shortest.
- **Laugh score:** test sessions end with a friend rating (0 to 3), logged next to each roast. This is the main quality metric.
- **Keep the winners:** roasts that score 3 feed the example set and later become training data.

## Live pipeline

Eight steps run as one continuous stream, so no step waits for the previous one to finish:

1. **Audio in** – capture mic and game audio in ~100 ms chunks.
2. **Listen** – detect speech, screams, laughter, loud bangs and silence; decide if a moment is worth a roast.
3. **Transcribe** – streaming speech-to-text with partial words.
4. **Context** – last 30 seconds, persona, roast level and running jokes combined into one short prompt.
5. **Roast writer** – a fast LLM streams a roast of at most 15 words, shaped by moment type.
6. **Chunker** – the first complete phrase goes to voice immediately.
7. **Voice cast** – text-to-speech in the chosen voice, mixed with laughs, screams and effects.
8. **Output** – plays in the browser or stream overlay and records the clip for sharing.

A **fast lane** plays an instant pre-made reaction (gasp, "ooooh", laugh) within about half a second while the roast is still being written.

### Speed budget (planning targets)

| Step | Target |
| --- | --- |
| Audio chunk and moment detect | 100–200 ms |
| Speech to text | 200–400 ms |
| Build the prompt | < 50 ms |
| Roast, first phrase | 300–700 ms |
| Voice, first audio | 200–400 ms |
| Play back | 50–100 ms |
| **Total to first sound** | **~1–2 s (hard ceiling: 3 s)** |

Speed tricks: stream everything, start early on detected moments, fast lane reactions, short roasts, warm connections opened at session start, pre-written roasts during quiet moments, and a timestamp logged at every step.

## Roadmap

### Stage 1: Funny roasts, fast
Listening page, moment detector, roast writer, one default voice, humor guide, speed log and fast lane.
**Done when:** average laugh score ≥ 2/3 and 90% of roasts start speaking in under 3 seconds (tested with 10 friends, 3 sessions each).

### Stage 2: Voice cast and sound mixing
Four or five tuned character voices (e.g. dramatic announcer, tired sarcastic friend, over-excited kid, calm grandma), voice-per-moment selection, layered multi-voice audio with a simple mixer, a tagged sound bank, and user character switching.
**Done when:** testers prefer the cast over the single voice and layered roasts still start in under 3 seconds.

### Stage 3: Fine-tune and re-check speed
Curate high-scoring roasts from Stages 1–2, add strong-model-generated roasts that pass the laugh test, fine-tune a small model, and compare prompted vs. fine-tuned on laugh score, time to first sound, and cost per hour.
**Done when:** the fine-tuned model matches the laugh score and cuts latency or cost enough to show in the results table.

## Execution plan (14 working days)

| When | Task | Output |
| --- | --- | --- |
| Day 1 | Project setup, browser audio capture, default voice, roast from a typed moment | Page that speaks a roast on a button press |
| Day 2 | Streaming STT, moment detector, end-to-end wiring | Live loop: speak, hear a roast |
| Day 3 | Humor guide, 30 examples, moment types, three candidates and pick step | First funny version |
| Day 4 | Streaming everywhere, fast lane, warm connections, timing log | Speed table with real numbers |
| Day 5 | Friend testing, laugh scores, fix weakest moment types | Stage 1 complete, demo clip v1 |
| Days 6–8 | Voice cast, sound bank, layered mixer | Multi-voice roasts |
| Days 9–10 | Voice picker, character switch, side-by-side test, stream overlay link | Stage 2 complete, demo clip v2 |
| Days 11–13 | Training set, fine-tune small model, comparison | Results table: laugh, speed, cost |
| Day 14 | Final speed run, clean up, build story, publish | Launch |

### Metrics tracked from day one

| Metric | Target |
| --- | --- |
| Time to first sound (median) | < 1.5 s |
| Time to first sound (p90) | < 3 s |
| Laugh score (0–3) | ≥ 2 on average |
| Roast length | ≤ 15 words |
| Cost per hour of use | Tracked in Stage 1, improved in Stage 3 |

### Planned deliverables

- A live link anyone can open and try.
- A 30–60 second video of the best roasts with voices and layered sounds.
- A write-up with the speed table, laugh scores and Stage 3 comparison, plus the code repository and humor guide.

## Guiding principle

People laugh. Every decision is judged by one question: *did that make the roast funnier or faster?* If a change does neither, it waits.

## License

Licensed under the [Apache License 2.0](LICENSE).
