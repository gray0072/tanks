# 11. Audio

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

WebAudio, synthesized at runtime (no shipped samples): fire, ricochet, brick crumble, steel clang,
explosion, spawn, bonus pickup, team bonus fanfare, flag hit alarm, match end. Ducking so a
`GRENADE` doesn't blow out the mix. Muted by default on mobile until first interaction (autoplay
policy), with a clear unmute affordance. Music is a single low-key loop, off by default.

> **As implemented:** the `AudioContext` is created on the first match, never on page load, and is
> **suspended 2 s after a match screen unmounts** (long enough for the match-end fanfare) and
> resumed by the next match — an idle but running context keeps the output device open, which some
> drivers answer with a faint hiss or crackle. Every cue starts with a 4 ms attack instead of
> jumping straight to full gain: a waveform that starts mid-swing is a click. `GRENADE`'s blast has
> its own cue (`grenadeBlast`), ducked under the mix.
