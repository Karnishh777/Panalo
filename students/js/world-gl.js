// The world, drawn by the GPU.
//
// One fragment shader ray-traces the whole scene for each pixel: the planet,
// a ring that passes behind it and sits in its shadow (and shades it back),
// and moons that pass in front and behind. There are no meshes and no
// libraries.
//
// Two scales of detail:
//   - the continents, moisture and cloud systems come from the same seeded
//     generator as the 2D renderer (world-surface.js), uploaded once as small
//     textures -- so a world has the same shape whichever renderer draws it;
//   - everything finer is made per pixel from a tiling noise texture sampled
//     three ways around the sphere (no seams, no poles): fractal coastlines,
//     ridges, beaches and shallows, wind-torn cloud edges, city lights,
//     craters on the moons. That's why it stays sharp at any size.
// Every layer of your life (land, lights, aurora...) is a uniform, so a
// change is a few numbers, not a new texture.
//
// It's lit like a photograph, not painted: colours are Earth-like
// reflectances in linear light; sunlight is reddened by the air it crosses;
// the atmosphere is a thin shell that scatters blue (Rayleigh) and glows
// forward when backlit (Mie), hazing the limb and gilding the terminator;
// the clouds are a separate deck above the ground (parallax, tops past the
// edge, wind-stretched, wispy); then a filmic curve, gamma, a light grade,
// and dither against banding. Edges are anti-aliased analytically. Away
// from weak devices a bloom pass lets the glint, the cities, the aurora and
// the backlit air glow, and it draws every frame.
//
// WebGL 1, so it runs on old phones and school laptops. If anything about it
// fails, createGlobe() falls back to the 2D renderer.
import { reducedMotion, animationLoop } from "./motion.js";
import { surfaceFor, paint, thresholdFor, TW, TH } from "./world-surface.js";
import { getLight, onLight, lightVector } from "./world-light.js";
import { deviceTier } from "./device-tier.js";
import { gradeFor } from "./cinema/grades.js";

const MAX_MOONS = 6;
const EXTENT = 1.7; // half the canvas, in planet radii, at zoom 1
const BASE_RATE = 0.16; // radians a second at speed 1

