// Fast lane: an instant pre-made reaction (gasp, oooh, laugh...) that plays the moment a
// roast is triggered, while the roast itself is still being written. Pure data + helpers,
// so it can be tested in Node. The browser preloads the files and plays them from memory.

// name -> sound-effect prompt (used by scripts/make-sounds.mjs). Files: client/sounds/<name>.mp3
export const SOUNDS = {
  gasp1: 'a short surprised gasp from a small crowd, quick',
  gasp2: 'a single person gasping in shock, short',
  ooh1: 'a crowd saying ooooh together after something embarrassing, short',
  ooh2: 'a small group going oooh playfully, short',
  laugh1: 'a loud burst of amused laughter from one person, short and clear',
  laugh2: 'a brief sitcom studio audience laugh',
  crickets: 'crickets chirping in an awkward silence, brief',
  cheer: 'a small crowd cheering and clapping briefly',
  aww: 'a small crowd going aww sympathetically, short',
  nervous: 'a short nervous awkward laugh',
};

// moment type -> which reactions fit it (one is picked at random each time)
export const REACTIONS = {
  crash: ['gasp1', 'ooh1'],
  scream: ['gasp2', 'laugh1'],
  silence: ['crickets'],
  lucky_win: ['cheer', 'gasp1'],
  rage_quit: ['ooh2', 'aww'],
  panic: ['gasp2', 'nervous'],
  default: ['laugh2', 'ooh2'], // speech, typed and anything else
};

// Pick a reaction for a moment type, never the same one twice in a row.
export function pickReaction(type, last = null, rand = Math.random) {
  const pool = REACTIONS[type] || REACTIONS.default;
  const options = pool.length > 1 ? pool.filter((n) => n !== last) : pool;
  return options[Math.floor(rand() * options.length)];
}
