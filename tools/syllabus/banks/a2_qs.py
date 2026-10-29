"""A Level (A2) exam-style questions for the existing banks. Original, not past papers.
python3 -I a2_qs.py <repo>"""
import json, sys, importlib.util, os

Q = {}
Q["alevel/math"] = [
    ("P3.1", "3", "Expand (1 + 2x)^(−1/2) in ascending powers of x, up to and including the term in x², and state the set of values of x for which the expansion is valid.",
     ["M1: 1 + (−½)(2x) + (−½)(−3/2)/2 × (2x)²", "A1: 1 − x", "A1: + (3/2)x²", "B1: |x| < ½"], "1 − x + (3/2)x², |x| < ½"),
    ("P3.3", "3", "Express 3 sin θ + 4 cos θ in the form R sin(θ + α), where R > 0 and 0° < α < 90°. Hence solve 3 sin θ + 4 cos θ = 2 for 0° < θ < 360°.",
     ["B1: R = 5", "M1: tan α = 4/3", "A1: α = 53.13°", "M1: sin(θ + 53.13°) = 0.4", "A1: θ = 103.3°, 330.4°"], "5 sin(θ + 53.1°); θ = 103.3°, 330.4°"),
    ("P3.4", "3", "Find dy/dx when y = x² e^(3x), and the exact x-coordinates of the stationary points.",
     ["M1: product rule", "A1: dy/dx = 2x e^(3x) + 3x² e^(3x)", "M1: x e^(3x)(2 + 3x) = 0", "A1: x = 0 and x = −2/3"], "x = 0, x = −2/3"),
    ("P3.5", "3", "Use integration by parts to find ∫ x ln x dx.",
     ["M1: u = ln x, dv/dx = x", "A1: (x²/2) ln x − ∫ (x²/2)(1/x) dx", "A1: (x²/2) ln x − x²/4 + c"], "(x²/2) ln x − x²/4 + c"),
    ("P3.8", "3", "Solve the differential equation dy/dx = xy² given that y = 1 when x = 0.",
     ["M1: separate: ∫ y⁻² dy = ∫ x dx", "A1: −1/y = x²/2 + c", "M1: c = −1", "A1: y = 2/(2 − x²)"], "y = 2/(2 − x²)"),
    ("P3.9", "3", "The complex number z = 1 + i√3. Find the modulus and argument of z, and hence find z³.",
     ["B1: |z| = 2", "B1: arg z = π/3", "M1: z³ has modulus 8, argument π", "A1: z³ = −8"], "|z| = 2, arg z = π/3, z³ = −8"),
    ("P3.7", "3", "The lines l₁: r = (1, 2, 3) + s(1, 0, −1) and l₂: r = (2, 1, 0) + t(0, 1, 1). Show that they do not intersect.",
     ["M1: equate components: 1 + s = 2, 2 = 1 + t, 3 − s = t", "M1: s = 1, t = 1", "A1: third equation: 3 − 1 = 2 ≠ 1, so no intersection (and not parallel, so skew)"], None),
    ("S2", "6", "The number of emails a shop receives per hour has a Poisson distribution with mean 3.2. Find the probability that it receives exactly 2 emails in a given hour, and at least 1 email in a 30-minute period.",
     ["M1: P(X = 2) = e^(−3.2) × 3.2²/2", "A1: = 0.209", "M1: half-hour mean 1.6; P(Y ≥ 1) = 1 − e^(−1.6)", "A1: = 0.798"], "0.209; 0.798"),
    ("S2", "6", "A machine fills bags whose masses are normally distributed with standard deviation 4 g. A random sample of 25 bags has mean 498.2 g. Test at the 5% level whether the mean mass is less than 500 g.",
     ["B1: H₀: μ = 500, H₁: μ < 500", "M1: z = (498.2 − 500)/(4/√25) = −2.25", "B1: critical value −1.645 (or p = 0.0122 < 0.05)", "A1: reject H₀: evidence the mean is less than 500 g"], "z = −2.25, reject H₀"),
]
Q["alevel/phy"] = [
    ("12", "4", "A car of mass 900 kg travels at a constant speed of 15 m s⁻¹ round a horizontal bend of radius 50 m. Calculate the centripetal force required.",
     ["C1: F = mv²/r", "A1: = 900 × 15² ÷ 50 = 4050 N"], "4.1 × 10³ N"),
    ("13", "4", "Show that the orbital period T of a satellite in a circular orbit of radius r about a planet of mass M satisfies T² = 4π²r³/(GM).",
     ["M1: GMm/r² = mv²/r (gravity provides centripetal force)", "M1: v = 2πr/T", "A1: substitution and rearrangement to T² = 4π²r³/(GM)"], None),
    ("15", "4", "A gas cylinder of volume 0.020 m³ contains an ideal gas at 2.0 × 10⁵ Pa and 300 K. Calculate the number of moles of gas. (R = 8.31 J mol⁻¹ K⁻¹)",
     ["C1: n = pV/(RT)", "C1: = 2.0 × 10⁵ × 0.020 ÷ (8.31 × 300)", "A1: = 1.6 mol"], "1.6 mol"),
    ("17", "4", "A mass on a spring oscillates with simple harmonic motion of amplitude 3.0 cm and frequency 2.0 Hz. Calculate its maximum speed and maximum acceleration.",
     ["C1: ω = 2πf = 4π rad s⁻¹ (12.6)", "A1: v_max = ωx₀ = 0.38 m s⁻¹", "A1: a_max = ω²x₀ = 4.7 m s⁻²"], "0.38 m s⁻¹; 4.7 m s⁻²"),
    ("19", "4", "A 470 µF capacitor is charged to 12 V and then discharged through a 2.0 kΩ resistor. Calculate the time constant and the potential difference after 1.0 s.",
     ["C1: τ = RC = 2000 × 470 × 10⁻⁶", "A1: = 0.94 s", "C1: V = 12 e^(−1.0/0.94)", "A1: = 4.1 V"], "0.94 s; 4.1 V"),
    ("20", "4", "An electron travels at 3.0 × 10⁶ m s⁻¹ perpendicular to a uniform magnetic field of 2.0 mT. Calculate the radius of its circular path. (e = 1.60 × 10⁻¹⁹ C, mₑ = 9.11 × 10⁻³¹ kg)",
     ["M1: Bqv = mv²/r so r = mv/(Bq)", "C1: = 9.11 × 10⁻³¹ × 3.0 × 10⁶ ÷ (2.0 × 10⁻³ × 1.60 × 10⁻¹⁹)", "A1: = 8.5 × 10⁻³ m"], "8.5 mm"),
    ("22", "4", "Light of wavelength 400 nm falls on a metal of work function 2.3 eV. Calculate the maximum kinetic energy of the emitted electrons in eV. (h = 6.63 × 10⁻³⁴ J s, c = 3.00 × 10⁸ m s⁻¹)",
     ["C1: photon energy = hc/λ = 4.97 × 10⁻¹⁹ J", "C1: = 3.1 eV", "A1: KE_max = 3.1 − 2.3 = 0.8 eV"], "0.8 eV"),
    ("23", "4", "A radioactive isotope has a half-life of 8.0 days. Calculate its decay constant and the fraction remaining after 20 days.",
     ["C1: λ = ln 2 / 8.0 = 0.0866 day⁻¹", "C1: N/N₀ = e^(−0.0866 × 20)", "A1: = 0.18"], "0.087 day⁻¹; 0.18"),
    ("14", "4", "Calculate the energy needed to melt 0.25 kg of ice at 0 °C. (Specific latent heat of fusion = 3.3 × 10⁵ J kg⁻¹)",
     ["C1: E = mL", "A1: = 0.25 × 3.3 × 10⁵ = 8.3 × 10⁴ J"], "8.3 × 10⁴ J"),
]
Q["alevel/chem"] = [
    ("23", "4", "Use the following data (kJ mol⁻¹) to calculate the lattice energy of sodium chloride: ΔHf NaCl −411; atomisation Na +107; first IE Na +496; atomisation Cl +122; first electron affinity Cl −349.",
     ["M1: a correct Born–Haber cycle", "M1: LE = ΔHf − (107 + 496 + 122 − 349)", "A1: = −411 − 376 = −787 kJ mol⁻¹"], "−787 kJ mol⁻¹"),
    ("25", "4", "Calculate the pH of 0.10 mol dm⁻³ ethanoic acid (Ka = 1.8 × 10⁻⁵ mol dm⁻³).",
     ["M1: [H⁺] = √(Ka × c)", "A1: = √(1.8 × 10⁻⁶) = 1.34 × 10⁻³", "A1: pH = 2.87"], "2.87"),
    ("26", "4", "For the reaction A + B → C, doubling [A] doubles the rate and doubling [B] quadruples the rate. Write the rate equation and give the units of k when concentrations are in mol dm⁻³ and the rate in mol dm⁻³ s⁻¹.",
     ["B1: first order in A, second order in B", "B1: rate = k[A][B]²", "A1: units dm⁶ mol⁻² s⁻¹"], "rate = k[A][B]²"),
    ("24", "4", "Use E° values (Fe³⁺/Fe²⁺ +0.77 V; Cu²⁺/Cu +0.34 V) to calculate E°cell and predict whether Fe³⁺ ions oxidise copper.",
     ["M1: E°cell = 0.77 − 0.34", "A1: = +0.43 V", "B1: positive, so the reaction 2Fe³⁺ + Cu → 2Fe²⁺ + Cu²⁺ is feasible"], "+0.43 V; yes"),
    ("28", "4", "Explain why aqueous copper(II) ions are coloured.",
     ["B1: ligands split the 3d orbitals into two energy levels", "B1: a d electron absorbs light of a particular frequency to move to the higher level", "B1: the complementary colour is seen (blue)", "B1: Cu²⁺ has a partly filled 3d subshell (3d⁹)"], None),
    ("30", "4", "Explain why benzene undergoes substitution rather than addition with bromine, and name the catalyst used.",
     ["B1: delocalised π electrons give extra stability", "B1: substitution keeps the delocalised ring; addition would destroy it", "B1: catalyst FeBr₃ (or AlBr₃ / iron)"], None),
    ("37", "4", "A compound has an ¹H NMR spectrum showing a triplet (3H) at δ 1.2 and a quartet (2H) at δ 3.6, and a broad peak that disappears with D₂O. Identify the compound and explain the splitting.",
     ["B1: ethanol, CH₃CH₂OH", "B1: the CH₃ triplet is next to a CH₂ (n + 1 = 3)", "B1: the CH₂ quartet is next to a CH₃", "B1: the O–H peak disappears as H exchanges with D"], "ethanol"),
]
Q["alevel/bio"] = [
    ("12", "4", "Explain how ATP is produced by oxidative phosphorylation.",
     ["B1: reduced NAD/FAD release electrons to the electron transport chain on the inner mitochondrial membrane", "B1: energy from electron flow pumps H⁺ into the intermembrane space", "B1: H⁺ flows back through ATP synthase (chemiosmosis)", "B1: driving ADP + Pi → ATP", "B1: oxygen is the final electron acceptor, forming water"], None),
    ("13", "4", "Describe the light-independent stage of photosynthesis (the Calvin cycle).",
     ["B1: CO₂ combines with RuBP, catalysed by rubisco", "B1: forming two molecules of GP", "B1: GP reduced to triose phosphate using ATP and reduced NADP", "B1: most TP regenerates RuBP, using ATP"], None),
    ("14", "4", "Explain how blood glucose concentration is lowered after a meal.",
     ["B1: β cells in the islets of Langerhans detect the rise and secrete insulin", "B1: insulin binds to receptors on liver and muscle cells", "B1: more glucose transporters (GLUT4) in membranes, so more glucose uptake", "B1: glucose converted to glycogen (glycogenesis)", "B1: negative feedback"], None),
    ("15", "4", "Explain how a nerve impulse is transmitted across a cholinergic synapse.",
     ["B1: action potential arrives; Ca²⁺ channels open and Ca²⁺ enters the presynaptic knob", "B1: vesicles fuse and release acetylcholine by exocytosis", "B1: ACh diffuses across the cleft and binds to receptors on the postsynaptic membrane", "B1: Na⁺ channels open, depolarising the membrane", "B1: acetylcholinesterase breaks down ACh"], None),
    ("16", "4", "In a dihybrid cross between two plants heterozygous for both genes (AaBb × AaBb), state the expected phenotypic ratio and explain what a significantly different result could suggest.",
     ["B1: 9 : 3 : 3 : 1", "B1: genes on different chromosomes assort independently", "B1: a different ratio may suggest linkage (genes on the same chromosome)", "B1: test with chi-squared"], "9 : 3 : 3 : 1"),
    ("19", "4", "Describe how PCR is used to amplify a sample of DNA.",
     ["B1: heated to about 95 °C to separate the strands", "B1: cooled to about 55 °C so primers anneal", "B1: heated to about 72 °C; Taq polymerase extends the strands", "B1: cycle repeated, doubling the DNA each time"], None),
]
Q["alevel/eco"] = [
    ("7", "4", "Explain why a profit-maximising monopolist produces where marginal cost equals marginal revenue, and why this may be allocatively inefficient.",
     ["B1: below MC = MR, extra units add more to revenue than cost", "B1: beyond it, extra units add more to cost than revenue", "B1: allocative efficiency needs P = MC", "B1: the monopolist's price is above MC, so output is restricted"], None),
    ("9", "4", "Explain how the multiplier works when government spending rises by $10 billion and the marginal propensity to withdraw is 0.25.",
     ["B1: multiplier = 1/MPW = 4", "B1: national income rises by $40 billion", "B1: each round of spending becomes someone's income, part of which is spent again", "B1: withdrawals (saving, tax, imports) stop it rising for ever"], "$40 billion"),
    ("10", "4", "Assess whether supply-side policies are better than demand-side policies at reducing unemployment.",
     ["B1: supply-side: training, labour-market flexibility reduce structural unemployment", "B1: but they take time and may be costly", "B1: demand-side: fiscal or monetary expansion reduces cyclical unemployment quickly", "B1: but risk inflation and do not fix structural problems", "B1: a judgement depending on the cause of unemployment"], None),
    ("11", "4", "Explain the possible effects of a depreciation of a country's currency on its current account.",
     ["B1: exports become cheaper abroad, imports dearer at home", "B1: export volumes rise, import volumes fall", "B1: the current account improves if PED for exports and imports is elastic (Marshall–Lerner)", "B1: J-curve: it may worsen first"], None),
]
Q["alevel/bus"] = [
    ("6", "3", "Evaluate whether a business should use Porter's generic strategies to compete in a new overseas market.",
     ["B1: cost leadership, differentiation or focus explained", "B1: applied to the business's strengths and the market", "B1: limits: hybrid strategies, local conditions", "B1: a supported judgement"], None),
    ("6", "3", "A project costs $50 000 and returns $15 000 a year for five years. Calculate the payback period and the average rate of return (ARR).",
     ["M1: payback = 50 000 ÷ 15 000", "A1: = 3.33 years (3 years 4 months)", "M1: average annual profit = (75 000 − 50 000) ÷ 5 = 5000", "A1: ARR = 5000 ÷ 50 000 × 100 = 10%"], "3.33 years; 10%"),
]
Q["alevel/acc"] = [
    ("7", "4", "A product has a standard of 2 kg of material at $5 per kg. 1000 units used 2100 kg costing $10 080. Calculate the material price and usage variances.",
     ["M1: price variance = (5 − 10 080/2100) × 2100", "A1: = $420 favourable", "M1: usage variance = (2000 − 2100) × 5", "A1: = $500 adverse"], "$420 F; $500 A"),
    ("6", "4", "Explain two limitations of using ratio analysis to compare two companies.",
     ["B1: different accounting policies (e.g. depreciation) distort comparisons", "B1: explained", "B1: historical data may not reflect the future / window dressing", "B1: explained"], None),
]
Q["alevel/cs"] = [
    ("13", "3", "Normalise the floating-point number with an 8-bit two's complement mantissa 00010110 and a 4-bit exponent 0011, and state its denary value.",
     ["M1: mantissa 0.0010110, exponent 3", "A1: denary value 0.0010110 × 2³ = 1.0110₂ = 1.375", "M1: shift mantissa left 2 places, exponent − 2", "A1: mantissa 01011000, exponent 0001"], "1.375"),
    ("17", "3", "Explain how asymmetric encryption is used to send a confidential message.",
     ["B1: the receiver has a public key and a private key", "B1: the sender encrypts with the receiver's public key", "B1: only the receiver's private key can decrypt it", "B1: the private key is never shared"], None),
    ("18", "3", "Describe how Dijkstra's algorithm finds the shortest path between two nodes.",
     ["B1: set the start node's distance to 0 and all others to infinity", "B1: repeatedly visit the unvisited node with the smallest distance", "B1: update neighbours' distances if a shorter path is found", "B1: stop when the destination is visited; trace back for the path"], None),
    ("20", "4", "Write pseudocode for a recursive function Factorial(N) that returns N!.",
     ["M1: function header with parameter and return type", "M1: base case IF N = 0 (or 1) RETURN 1", "M1: ELSE RETURN N * Factorial(N − 1)", "M1: correct ENDIF / ENDFUNCTION"], None),
]
Q["alevel/psy"] = [
    ("6", "3", "Describe one biological explanation of depression.",
     ["B1: names the explanation, e.g. the monoamine (serotonin) hypothesis", "B1: low levels of serotonin / noradrenaline linked to low mood", "B1: evidence, e.g. antidepressants (SSRIs) raise serotonin and reduce symptoms", "B1: or a genetic explanation with twin-study evidence"], None),
    ("8", "3", "Evaluate the use of fear appeals in health promotion.",
     ["B1: strength: can motivate change when people feel able to act (efficacy)", "B1: evidence from a study", "B1: weakness: very high fear can cause denial or avoidance", "B1: a judgement"], None),
]
Q["alevel/soc"] = [
    ("4", "3", "Explain how material deprivation may affect working-class students' achievement.",
     ["B1: lack of resources, e.g. books, devices, quiet space", "B1: poor diet and housing affect health and attendance", "B1: may need to work part-time / leave education early", "B1: evidence or a sociologist, e.g. Douglas"], None),
    ("6", "4", "Assess the view that the media set the agenda for public debate.",
     ["B1: agenda-setting: the media choose what is newsworthy (gatekeeping)", "B1: evidence, e.g. news values (Galtung and Ruge)", "B1: counter: audiences are active; social media lets the public set agendas", "B1: a supported judgement"], None),
]

def main(repo):
    total = 0
    spec = importlib.util.spec_from_file_location("fmt", os.path.join(repo, "tools/syllabus/fmt.py"))
    fmt = importlib.util.module_from_spec(spec); spec.loader.exec_module(fmt)
    for f, items in Q.items():
        path = f"{repo}/students/assets/syllabus/{f}.json"
        bank = json.load(open(path))
        by = {t["id"]: t for t in bank["topics"]}
        for tid, paper, q, scheme, ans in items:
            t = by[tid]
            if any(x["q"] == q for x in t.get("long", [])):
                continue
            e = {"q": q, "marks": len(scheme), "paper": paper, "scheme": scheme}
            if ans: e["ans"] = ans
            t.setdefault("long", []).append(e)
            total += 1
        open(path, "w", encoding="utf-8").write(fmt.dump(bank))
    print("added", total)

main(sys.argv[1])
