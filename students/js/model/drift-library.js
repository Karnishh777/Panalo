// Drift's library: hand-written, finite, and the same for everyone.
//
// Facts are limited to well-established ones, phrased with the precision
// they deserve ("about", "roughly"). There are no links out: Drift is for
// a breather, not for a new tab. To add to it, append to these arrays; the
// picker (drift-pick.js) rotates through them by date.

export const FACTS = [
  { id: "venus-day", tags: ["space", "science"], text: "A day on Venus is longer than its year. It takes about 243 Earth days to spin once, and about 225 to go around the Sun." },
  { id: "sunlight", tags: ["space", "science"], text: "The sunlight on your window left the Sun about 8 minutes and 20 seconds ago." },
  { id: "saturn-float", tags: ["space", "science"], text: "Saturn is less dense than water. On average it's about 0.69 grams per cubic centimetre — water is 1." },
  { id: "voyager", tags: ["space", "tech", "history"], text: "Voyager 1, launched in 1977, crossed into interstellar space in 2012. It's the most distant thing people have ever made, and it is still sending data home." },
  { id: "olympus", tags: ["space", "nature"], text: "Olympus Mons on Mars is about 22 km high — roughly two and a half Everests." },
  { id: "moon-drift", tags: ["space", "science"], text: "The Moon moves about 3.8 cm further from Earth every year. Lasers bounced off mirrors left by Apollo crews measure it." },
  { id: "pluto-orbit", tags: ["space", "history"], text: "Pluto was discovered in 1930. It takes about 248 years to go around the Sun, so it hasn't finished a single orbit since." },
  { id: "iss-sunrise", tags: ["space", "tech"], text: "The International Space Station circles Earth about every 90 minutes. Its crew see around sixteen sunrises a day." },
  { id: "chandrayaan", tags: ["space", "tech", "history"], text: "On 23 August 2023, India's Chandrayaan-3 landed near the Moon's south pole — the first landing in that region." },
  { id: "aryabhata", tags: ["space", "maths", "history"], text: "In 499 CE, Aryabhata wrote that the Earth spins on its axis — explaining why the stars seem to move — more than a thousand years before Copernicus." },
  { id: "trees-stars", tags: ["nature", "space"], text: "Earth has around three trillion trees. The Milky Way has somewhere between 100 and 400 billion stars." },
  { id: "lightning", tags: ["science", "nature"], text: "A lightning bolt can reach about 30,000 °C — around five times hotter than the surface of the Sun." },
  { id: "sharks-trees", tags: ["nature", "history"], text: "Sharks are older than trees. Sharks appear in the fossil record more than 400 million years ago; the first trees, about 385 million." },
  { id: "octopus", tags: ["nature", "science"], text: "An octopus has three hearts and blue blood — its blood carries oxygen with copper, not iron." },
  { id: "crows", tags: ["nature", "science"], text: "Crows can recognise individual human faces, and remember the ones that treated them badly for years." },
  { id: "polar-bear", tags: ["nature", "science"], text: "A polar bear's fur isn't white. Each hair is transparent; the skin underneath is black." },
  { id: "dna-length", tags: ["science"], text: "The DNA in one of your cells, stretched out, would be about two metres long." },
  { id: "tardigrades", tags: ["science", "space", "nature"], text: "Tardigrades — half-millimetre 'water bears' — survived ten days exposed to open space on a 2007 satellite experiment." },
  { id: "first-bug", tags: ["tech", "history"], text: "In 1947, engineers working on the Harvard Mark II found a moth stuck in a relay and taped it into the logbook: 'first actual case of bug being found'." },
  { id: "arpanet", tags: ["tech", "history"], text: "The first message sent over ARPANET, in 1969, was meant to be 'LOGIN'. The system crashed after 'LO'." },
  { id: "robot-word", tags: ["fiction", "tech", "history"], text: "The word 'robot' comes from Karel Čapek's 1920 play R.U.R. — from the Czech 'robota', forced labour." },
  { id: "frankenstein", tags: ["fiction", "history"], text: "Mary Shelley began Frankenstein at eighteen, during a rainy 1816 ghost-story contest by Lake Geneva. It's often called the first science-fiction novel." },
  { id: "hokusai-manga", tags: ["comics", "art", "history"], text: "Hokusai published sketchbooks called 'Hokusai Manga' from 1814 — thousands of drawings of people, animals and everyday life." },
  { id: "tezuka", tags: ["comics", "art"], text: "Osamu Tezuka, often called the 'god of manga', is said to have drawn around 150,000 pages in his lifetime." },
  { id: "great-wave", tags: ["art", "history"], text: "The Great Wave off Kanagawa is a woodblock print from around 1831 — thousands of impressions were made from the carved blocks." },
  { id: "reiniger", tags: ["film", "art", "history"], text: "The oldest surviving animated feature film, The Adventures of Prince Achmed (1926), was made by Lotte Reiniger from cut-paper silhouettes." },
  { id: "beethoven", tags: ["music", "history"], text: "Beethoven's Ninth Symphony premiered in 1824, when he was almost completely deaf. He kept composing by imagining the sound." },
  { id: "piano", tags: ["music"], text: "A standard piano has 88 keys, spanning a little over seven octaves." },
  { id: "tetris", tags: ["games", "tech", "history"], text: "Tetris was made in 1984 by Alexey Pajitnov, a researcher at the Soviet Academy of Sciences." },
  { id: "easter-egg", tags: ["games", "tech", "history"], text: "One of the first video game Easter eggs: in 1980, Warren Robinett hid his own name in a secret room in the Atari game Adventure." },
  { id: "1729", tags: ["maths", "history"], text: "1729 is the smallest number you can write as the sum of two cubes in two different ways: 1³ + 12³ and 9³ + 10³. Ramanujan noticed it from a hospital bed." },
  { id: "deck", tags: ["maths", "games"], text: "There are about 8 × 10⁶⁷ ways to order a deck of cards. A properly shuffled deck is almost certainly in an order no deck has ever been in." },
];