const VERT = `
attribute vec2 aPos;
varying vec2 vP;
void main() {
  vP = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vP;
uniform sampler2D uHeight;  // continents
uniform sampler2D uLights;  // one light per finished task
uniform sampler2D uClouds;  // weather systems
uniform sampler2D uMoist;   // where forests grow
uniform sampler2D uNoise;   // tiling detail noise, 3 channels
uniform float uExtent, uAspect, uRot, uCloudShift, uTime, uTilt, uSea;
uniform float uAtmo, uAurora, uCloudCover, uRing, uForest, uGlow, uNight;
uniform vec2 uRes;           // the canvas, in pixels
uniform vec3 uLight;        // towards the sun, view space
uniform vec3 uRingN;        // ring plane normal, view space
uniform vec4 uMoon[${MAX_MOONS}];     // xyz centre, w radius (0 = none)
uniform vec2 uMoonVal[${MAX_MOONS}];  // x progress, y done

const float PI = 3.14159265;
vec3 W; // triplanar weights for the current point

vec3 toPlanet(vec3 n) {   // view space -> the planet's frame (axial tilt)
  float c = cos(uTilt), s = sin(uTilt);
  return vec3(n.x, n.y * c + n.z * s, -n.y * s + n.z * c);
}
vec3 spinY(vec3 f, float a) {  // the planet's own frame, turned with it
  float c = cos(a), s = sin(a);
  return vec3(f.x * c + f.z * s, f.y, f.z * c - f.x * s);
}
vec2 uvOf(vec3 f, float spin) {
  float lon = atan(f.x, f.z) + spin;
  float lat = asin(clamp(f.y, -1.0, 1.0));
  return vec2(fract(lon / (2.0 * PI)), lat / PI + 0.5);
}

// Detail noise: the tile seen along each axis, blended by the surface
// direction. p is in noise cells (32 per tile).
void weights(vec3 n) {
  W = pow(abs(n), vec3(4.0));
  W /= (W.x + W.y + W.z);
}
float tn(vec3 p) {
  return W.x * texture2D(uNoise, p.yz * 0.03125).r
       + W.y * texture2D(uNoise, p.zx * 0.03125 + 0.37).g
       + W.z * texture2D(uNoise, p.xy * 0.03125 + 0.71).b;
}
vec3 tn3(vec3 p) {
  return W.x * texture2D(uNoise, p.yz * 0.03125).rgb
       + W.y * texture2D(uNoise, p.zx * 0.03125 + 0.37).gbr
       + W.z * texture2D(uNoise, p.xy * 0.03125 + 0.71).brg;
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * tn(p);
    n += a;
    a *= 0.5;
    p = p * 2.07 + vec3(1.7, 9.2, 3.1);
  }
  return s / n;
}

const vec3 BETA = vec3(0.17, 0.42, 1.0);  // how strongly the air scatters red, green, blue
const float SUN = 2.6;                    // sunlight, in the same units as the colours

// Sunlight after crossing the air to a point where the sun stands at mu
// (the cosine of its height): white overhead, gold low, red at the edge of
// night, nothing past it.
vec3 sunThrough(float mu) {
  vec3 T = exp(-BETA * 0.32 / max(mu + 0.16, 0.03));
  return T * smoothstep(-0.2, 0.06, mu);
}

// The ring's shadow on a point n (view space): follow the sunlight back to
// the ring plane.
float ringShadow(vec3 n) {
  if (uRing <= 0.0) return 1.0;
  vec3 Lv = normalize(uLight);
  float den = dot(Lv, uRingN);
  if (abs(den) < 1e-3) return 1.0;
  float t = -dot(n, uRingN) / den;
  if (t <= 0.0) return 1.0;
  float rd = length(n + Lv * t);
  float rb = 0.55 + 0.45 * sin(rd * 70.0) * sin(rd * 23.0 + 1.3);
  float re = smoothstep(1.3, 1.34, rd) * smoothstep(1.68, 1.62, rd);
  return 1.0 - uRing * re * rb * 0.6;
}

vec3 shadePlanet(vec2 p, float zp) {
  vec3 n = vec3(p, zp);
  vec3 f = toPlanet(n);
  vec3 L = normalize(toPlanet(uLight));
  vec3 V = toPlanet(vec3(0.0, 0.0, 1.0));
  vec2 uv = uvOf(f, uRot);
  vec3 P = spinY(f, uRot);          // fixed to the ground
  weights(P);

  // Height: the continent from the texture, coastlines and ridges per pixel.
  float h = texture2D(uHeight, uv).r;
  float d1 = fbm(P * 9.0, 4);
  float hd = h + (d1 - 0.5) * 0.06;
  float land = smoothstep(uSea - 0.0025, uSea + 0.0025, hd);
  float up = clamp((hd - uSea) / 0.18, 0.0, 1.0);

  // Relief: the continent's slope plus the detail's own slope.
  float du = 1.0 / ${TW}.0, dv = 1.0 / ${TH}.0;
  float hx = texture2D(uHeight, uv + vec2(du, 0.0)).r - texture2D(uHeight, uv - vec2(du, 0.0)).r;
  float hy = texture2D(uHeight, uv + vec2(0.0, dv)).r - texture2D(uHeight, uv - vec2(0.0, dv)).r;
  float lon = atan(f.x, f.z), lat = asin(clamp(f.y, -1.0, 1.0));
  vec3 east = vec3(cos(lon), 0.0, -sin(lon));
  vec3 north = vec3(-sin(lat) * sin(lon), cos(lat), -sin(lat) * cos(lon));
  vec3 Pe = spinY(east, uRot), Pn = spinY(north, uRot);
  float ridge = 1.0 - abs(2.0 * fbm(P * 22.0, 3) - 1.0);
  float rx = fbm((P + Pe * 0.004) * 22.0, 2) - fbm((P - Pe * 0.004) * 22.0, 2);
  float ry = fbm((P + Pn * 0.004) * 22.0, 2) - fbm((P - Pn * 0.004) * 22.0, 2);
  float rough = land * (0.25 + 0.9 * up);
  vec3 nb = normalize(f - land * (6.0 * (hx * east + hy * north) + rough * 1.2 * (rx * east + ry * north)));

  // Land: beaches, lowlands green or dry by moisture, rock higher up, snow on top.
  float moist = texture2D(uMoist, uv).r + (fbm(P * 6.0, 3) - 0.5) * 0.22;
  float green = smoothstep(uForest + 0.14, uForest - 0.1, moist);
  float lush = smoothstep(uForest - 0.05, uForest - 0.3, moist);
  float fine = fbm(P * 48.0, 2);
  // Colours are reflectances, in linear light, close to Earth's as seen from
  // orbit: ochre deserts, olive grassland, near-black forest, grey rock.
  float sand = fbm(P * 15.0, 2);
  vec3 dry = mix(vec3(0.26, 0.17, 0.09), vec3(0.17, 0.11, 0.06), sand);
  dry = mix(dry, vec3(0.32, 0.22, 0.12), smoothstep(0.7, 0.9, fbm(P * 31.0, 2)) * 0.5);
  vec3 grass = mix(vec3(0.1, 0.11, 0.045), vec3(0.03, 0.055, 0.022), lush);
  vec3 lowland = mix(dry, grass, green);
  lowland *= mix(1.0, 0.72, smoothstep(0.45, 0.75, fine) * green);
  vec3 rock = mix(vec3(0.15, 0.13, 0.11), vec3(0.08, 0.07, 0.065), ridge);
  vec3 landCol = mix(lowland, rock, smoothstep(0.5, 0.85, up + (ridge - 0.5) * 0.2));
  landCol *= 0.78 + 0.44 * fine;
  // Valleys a little darker than ridges, as relief reads from orbit.
  landCol *= 0.8 + 0.3 * ridge * smoothstep(0.1, 0.5, up);
  landCol = mix(vec3(0.3, 0.24, 0.16), landCol, smoothstep(0.0, 0.02, up));
  float snow = smoothstep(0.9, 0.97, up + (d1 - 0.5) * 0.2 + ridge * 0.05);
  landCol = mix(landCol, vec3(0.72, 0.75, 0.8), snow);

  // Sea: deep blue, turquoise shallows, a glow along the coasts from reading.
  // Open ocean is nearly black; only a thin rim of shallows shows colour.
  float depth = clamp((uSea - hd) / 0.22, 0.0, 1.0);
  vec3 seaCol = mix(vec3(0.007, 0.028, 0.06), vec3(0.002, 0.008, 0.024), sqrt(depth));
  seaCol = mix(vec3(0.012, 0.05, 0.058), seaCol, smoothstep(0.0, 0.025, depth));
  seaCol = mix(seaCol, vec3(0.02, 0.13, 0.12), uGlow * max(0.0, 1.0 - depth * 5.0));

  vec3 albedo = mix(seaCol, landCol, land);
  // Polar ice: a ragged edge of floes breaking up into the sea, greyer
  // where it's thin sea ice, bright where it's packed.
  float floes = fbm(P * 34.0, 3);
  float ice = smoothstep(0.958, 0.975, abs(P.y) + (d1 - 0.5) * 0.05 + (floes - 0.5) * 0.035);
  float pack = smoothstep(0.972, 0.99, abs(P.y) + (d1 - 0.5) * 0.04);
  albedo = mix(albedo, mix(vec3(0.42, 0.47, 0.54), vec3(0.72, 0.76, 0.82), max(pack, land)) * (0.85 + 0.3 * floes), ice);

  // Waves: a moving ripple on the water's normal, for the glint to break on.
  vec3 wp = P * 140.0 + vec3(uTime * 0.25, 0.0, uTime * 0.18);
  vec3 wv = tn3(wp) - 0.5;
  vec3 nw = normalize(nb + (1.0 - land) * (1.0 - ice) * 0.09 * (wv.x * east + wv.y * north));

  // The shadow the clouds above cast on the ground: the cloud field, looked
  // up a little way towards the sun.
  float on = step(0.09, uCloudCover) * 0.85;
  float cut = 0.74 - uCloudCover * 0.55;
  vec3 fs = normalize(f - L * 0.03);
  vec3 S = spinY(fs, uRot + uCloudShift);
  vec3 swarp = tn3(S * 4.0) - 0.5;
  float sdens = texture2D(uClouds, uvOf(fs, uRot + uCloudShift)).r * 0.62 + fbm(S * 13.0 + swarp * 3.0, 2) * 0.52 - 0.07;
  float shadow = on * smoothstep(cut, cut + 0.1, sdens);

  float ringShade = ringShadow(n);
  float d = dot(f, L);                         // the terminator
  float diff = max(dot(nw, L), 0.0);
  // Sunlight reaching the ground has crossed the air: warmer and dimmer low.
  vec3 sun = sunThrough(d) * SUN;
  // The night side: as dark as space, or lit by a cool moonlight -- your choice.
  vec3 moonlit = vec3(0.25, 0.38, 1.0) * (0.004 + 0.22 * uNight * uNight) * (0.6 + 0.4 * max(dot(nw, -L) * 0.5 + 0.5, 0.0));
  vec3 col = albedo * (sun * diff * ringShade + moonlit) * (1.0 - 0.45 * shadow * step(0.0, d));

  // Sun on water: a tight glint and a broad sheen, brighter towards the rim,
  // and the sky mirrored at grazing angles (Fresnel).
  vec3 H = normalize(L + V);
  float nh = max(dot(nw, H), 0.0);
  float water = (1.0 - land) * (1.0 - ice) * smoothstep(-0.05, 0.2, d) * ringShade * (1.0 - 0.8 * shadow);
  float fw = 0.25 + 0.75 * pow(1.0 - zp, 4.0);
  // (Waves roughen it: a broad soft sheen, not a mirror's pinpoint.)
  col += sun * (pow(nh, 180.0) * 0.18 + pow(nh, 34.0) * 0.045 + pow(nh, 10.0) * 0.015 * fw) * water;
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(nw, V), 0.0), 5.0);
  col += vec3(0.06, 0.16, 0.45) * fresnel * 0.5 * water;

  // Night side: cities where the lights are, sparkling in clusters, a warm
  // haze around the brightest.
  float night = smoothstep(0.12, -0.18, d);
  // The lights map is coarse: blur it into a soft density of settlement,
  // then let the detail noise place the actual lights -- bright clustered
  // towns, sparse sparkle, and threads of road between them.
  vec2 lt = vec2(1.6 / ${TW}.0, 1.6 / ${TH}.0);
  float lights = (texture2D(uLights, uv).r * 2.0
    + texture2D(uLights, uv + vec2(lt.x, 0.0)).r + texture2D(uLights, uv - vec2(lt.x, 0.0)).r
    + texture2D(uLights, uv + vec2(0.0, lt.y)).r + texture2D(uLights, uv - vec2(0.0, lt.y)).r) / 6.0;
  float settled = smoothstep(0.02, 0.4, lights) * land;
  float towns = smoothstep(0.5, 0.82, tn(P * 120.0)) * 0.9 + smoothstep(0.66, 0.9, tn(P * 340.0));
  float roads = smoothstep(0.955, 0.995, 1.0 - abs(2.0 * tn(P * 55.0) - 1.0)) * 0.45;
  float city = settled * (towns + roads) * (0.6 + 0.6 * smoothstep(0.2, 0.7, lights));
  col += vec3(1.0, 0.55, 0.2) * city * night * 2.6;
  col += vec3(1.0, 0.45, 0.15) * settled * night * 0.03;
  return col;
}

// Light scattered towards us by od of air whose sun stands at mu:
// blue sky (Rayleigh) and the bright forward glow of haze (Mie) when the
// sun is behind.
vec3 scatter(float od, float mu, vec3 L) {
  float c = -L.z;                                 // the angle between our view and the sun
  float ray = 0.75 * (1.0 + c * c);
  float g = 0.78;
  float mie = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5) * 0.06;
  vec3 s = (1.0 - exp(-BETA * od)) * ray + (1.0 - exp(-od * 0.45)) * mie * vec3(1.0, 0.86, 0.7);
  // Air just past the terminator still holds the sunset.
  return s * sunThrough(mu) * SUN * 0.75;
}

// The cloud deck: a shell just above the ground, so it moves over the land
// with parallax and its tops stand out past the planet's edge.
vec4 shadeClouds(vec3 nc) {
  vec3 f = toPlanet(nc);
  vec3 L = normalize(toPlanet(uLight));
  vec3 C = spinY(f, uRot + uCloudShift);
  vec2 cuv = uvOf(f, uRot + uCloudShift);
  // The winds stretch weather east-west: detail is squeezed in latitude,
  // warped twice so it swirls, then eroded so the edges go to wisps.
  vec3 Cs = C * vec3(1.0, 2.3, 1.0);
  weights(C);
  vec3 warp = tn3(Cs * 3.0) - 0.5;
  vec3 warp2 = tn3(Cs * 7.0 + warp * 2.0) - 0.5;
  float cdet = fbm(Cs * 10.0 + warp * 3.5 + warp2 * 1.5, 5);
  float wisp = fbm(Cs * 34.0 + warp2 * 5.0, 2);
  float cbase = texture2D(uClouds, cuv).r;
  float dens = cbase * 0.6 + cdet * 0.56 - 0.08 - (wisp - 0.5) * 0.2;
  float cut = 0.74 - uCloudCover * 0.55;
  float cover = smoothstep(cut - 0.04, cut + 0.24, dens);
  float thick = smoothstep(cut + 0.06, cut + 0.4, dens);
  // A faint veil of high cirrus, streaked by the jet streams, over it all.
  float streak = fbm(C * vec3(1.3, 9.0, 1.3) + warp * 1.2, 4);
  float cirrus = smoothstep(0.56, 0.86, streak) * smoothstep(0.25, 0.6, cbase + cdet * 0.3) * (0.05 + 0.16 * uCloudCover);
  float d = dot(f, L);
  // Tops lit from above, a little past the ground's terminator (the deck is
  // higher); thick cloud brighter, thin cloud letting the ground through.
  float lit = clamp((d + 0.1) / 1.1, 0.0, 1.0);
  vec3 body = vec3(0.62 + 0.28 * thick);
  vec3 moonlit = vec3(0.25, 0.38, 1.0) * (0.004 + 0.22 * uNight * uNight);
  vec3 col = body * (sunThrough(d + 0.05) * lit * SUN + moonlit);
  // Silver lining: thin edges glow when the sun is behind them.
  float back = pow(max(-normalize(uLight).z, 0.0), 2.0);
  col += sunThrough(d + 0.1) * SUN * (1.0 - thick) * back * pow(1.0 - nc.z, 1.5) * 0.9;
  col *= ringShadow(nc);
  float a = max(cover * (0.22 + 0.74 * thick), cirrus);
  return vec4(col * a, a);
}

// Aurora: things you made, curtains over both poles, glowing in the dark.
vec3 aurora(vec3 n) {
  vec3 f = toPlanet(n);
  vec3 L = normalize(toPlanet(uLight));
  vec3 P = spinY(f, uRot);
  weights(P);
  float lat = asin(clamp(f.y, -1.0, 1.0));
  float alat = abs(lat) * 180.0 / PI;
  float plon = atan(P.x, P.z);
  // A thin oval round each pole that wanders and folds, hung with rays.
  float centre = 67.0 + 2.6 * sin(plon * 3.0 + uTime * 0.21) + 1.2 * sin(plon * 8.0 - uTime * 0.37);
  float dl = alat - centre;
  float ribbon = exp(-dl * dl / 4.5) + 0.4 * exp(-(dl - 2.5) * (dl - 2.5) / 9.0);
  float rays = 0.5 + 0.5 * tn(vec3(plon * 30.0, uTime * 0.5, 3.0));
  rays *= 0.75 + 0.25 * sin(plon * 23.0 + uTime * 1.7);
  // Green below, violet on the poleward tops.
  vec3 col = mix(vec3(0.12, 1.0, 0.4), vec3(0.6, 0.25, 0.75), 0.4 * smoothstep(0.5, 4.0, dl));
  float night = smoothstep(0.12, -0.18, dot(f, L));
  // Seen edge-on near the limb the curtain is deeper, so brighter.
  float edge = 1.0 + 1.8 * pow(1.0 - n.z, 2.0);
  return col * uAurora * ribbon * rays * edge * (0.1 + 0.9 * night) * 0.26;
}

float hash(vec2 q) {
  return fract(52.9829189 * fract(dot(q, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 p = vec2(vP.x * uAspect, vP.y) * uExtent;
  float px = 2.0 * uExtent / uRes.y;             // one pixel, in planet radii
  float r2 = dot(p, p);
  float r = sqrt(r2);
  vec3 L = normalize(uLight);
  // The air: thicker with more time spent with people.
  float Hs = 0.02 + 0.022 * uAtmo;                // scale height: a thin shell
  float K = 2.0 + 3.2 * uAtmo;                    // density

  // The sky around the world: the air seen edge-on, brightest at the limb.
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (r > 1.0 - px) {
    float h = max(r - 1.0, 0.0);
    float od = K * exp(-h / Hs) * sqrt(6.2832 * Hs * r);
    vec3 q = vec3(p / max(r, 1e-4), 0.0);
    vec3 glow = scatter(od, dot(q, L), L) * 0.55;
    col = glow;
    a = clamp(max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);
  }

  // The ground, with the cloud deck over it, seen through the air.
  vec4 planet = vec4(0.0);
  float zPl = -1e9;
  if (r < 1.0 + px) {
    float cov = clamp((1.0 - r) / px + 0.5, 0.0, 1.0);
    vec2 ps = r > 0.9995 ? p * (0.9995 / r) : p;
    float zs = sqrt(max(1.0 - dot(ps, ps), 0.0));
    vec3 g = shadePlanet(ps, zs);
    planet = vec4(g * cov, cov);
    zPl = zs;
  }
  float RC = 1.0 + 0.011;
  if (uCloudCover >= 0.09 && r < RC + px) {
    float covc = clamp((RC - r) / px + 0.5, 0.0, 1.0);
    vec2 pc = r > RC * 0.9995 ? p * (RC * 0.9995 / r) : p;
    float zc = sqrt(max(RC * RC - dot(pc, pc), 0.0));
    vec4 cl = shadeClouds(vec3(pc, zc) / RC) * covc;
    planet = cl + planet * (1.0 - cl.a);
    if (r >= 1.0) zPl = zc;
  }
  if (r < 1.0 + px) {
    vec2 ps = r > 0.9995 ? p * (0.9995 / r) : p;
    float zs = sqrt(max(1.0 - dot(ps, ps), 0.0));
    vec3 n = vec3(ps, zs);
    // Looking down through the air: little straight down, a lot towards
    // the edge (a Chapman-style path length), so the limb goes hazy blue.
    float od = K * Hs / sqrt(zs * zs + 2.0 * Hs / PI);
    vec3 ext = exp(-BETA * od * 0.14);
    planet.rgb = planet.rgb * ext + scatter(od, dot(n, L), L) * 0.16 * planet.a;
    planet.rgb += aurora(n) * planet.a;
  }

  // Ring: where this pixel's ray crosses the ring plane. Many fine bands,
  // one dark gap, and a glow when the sun is behind it.
  float zr = -1e9;
  vec4 ring = vec4(0.0);
  if (uRing > 0.0 && abs(uRingN.z) > 1e-3) {
    float z = -(uRingN.x * p.x + uRingN.y * p.y) / uRingN.z;
    vec3 q = vec3(p, z);
    float d = length(q);
    if (d > 1.3 && d < 1.68) {
      float bands = 0.62 + 0.2 * sin(d * 61.0) + 0.12 * sin(d * 147.0 + 1.3) + 0.06 * sin(d * 289.0 + 0.4);
      bands *= smoothstep(0.004, 0.014, abs(d - 1.5));       // the gap
      bands *= mix(0.55, 1.0, smoothstep(1.3, 1.42, d));      // a fainter inner ring
      float edge = smoothstep(1.3, 1.33, d) * smoothstep(1.68, 1.63, d);
      float alpha = clamp(uRing * edge * bands * 0.7, 0.0, 1.0);
      float b = dot(q, L);
      float c = dot(q, q) - 1.0;
      float shade = (b * b - c > 0.0 && -b + sqrt(b * b - c) > 0.0 && b < 0.0) ? 0.18 : 1.0;
      float facing = abs(dot(uRingN, L));
      shade *= 0.5 + 0.5 * facing;
      vec3 tint = mix(vec3(0.42, 0.33, 0.24), vec3(0.62, 0.52, 0.4), 0.5 + 0.5 * sin(d * 37.0)) * SUN * 0.55;
      // Backlit, the ring's dust lights up.
      float fwdR = pow(max(-L.z, 0.0), 3.0);
      ring = vec4(tint * shade * (1.0 + 0.6 * pow(1.0 - facing, 3.0) + 1.6 * fwdR) * alpha, alpha);
      zr = z;
    }
  }

  // Moons: lit, cratered, glowing a little once their goal is done.
  float zm = -1e9;
  vec4 moon = vec4(0.0);
  for (int i = 0; i < ${MAX_MOONS}; i++) {
    vec4 m = uMoon[i];
    if (m.w <= 0.0) continue;
    vec2 dp = p - m.xy;
    float dd = dot(dp, dp);
    float rr = m.w + px;
    if (dd < rr * rr) {
      float mcov = clamp((m.w - sqrt(dd)) / px + 0.5, 0.0, 1.0);
      float z = m.z + sqrt(max(m.w * m.w - dd, 0.0));
      if (z > zm) {
        vec3 mn = vec3(dp, z - m.z) / m.w;
        mn.z = max(mn.z, 0.0);
        mn = normalize(mn + vec3(0.0, 0.0, 1e-4));
        weights(mn);
        float crater = fbm(mn * 3.0 + float(i) * 7.0, 3);
        float pits = smoothstep(0.62, 0.7, tn(mn * 7.0 + float(i) * 3.0));
        vec3 mb = mn + 0.35 * (tn3(mn * 7.0 + float(i) * 3.0) - 0.5) * pits;
        float lit = max(dot(normalize(mb), L), 0.0);
        float val = uMoonVal[i].x;
        vec3 base = mix(vec3(0.09, 0.095, 0.11), vec3(0.3, 0.28, 0.25), val) * (0.65 + 0.6 * crater);
        vec3 mc = base * (0.01 + SUN * lit);
        if (uMoonVal[i].y > 0.5) mc += vec3(1.0, 0.85, 0.55) * 0.3 * pow(1.0 - mn.z, 2.0);
        moon = vec4(mc * mcov, mcov);
        zm = z;
      }
    }
  }

  // Back to front: sort the three depths, then lay them over the sky.
  // (All premultiplied.)
  vec4 l0 = planet; float z0 = zPl;
  vec4 l1 = ring;   float z1 = zr;
  vec4 l2 = moon;   float z2 = zm;
  vec4 t; float tz;
  if (z0 > z1) { t = l0; l0 = l1; l1 = t; tz = z0; z0 = z1; z1 = tz; }
  if (z1 > z2) { t = l1; l1 = l2; l2 = t; tz = z1; z1 = z2; z2 = tz; }
  if (z0 > z1) { t = l0; l0 = l1; l1 = t; tz = z0; z0 = z1; z1 = tz; }
  col = l0.rgb + col * (1.0 - l0.a); a = l0.a + a * (1.0 - l0.a);
  col = l1.rgb + col * (1.0 - l1.a); a = l1.a + a * (1.0 - l1.a);
  col = l2.rgb + col * (1.0 - l2.a); a = l2.a + a * (1.0 - l2.a);

  // Everything above is linear light. A filmic curve so lights and glints
  // roll off instead of clipping, then encoded for the screen, then a
  // light grade: cool shadows, warm highlights.
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  col = pow(col, vec3(1.0 / 2.2));
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= mix(vec3(0.95, 0.99, 1.05), vec3(1.03, 1.0, 0.96), smoothstep(0.2, 0.75, lum));
  a = clamp(max(a, max(col.r, max(col.g, col.b))), 0.0, 1.0);
  // Dither, so the dark gradients of the air never band.
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0 * step(0.002, a);
  gl_FragColor = vec4(clamp(col, 0.0, a), a);
}`;

