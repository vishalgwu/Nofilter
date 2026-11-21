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