export const PROMPTS = [
  { id: "sketch-window", tags: ["art"], text: "Draw what's outside the nearest window in exactly ten lines. Not eleven." },
  { id: "write-50", tags: ["fiction"], text: "Write a 50-word story that begins with the last line of a different story." },
  { id: "alien-guide", tags: ["fiction", "space"], text: "Write the first paragraph of a travel guide to Earth, for visitors who have never seen weather." },
  { id: "panel-3", tags: ["comics", "art"], text: "Draw a three-panel comic about a thing you almost did today. Stick figures count." },
  { id: "hum", tags: ["music"], text: "Hum a four-note melody. Now hum it backwards. Which one is better?" },
  { id: "rhythm", tags: ["music"], text: "Tap a rhythm on your desk using only your pencil and the eraser end. Make it repeat twice the same way." },
  { id: "rules", tags: ["games"], text: "Invent a game for two people that needs only a coin and a sheet of paper. Write the rules in three sentences." },
  { id: "level", tags: ["games", "tech"], text: "Sketch the first level of a game set inside your school bag." },
  { id: "proof", tags: ["maths"], text: "Explain to an imaginary ten-year-old why odd + odd is always even. No algebra allowed." },
  { id: "estimate", tags: ["maths", "science"], text: "Estimate how many times your heart has beaten since you woke up. Show your working on a scrap of paper." },
  { id: "museum", tags: ["history", "art"], text: "Pick one object on your desk. Write the museum label it will have in the year 2500." },
  { id: "sky-name", tags: ["space"], text: "Look at the sky (or a photo of it). Invent a constellation and give it a one-line myth." },
  { id: "machine", tags: ["tech", "science"], text: "Design a useless machine: something that does one tiny thing in the most complicated way. Label three parts." },
  { id: "letter", tags: ["fiction"], text: "Write two sentences to yourself in five years. Fold it. Don't read it again today." },
  { id: "colour", tags: ["art", "nature"], text: "Find three things that are almost the same colour but not quite. Name the colours yourself." },
  { id: "scene", tags: ["film", "fiction"], text: "Describe the opening shot of a film about your morning. Where's the camera?" },
  { id: "sound-map", tags: ["music", "nature"], text: "Close your eyes for a minute. Make a list of every sound you can hear, closest first." },
  { id: "creature", tags: ["nature", "science", "art"], text: "Draw an animal that could live on a planet with twice Earth's gravity. What changed?" },
  { id: "news", tags: ["fiction", "history"], text: "Write a headline from a newspaper in 1850 about something you used today." },
  { id: "pattern", tags: ["maths", "art"], text: "Draw a pattern that never repeats exactly. Fill a small square with it." },
];

// The small things to do. Each is a few minutes at most and then ends.
export const PLAYS = [
  { id: "breathe", title: "Breathe with the orbit", text: "One minute. Breathe in as the ring grows, out as it shrinks." },
  { id: "starlink", title: "Join the stars", text: "Connect the stars in order to reveal a constellation. Thirty seconds, no score." },
  { id: "listen", title: "Five quiet minutes", text: "A soft generated soundscape and a five-minute timer. Then it stops." },
];

export const LIBRARY = { facts: FACTS, prompts: PROMPTS, plays: PLAYS };

export const INTERESTS = [
  { id: "space", label: "Space" },
  { id: "science", label: "Science" },
  { id: "tech", label: "Technology" },
  { id: "maths", label: "Maths" },
  { id: "fiction", label: "Fiction" },
  { id: "comics", label: "Comics" },
  { id: "music", label: "Music" },
  { id: "art", label: "Art" },
  { id: "games", label: "Games" },
  { id: "film", label: "Film" },
  { id: "history", label: "History" },
  { id: "nature", label: "Nature" },
];