// Bloom: the brightest parts of the frame (the glint on the sea, city
// lights, aurora, the backlit air) spill a soft glow, as they do through a
// real lens. Bright pass and blur at a quarter of the size, so it's cheap.
const BRIGHT = `
precision mediump float;
varying vec2 vP;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec2 uv = vP * 0.5 + 0.5;
  vec4 c = texture2D(uTex, uv + uTexel * vec2(-1.0, -1.0)) + texture2D(uTex, uv + uTexel * vec2(1.0, -1.0))
         + texture2D(uTex, uv + uTexel * vec2(-1.0, 1.0)) + texture2D(uTex, uv + uTexel * vec2(1.0, 1.0));
  c *= 0.25;
  float m = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c.rgb * smoothstep(0.72, 1.0, m), 1.0);
}`;

const BLUR = `
precision mediump float;
varying vec2 vP;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec2 uv = vP * 0.5 + 0.5;
  vec2 o1 = uDir * 1.3846, o2 = uDir * 3.2308;
  vec3 c = texture2D(uTex, uv).rgb * 0.2270
         + (texture2D(uTex, uv + o1).rgb + texture2D(uTex, uv - o1).rgb) * 0.3162
         + (texture2D(uTex, uv + o2).rgb + texture2D(uTex, uv - o2).rgb) * 0.0703;
  gl_FragColor = vec4(c, 1.0);
}`;

