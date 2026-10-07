// Each cinema look has one grade of its own, as a film has: not a menu.
//
// Odyssey's is large-format film -- after the photography of IMAX 70mm:
// true black that the shadows sink into, warm and honest sunlight, colour
// held back, and halation (film's red-orange glow round the brightest
// things). On your world it is applied on the GPU (world-gl.js, in its
// composite pass: lift, gamma, gain per channel, saturation, halation);
// over the rest of the frame, css/cinema.css adds the light, the lens
// fall-off, the grain and the gate weave.
export const GRADES = {
  odyssey: {
    lift: [-0.022, -0.02, -0.014], // blacks sink, a breath cooler
    gamma: [1.04, 1.0, 0.95], // mid-tones warm
    gain: [1.07, 1.0, 0.9], // sunlight, not daylight
    sat: 0.88, // colour held back
    halation: 0.55, // the red glow round highlights
  },
};

/** The grade a look carries, or null. */
export function gradeFor(look) {
  return GRADES[look] || null;
}
