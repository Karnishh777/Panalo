# "Origin" — recording the voice-over and filming the plates

The first-entry film (`students/js/film.js`) is complete on its own: it draws
every shot, grades it, and scores it. Two things can be added from outside:

- **Voice-over**: six recorded lines (e.g. made with ElevenLabs).
- **Video plates**: three background clips (e.g. made with Google Flow / Veo)
  that play under the film's own drawing and go through the same colour grade.

Anything missing is simply left out: no voice means captions only; no plate
means the drawn background.

## Adding the files

1. Put voice lines in `students/media/vo/` and clips in `students/media/plates/`.
2. List them in `students/media/film.json`:

```json
{
  "voice": {
    "01": "media/vo/01.mp3",
    "02": "media/vo/02.mp3",
    "03": "media/vo/03.mp3",
    "04": "media/vo/04.mp3",
    "05": "media/vo/05.mp3",
    "06": "media/vo/06.mp3"
  },
  "plates": {
    "void": "media/plates/void.mp4",
    "genesis": "media/plates/genesis.mp4",
    "worldfall": "media/plates/worldfall.mp4"
  }
}
```

Paths are relative to `students/`. Cloudflare Pages serves files up to 25 MiB.

## Voice-over script

| id | starts at | recorded length | line |
| --- | --- | --- | --- |
| 01 | 1.5 s | 2.72 s | Before anything, there was a question. |
| 02 | 5.3 s | 1.88 s | What will you become? |
| 03 | 10.15 s | 4.96 s | Every hour you focus. Every idea you chase. |
| 04 | 16.4 s | 2.64 s | Every small thing you finish… |
| 05 | 19.35 s | 2.06 s | …becomes something you can see. |
| 06 | 22.5 s | 1.54 s | This one is yours. |

The recorded lines (in `students/media/vo/`) were trimmed of leading and
trailing silence and levelled to −16 LUFS with peaks under −1.5 dBTP, so they
sit evenly in the mix. Line 05 starts as the sun breaks over the world's edge,
and 06 lands with the title. If a line ever runs long, the next one waits for
it, with a breath between, rather than talking over it.

Line 02 must end before 8.2 s, when the film cuts to black and silence.
Lines 04 and 05 are one sentence split across a breath.

Delivery: a warm, low, close-mic narrator; calm and certain, never a
"movie trailer" bark. Slow, with weight on *question*, *become*, *focus*,
*chase*, *see* and *yours*. A small smile on 06.

Files: one file per line, MP3 at 128–192 kbps or WAV, 44.1 or 48 kHz, mono is
fine. Trim the silence at both ends to under 0.1 s. Leave the voice dry: no
music, reverb or effects (the film adds a little of its own hall). Aim for
around −16 LUFS, peaks under −1 dBFS.

## Video plates

All three: 16:9, 1920×1080 or 1280×720, 24 fps, H.264 MP4 (or WebM),
about 8 s, **no audio track, no text, no logos, no people, no planets**, and
the subject centred (phones crop the sides). Keep each under ~8 MB (around
4–6 Mbps). The film grades them, so neutral colour is better than stylised.

| plate | shot | timing |
| --- | --- | --- |
| `void` | The void | 0 – 8.2 s |
| `genesis` | Genesis | 8.65 – 15.5 s |
| `worldfall` | Worldfall and the hold behind the questions (loops) | 14.9 s on |

The world itself is not filmed: your real world (from your account) is
rendered into the centre of the `worldfall` shot, so that plate must leave
the centre empty.

## Prompts, ready to paste

### ElevenLabs: the voice

**Voice Design prompt** (Voices → Design a voice):

> A warm, deep, intimate narrator in their forties. Resonant chest voice,
> close-mic, unhurried, with a quiet certainty, the way a great nature
> documentary narrates the birth of a star to one person in a dark room.
> Neutral, soft accent. Gentle breath between phrases, never theatrical,
> never a movie-trailer growl. Calm wonder, a hint of a smile.

**Settings:** model Eleven v3 (or Multilingual v2), Stability 45–55%,
Similarity 75%, Style 20–30%, Speaker boost on, speed 0.9.

**Lines** (generate each separately; the tags in square brackets are Eleven v3
audio tags, so delete them for v2):

```
01  [softly, slowly] Before anything… there was a question.
02  [quiet, intimate, a little closer] What will you become?
03  [warmer, building] Every hour you focus. [beat] Every idea you chase.
04  [gently] Every small thing you finish…
05  [with quiet wonder] …becomes something you can see.
06  [warm, a small smile] This one is yours.
```

Generate 3–4 takes of each and keep the one that fits its window in the
script table above (01 ≤ 3.1 s, 02 ≤ 3.3 s, 03 ≤ 4.6 s, 04 ≤ 2.4 s,
05 ≤ 3.2 s, 06 ≤ 3.4 s). Export MP3 192 kbps, name them `01.mp3` … `06.mp3`.

### Google Flow / Veo: the plates

Generate each as an 8-second, 16:9, 1080p clip with sound off.

**`void.mp4`: the void before anything**

> Cinematic deep-space shot, extremely dark. A very slow, steady dolly push
> forward through sparse, faint drifting dust motes lit from the front,
> towards a single tiny warm white-gold point of light at the exact centre
> of frame, far away. Anamorphic lens, shallow depth of field: near dust is
> soft bokeh, the point is sharp. Sparse faint stars. Mostly black; colour
> only in the point and the dust edges. Silent, still, expectant mood.
> Shot on large-format film, subtle grain. No planets, no text, no people,
> no lens dirt, no camera shake, no cuts.

**`genesis.mp4`: the first light**

> The birth of a universe: at the centre of frame a brilliant white-gold
> core blooms outward, and the camera flies forward through it into
> expanding luminous gas clouds and fine filaments of teal, magenta-rose and
> amber, with countless young stars streaming past the lens from the
> centre outwards. Volumetric light rays through the gas, rich depth with
> foreground, midground and distant nebula layers. IMAX space-documentary
> realism, physically plausible scale, anamorphic horizontal flares on the
> brightest stars. Continuous forward camera motion that slowly decelerates
> by the end. No planets, no text, no people, no cuts.

**`worldfall.mp4`: the calm after, behind your world (seamless loop)**

> Wide, calm deep-space background for compositing. A soft glowing nebula
> frames the edges of the frame (deep teal on the left, warm gold and rose on
> the right) with fine dark dust lanes, sparse stars of varied brightness, a
> very slow lateral drift. The centre of the frame is dark, clean and empty,
> because a planet will be placed there later. Gentle, majestic, golden-hour
> warmth in the highlights, teal in the shadows. Locked camera with only a
> slow drift, seamless loop, no sudden changes. No planets, no moons, no
> text, no people, no cuts.

**For all three:** if Flow adds a visible watermark on your plan, use a plan
that doesn't. Choose takes where the centre stays centred, because phones
crop the sides. Export H.264 MP4 at 1080p or 720p, 24 fps, under ~8 MB
each, and name them as above.