// The composite: bloom added back, then the look's way of seeing the world.
//   style 0  filmed (Glass): as rendered.
//   style 1  comic (Verse): inks printed out of register, light cut into cel
//            bands, halftone in the shade, an ink line round every edge.
//   style 2  dot matrix (Signal): the world as a field of round LEDs, white
//            and grey by brightness, red where it glows warm (cities, dusk).
//   style 3  noir (another universe, glimpsed in Verse): black and white,
//            hard contrast, heavy screen.
//   style 4  8-bit (another universe): big pixels, a tiny palette.
const COMPOSITE = `
precision mediump float;
varying vec2 vP;
uniform sampler2D uTex;
uniform sampler2D uBloom;
uniform float uBloomK;
uniform float uStyle;
uniform float uGradeOn;          // a colourist's grade (cinema/grades.js)
uniform vec3 uLift, uGamma, uGain;
uniform float uSat;
uniform float uHalation;         // film's red glow round the brightest light
uniform vec2 uPx;      // one pixel, in uv
uniform float uDot;    // halftone / LED cell, in pixels
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec4 scene(vec2 uv) {
  vec4 s = texture2D(uTex, uv);
  vec3 b = texture2D(uBloom, uv).rgb * uBloomK;
  vec3 c = s.rgb + b * (1.0 - s.rgb);            // screen, so it never clips
  return vec4(c, max(s.a, max(c.r, max(c.g, c.b))));
}
float halftone(float l, float cell, float lo) {
  vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / cell;
  float d = length(fract(q) - 0.5);
  float r = clamp((lo - l) * 0.9, 0.0, 0.5);
  return smoothstep(r, r - 0.08, d) * step(0.02, r);
}
float edges(vec2 uv, float k) {
  float lx = lum(texture2D(uTex, uv + vec2(uPx.x * k, 0.0)).rgb) - lum(texture2D(uTex, uv - vec2(uPx.x * k, 0.0)).rgb);
  float ly = lum(texture2D(uTex, uv + vec2(0.0, uPx.y * k)).rgb) - lum(texture2D(uTex, uv - vec2(0.0, uPx.y * k)).rgb);
  float ax = texture2D(uTex, uv + vec2(uPx.x * k * 1.3, 0.0)).a - texture2D(uTex, uv - vec2(uPx.x * k * 1.3, 0.0)).a;
  float ay = texture2D(uTex, uv + vec2(0.0, uPx.y * k * 1.3)).a - texture2D(uTex, uv - vec2(0.0, uPx.y * k * 1.3)).a;
  return max(smoothstep(0.1, 0.3, length(vec2(lx, ly))) * 0.8, smoothstep(0.25, 0.6, length(vec2(ax, ay))));
}
void main() {
  vec2 uv = vP * 0.5 + 0.5;
  vec4 s = scene(uv);
  vec3 c = s.rgb;
  float a = s.a;
  if (uStyle > 0.5 && uStyle < 1.5) {
    // Comic.
    vec2 off = vec2(uPx.x * 2.5, uPx.y * 0.8);
    vec4 sr = scene(uv + off);
    vec4 sb = scene(uv - off);
    c = vec3(sr.r, c.g, sb.b);
    a = max(a, max(sr.a, sb.a) * 0.9);
    float l = lum(c);
    float cel = floor(l * 4.0 + 0.55) / 4.0;
    c *= mix(1.0, cel / max(l, 0.02), 0.65);
    float l2 = lum(c);
    c = clamp(mix(vec3(l2), c, 1.5), 0.0, 1.0);
    c = mix(c, c * vec3(0.55, 0.18, 0.5), halftone(l, uDot, 0.62) * 0.85);
    float ink = edges(uv, 1.5);
    c = mix(c, vec3(0.02, 0.01, 0.04), ink);
    a = max(a, ink * step(0.05, s.a));
  } else if (uStyle > 1.5 && uStyle < 2.5) {
    // Dot matrix: one LED per cell, sized by the light at its centre.
    vec2 cell = floor(gl_FragCoord.xy / uDot);
    vec2 centre = (cell + 0.5) * uDot;
    vec4 m = scene(centre * uPx);
    float l = lum(m.rgb);
    // Red only for real glow -- city lights, the sunset band -- not ochre land.
    float warm = smoothstep(0.26, 0.38, m.r - m.g) * step(0.3, m.r);
    float d = length(gl_FragCoord.xy - centre) / uDot;
    float r = m.a > 0.04 ? mix(0.13, 0.46, sqrt(clamp(l * 1.4, 0.0, 1.0))) : 0.0;
    float led = smoothstep(r, r - 0.09, d);
    vec3 col = mix(vec3(0.3 + 0.7 * clamp(l * 1.5, 0.0, 1.0)), vec3(1.0, 0.23, 0.19), warm);
    c = col * led;
    a = led * clamp(m.a * 1.6, 0.0, 1.0);
    c *= a > 0.0 ? 1.0 : 0.0;
  } else if (uStyle > 2.5 && uStyle < 3.5) {
    // Noir.
    float l = lum(c);
    float v = smoothstep(0.18, 0.5, l);
    v = max(v - halftone(l, uDot * 0.8, 0.75) * 0.9, 0.0);
    float ink = edges(uv, 1.5);
    c = vec3(v * (1.0 - ink));
    a = max(a, ink * step(0.05, s.a));
  } else if (uStyle > 3.5) {
    // 8-bit.
    float big = uDot * 1.6;
    vec2 centre = (floor(gl_FragCoord.xy / big) + 0.5) * big;
    vec4 m = scene(centre * uPx);
    c = floor(m.rgb * 4.0 + 0.5) / 4.0;
    a = step(0.3, m.a);
    c *= a;
  }
  if (uHalation > 0.0) {
    // Halation: light that went through the film, bounced off its base and
    // came back red -- a warm glow hugging every highlight.
    vec3 hb = texture2D(uBloom, uv).rgb;
    float hl = max(hb.r, max(hb.g, hb.b));
    vec3 halo = vec3(1.0, 0.32, 0.12) * hl * uHalation;
    c += halo * (1.0 - c);
    a = max(a, min(1.0, max(halo.r, max(halo.g, halo.b))));
  }
  if (uGradeOn > 0.5) {
    // Lift, gamma, gain per channel, then saturation -- on straight colour.
    vec3 g = a > 0.001 ? c / a : vec3(0.0);
    g = g * uGain + uLift * (1.0 - g);
    g = pow(max(g, 0.0), 1.0 / uGamma);
    g = mix(vec3(lum(g)), g, uSat);
    c = clamp(g, 0.0, 1.0) * a;
  }
  c = min(c, vec3(a));
  gl_FragColor = vec4(c, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`World shader: ${log}`);
  }
  return s;
}

function program(gl, frag = FRAG) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`World shader: ${gl.getProgramInfoLog(p)}`);
  return p;
}

// Can this browser draw it? Asked once, on a throwaway canvas, because a
// canvas that has handed out a WebGL context can never become a 2D one.
let supported = null;
//
// Software-only WebGL (no GPU) is refused: the 2D renderer is faster there.
// For testing, localStorage "panalo.students.gl" = "force" accepts it and
// "off" always uses 2D.
export function glSupported() {
  if (supported !== null) return supported;
  let pref = "";
  try {
    pref = localStorage.getItem("panalo.students.gl") || "";
  } catch {}
  if (pref === "off") return (supported = false);
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl", pref === "force" ? {} : { failIfMajorPerformanceCaveat: true }) || null;
    if (!gl) return (supported = false);
    program(gl);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    supported = true;
  } catch (e) {
    console.warn("World: WebGL unavailable, using the 2D renderer.", e);
    supported = false;
  }
  return supported;
}

// A 256x256 tile of smooth value noise, three independent channels, that
// wraps at every edge -- the source of all per-pixel detail. Made once.
let noiseTile = null;
function makeNoiseTile() {
  if (noiseTile) return noiseTile;
  const N = 256, CELLS = 32, S = N / CELLS;
  const out = new Uint8Array(N * N * 3);
  let a = 0x2545f491;
  const rnd = () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    return (a >>> 0) / 4294967296;
  };
  const q = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let c = 0; c < 3; c++) {
    const lat = Float32Array.from({ length: CELLS * CELLS }, rnd);
    const at = (x, y) => lat[(y % CELLS) * CELLS + (x % CELLS)];
    for (let y = 0; y < N; y++) {
      const gy = y / S, y0 = Math.floor(gy), fy = q(gy - y0);
      for (let x = 0; x < N; x++) {
        const gx = x / S, x0 = Math.floor(gx), fx = q(gx - x0);
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
        const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
        out[(y * N + x) * 3 + c] = Math.round((top + (bot - top) * fy) * 255);
      }
    }
  }
  return (noiseTile = out);
}

function texture(gl, unit, w, h, format, data, { wrapT = gl.CLAMP_TO_EDGE, mip = false } = {}) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

const toBytes = (arr, scale = 255) => {
  const out = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(arr[i] * scale)));
  return out;
};

function rot(v, axis, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const [x, y, z] = v;
  if (axis === "x") return [x, y * c - z * s, y * s + z * c];
  if (axis === "y") return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

/**
 * Same contract as the 2D createGlobe(): { setLayers, destroy }, plus the
 * motion controls { setMotion, getMotion, zoomBy, reset }.
 * `spin` is a speed multiplier (1 = one turn in about 40 seconds).
 * Returns null if WebGL can't be used on this canvas.
 */
export function createGlobeGL(canvas, { seed, tilt = 0.38, interactive = false, spin = 1, maxPixels = 1400, onMotion, manual = false, bloom } = {}) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  // Weak devices: every other frame, and no bloom. Everyone else: every
  // frame (a turning world judders at 30), and the glow.
  const low = deviceTier().tier === "low";
  const wantBloom = bloom ?? !low;
  // Each look sees the world its own way (in the composite pass), so the
  // passes exist wherever that might be wanted -- not in the film, whose
  // own grade does the work. Verse is drawn as a comic, and now and then
  // the world slips into another universe's style for a moment.
  const styleOk = bloom !== false;
  const STYLE = { glass: 0, verse: 1, signal: 2 };
  let slip = null; // { style, until }
  const styleNow = (t) => {
    if (!styleOk) return 0;
    const look = document.documentElement.dataset.look;
    if (look === "verse" && slip && t < slip.until) return slip.style;
    return STYLE[look] || 0;
  };
  const comicNow = () => styleOk && document.documentElement.dataset.look === "verse";
  let prog;
  let u = {};
  let post = null; // the bloom passes, when on
  function setup() {
    prog = program(gl);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n);
    u = {};
    for (const name of ["uExtent", "uAspect", "uRot", "uCloudShift", "uTime", "uTilt", "uSea", "uAtmo", "uAurora", "uCloudCover", "uRing", "uForest", "uGlow", "uNight", "uLight", "uRingN", "uMoon", "uMoonVal", "uRes"]) u[name] = U(name);
    ["uHeight", "uLights", "uClouds", "uMoist", "uNoise"].forEach((name, i) => gl.uniform1i(U(name), i + 1));
    post = null;
    if (wantBloom || styleOk) {
      try {
        const mk = (frag, names) => {
          const p = program(gl, frag);
          const loc = {};
          for (const n of names) loc[n] = gl.getUniformLocation(p, n);
          return { p, loc };
        };
        post = {
          bright: mk(BRIGHT, ["uTex", "uTexel"]),
          blur: mk(BLUR, ["uTex", "uDir"]),
          comp: mk(COMPOSITE, ["uTex", "uBloom", "uBloomK", "uStyle", "uPx", "uDot", "uGradeOn", "uLift", "uGamma", "uGain", "uSat", "uHalation"]),
          scene: null, a: null, b: null,
        };
      } catch (e) {
        console.warn("World: no bloom.", e);
        post = null;
      }
    }
  }

  // An offscreen picture to draw into.
  function target(w, h) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) throw new Error("framebuffer incomplete");
    return { t, fb, w, h };
  }
  function dropTargets() {
    for (const k of ["scene", "a", "b"]) {
      const x = post?.[k];
      if (!x) continue;
      gl.deleteTexture(x.t);
      gl.deleteFramebuffer(x.fb);
      post[k] = null;
    }
  }
  function targetsFor(w, h) {
    if (post.scene && post.scene.w === w && post.scene.h === h) return true;
    dropTargets();
    try {
      const qw = Math.max(8, Math.round(w / 4));
      const qh = Math.max(8, Math.round(h / 4));
      post.scene = target(w, h);
      post.a = target(qw, qh);
      post.b = target(qw, qh);
      return true;
    } catch (e) {
      console.warn("World: no bloom.", e);
      dropTargets();
      post = null;
      return false;
    }
  }
  function pass(prg, into, src, set) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fb : null);
    gl.viewport(0, 0, into ? into.w : canvas.width, into ? into.h : canvas.height);
    gl.useProgram(prg.p);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, src.t);
    gl.uniform1i(prg.loc.uTex, 6);
    set?.();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  try {
    setup();
  } catch (e) {
    console.warn(e);
    return null;
  }

  let layers = { land: 0.2, lights: 0, aurora: 0, forest: 0.4, glow: 0, atmosphere: 0.4, clouds: 0.1, ring: 0 };
  let moons = [];
  let surface = null;
  let sea = 0.5;
  let ready = false;
  let rotA = 0;
  let cloudShift = 0;
  let destroyed = false;
  let lost = false;

  // Motion: a steady turn you can speed up, slow, reverse or pause; drag to
  // spin it (with a flick's momentum) and to tip it towards you; zoom.
  const home = { speed: spin, direction: 1, paused: false, pitch: 0, zoom: 1 };
  const motion = { ...home };
  let pitchNow = 0;
  let zoomNow = 1;
  let fling = 0; // radians a second, decaying
  let dragging = null;

  // Where the sun is, and how bright the night side: the person's choice
  // (world-light.js), shared by every globe, followed live.
  let lighting = getLight();
  let light = lightVector(lighting);
  let lightOverride = false; // a film directing its own sun
  const offLight = onLight((l) => {
    if (lightOverride) return;
    lighting = l;
    light = lightVector(l);
    draw(performance.now());
  });
  // In "live" mode the sun moves with the clock; once a minute is plenty.
  const clock = setInterval(() => {
    if (lighting.mode === "live") {
      light = lightVector(lighting);
      if (reducedMotion()) draw(performance.now());
    }
  }, 60000);
  // The ring plane, seen just above edge-on and rolled a little.
  const ringBase = rot(rot([0, 1, 0], "x", 0.2), "z", -0.32);

  function upload() {
    const painted = paint(surface, layers);
    sea = thresholdFor(surface, Math.max(0.01, Math.min(0.9, layers.land)));
    texture(gl, 2, TW, TH, gl.LUMINANCE, toBytes(painted.lights));
  }

  function prepare() {
    if (destroyed || lost) return;
    surface = surfaceFor(seed);
    texture(gl, 1, TW, TH, gl.LUMINANCE, toBytes(surface.height));
    texture(gl, 3, TW, TH, gl.LUMINANCE, toBytes(surface.cloud));
    texture(gl, 4, TW, TH, gl.LUMINANCE, toBytes(surface.moistRank));
    texture(gl, 5, 256, 256, gl.RGB, makeNoiseTile(), { wrapT: gl.REPEAT, mip: true });
    upload();
    ready = true;
    draw(performance.now());
  }

  function size() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = Math.max(40, Math.round((rect.width || canvas.width) * dpr));
    let h = Math.max(40, Math.round((rect.height || rect.width || canvas.height) * dpr));
    const k = Math.min(1, maxPixels / Math.max(w, h));
    w = Math.round(w * k);
    h = Math.round(h * k);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function moonUniforms(t) {
    const pos = new Float32Array(MAX_MOONS * 4);
    const val = new Float32Array(MAX_MOONS * 2);
    moons.slice(0, MAX_MOONS).forEach((m, i) => {
      const a = t * (0.00012 + i * 0.000035) + i * 2.1;
      const r = Math.min(1.58, 1.3 + i * 0.06);
      let v = [Math.cos(a) * r, 0, Math.sin(a) * r];
      v = rot(v, "x", 0.22 + i * 0.05);
      v = rot(v, "z", -0.32);
      v = rot(v, "x", pitchNow);
      pos.set([v[0], v[1], v[2], 0.055 + 0.035 * (m.value || 0)], i * 4);
      val.set([m.value || 0, m.done ? 1 : 0], i * 2);
    });
    gl.uniform4fv(u.uMoon, pos);
    gl.uniform2fv(u.uMoonVal, val);
  }

  function draw(t) {
    if (destroyed || lost) return;
    size();
    const style = styleNow(t);
    // The cinema looks grade the world like a film (cinema/grades.js).
    const grade = styleOk ? gradeFor(document.documentElement.dataset.look) : null;
    const bloomNow = post && ready && (wantBloom || style || grade) && targetsFor(canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomNow ? post.scene.fb : null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!ready) return;
    gl.useProgram(prog);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uExtent, EXTENT / zoomNow);
    gl.uniform1f(u.uAspect, canvas.width / canvas.height);
    gl.uniform1f(u.uRot, rotA);
    gl.uniform1f(u.uCloudShift, cloudShift);
    gl.uniform1f(u.uTime, (t / 1000) % 1000);
    gl.uniform1f(u.uTilt, tilt + pitchNow);
    gl.uniform1f(u.uSea, sea);
    gl.uniform1f(u.uAtmo, layers.atmosphere);
    gl.uniform1f(u.uAurora, layers.aurora);
    gl.uniform1f(u.uCloudCover, layers.clouds);
    gl.uniform1f(u.uRing, layers.ring);
    gl.uniform1f(u.uForest, layers.forest);
    gl.uniform1f(u.uGlow, layers.glow);
    gl.uniform1f(u.uNight, lighting.night);
    gl.uniform3fv(u.uLight, light);
    gl.uniform3fv(u.uRingN, rot(ringBase, "x", pitchNow));
    moonUniforms(t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!bloomNow) return;
    const { bright, blur, comp, scene, a, b } = post;
    pass(bright, a, scene, () => gl.uniform2f(bright.loc.uTexel, 1 / scene.w, 1 / scene.h));
    // Two rounds of blur, the second wider: a tight core and a soft spill.
    for (const spread of [1, 2.2]) {
      pass(blur, b, a, () => gl.uniform2f(blur.loc.uDir, spread / a.w, 0));
      pass(blur, a, b, () => gl.uniform2f(blur.loc.uDir, 0, spread / a.h));
    }
    pass(comp, null, scene, () => {
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, a.t);
      gl.uniform1i(comp.loc.uBloom, 7);
      gl.uniform1f(comp.loc.uBloomK, wantBloom ? 0.7 : 0);
      gl.uniform1f(comp.loc.uStyle, style);
      gl.uniform1f(comp.loc.uGradeOn, grade ? 1 : 0);
      if (grade) {
        gl.uniform3fv(comp.loc.uLift, grade.lift);
        gl.uniform3fv(comp.loc.uGamma, grade.gamma);
        gl.uniform3fv(comp.loc.uGain, grade.gain);
        gl.uniform1f(comp.loc.uSat, grade.sat);
      }
      gl.uniform1f(comp.loc.uHalation, grade?.halation || 0);
      gl.uniform2f(comp.loc.uPx, 1 / canvas.width, 1 / canvas.height);
      gl.uniform1f(comp.loc.uDot, Math.max(4, Math.round(canvas.width / (style === 2 ? 64 : 90))));
    });
  }

  // On a weak device, ~30 fps while it simply turns; every frame while
  // someone is handling it. Elsewhere, every frame.
  let skip = false;
  let acc = 0;
  function advance(t, step) {
    const rate = motion.paused ? 0 : BASE_RATE * motion.speed * motion.direction;
    if (!dragging) rotA += (rate + fling) * step;
    fling *= Math.exp(-step / 0.7);
    pitchNow += (motion.pitch - pitchNow) * (1 - Math.exp(-step / 0.12));
    zoomNow += (motion.zoom - zoomNow) * (1 - Math.exp(-step / 0.15));
    cloudShift += (0.012 + Math.abs(rate) * 0.15) * step;
    draw(t);
  }
  const loop = animationLoop(canvas, (t, dt) => {
    const lively = dragging || Math.abs(fling) > 0.01 || Math.abs(pitchNow - motion.pitch) > 0.001 || Math.abs(zoomNow - motion.zoom) > 0.001;
    acc += dt;
    // Verse: every so often the world slips into another universe.
    if (comicNow() && !reducedMotion()) {
      if (!slip) slip = { style: 1, until: 0, next: t + 6000 + Math.random() * 5000 };
      if (t > slip.next) {
        slip = { style: [2, 3, 4][Math.floor(Math.random() * 3)], until: t + 450, next: t + 7000 + Math.random() * 6000 };
        canvas.dispatchEvent(new CustomEvent("universe-slip", { bubbles: true, detail: { style: slip.style } }));
      }
    }
    // Verse animates on twos, like the comic it is: 12 drawings a second.
    if (comicNow() && !lively && !(slip && t < slip.until)) {
      if (acc < 1000 / 12) return;
      const step = acc / 1000;
      acc = 0;
      return advance(t, step);
    }
    skip = low && !skip;
    if (skip && !lively) return;
    const step = acc / 1000;
    acc = 0;
    advance(t, step);
  });

  const still = () => reducedMotion();
  const changed = () => {
    onMotion?.({ ...motion });
    if (still()) {
      pitchNow = motion.pitch;
      zoomNow = motion.zoom;
      draw(performance.now());
    }
  };

  if (interactive) {
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => {
      dragging = { x: e.clientX, y: e.clientY, t: performance.now(), v: 0 };
      fling = 0;
      canvas.setPointerCapture?.(e.pointerId);
      canvas.classList.add("grabbing");
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const now = performance.now();
      const scale = 3.2 / Math.max(120, canvas.getBoundingClientRect().width);
      const dx = (e.clientX - dragging.x) * scale;
      const dy = (e.clientY - dragging.y) * scale;
      rotA -= dx;
      motion.pitch = Math.max(-1.1, Math.min(1.1, motion.pitch + dy * 0.8));
      const dtm = Math.max(1, now - dragging.t);
      dragging.v = dragging.v * 0.6 + (-dx / (dtm / 1000)) * 0.4;
      Object.assign(dragging, { x: e.clientX, y: e.clientY, t: now });
      if (still()) changed();
    });
    const end = () => {
      if (!dragging) return;
      if (performance.now() - dragging.t < 80) fling = Math.max(-12, Math.min(12, dragging.v));
      dragging = null;
      canvas.classList.remove("grabbing");
      changed();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowRight") rotA += k === "ArrowLeft" ? 0.25 : -0.25;
      else if (k === "ArrowUp" || k === "ArrowDown") motion.pitch = Math.max(-1.1, Math.min(1.1, motion.pitch + (k === "ArrowUp" ? -0.15 : 0.15)));
      else if (k === "+" || k === "=") motion.zoom = Math.min(1.9, motion.zoom * 1.15);
      else if (k === "-") motion.zoom = Math.max(0.7, motion.zoom / 1.15);
      else return;
      e.preventDefault();
      changed();
      draw(performance.now());
    });
  }

  // A lost context (a GPU reset, too many tabs) is rebuilt when it returns.
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
    loop.stop();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    ready = false;
    try {
      setup();
    } catch {
      return;
    }
    prepare();
    if (!still()) loop.start();
  });

  // A change of look redraws a still world (reduced motion) at once.
  const onLookChange = () => draw(performance.now());
  window.addEventListener("panalo:look", onLookChange);


  let ro = null;
  if ("ResizeObserver" in window) {
    ro = new ResizeObserver(() => draw(performance.now()));
    ro.observe(canvas);
  }

  // Generating the planet takes a moment on a slow device: do it when idle.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
  if (manual) prepare(); // a film needs the world now, and drives its frames
  else idle(prepare, { timeout: 800 });
  draw(performance.now());
  if (!still() && !manual) loop.start();

  return {
    setLayers(next, nextMoons = moons) {
      const repaint = ["land", "lights"].some((k) => next[k] !== layers[k]);
      layers = { ...layers, ...next };
      moons = nextMoons || [];
      if (repaint && ready) upload();
      draw(performance.now());
    },
    /** {speed: 0..8, direction: 1 | -1, paused: boolean} */
    setMotion(next) {
      Object.assign(motion, next);
      changed();
    },
    getMotion: () => ({ ...motion }),
    /** For a film: advance and draw one frame now (manual mode). */
    frame(t, dtMs) {
      advance(t, dtMs / 1000);
    },
    /** For a film: aim the sun directly, ignoring the saved choice. */
    setSun(vec, night = lighting.night) {
      lightOverride = true;
      const l = Math.hypot(...vec) || 1;
      light = vec.map((x) => x / l);
      lighting = { ...lighting, night };
    },
    /** For a film: tip and zoom without easing. */
    setView({ pitch, zoom } = {}) {
      if (pitch !== undefined) pitchNow = motion.pitch = pitch;
      if (zoom !== undefined) zoomNow = motion.zoom = zoom;
    },
    canvas,
    zoomBy(f) {
      motion.zoom = Math.max(0.7, Math.min(1.9, motion.zoom * f));
      changed();
    },
    reset() {
      Object.assign(motion, home);
      fling = 0;
      changed();
    },
    destroy() {
      destroyed = true;
      window.removeEventListener("panalo:look", onLookChange);

      dropTargets();
      loop.destroy();
      ro?.disconnect();
      offLight();
      clearInterval(clock);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
    renderer: "webgl",
  };
}
