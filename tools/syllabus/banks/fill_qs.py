"""Bring thin topics up to at least three practice questions. Original questions.
Each entry: (topic, question, correct, [three wrong], why). The correct option is
placed at a position fixed by the question text, so answers aren't always 'B'.
Also spreads the answers of the examiner-report questions (er_qs.py) the same way.
Run after build.py and er_qs.py:  python3 -I fill_qs.py <repo>"""
import json, sys, importlib.util, os, hashlib

Q = {}
Q["alevel/chem"] = [
    ("4", "Which assumption is made in the kinetic theory of an ideal gas?", "There are no intermolecular forces between the molecules", ["The molecules take up a significant volume", "Collisions between molecules are inelastic", "The molecules are stationary between collisions"], "Real gases behave least ideally at high pressure and low temperature, when these assumptions fail."),
    ("6", "What is the oxidation number of chromium in Cr₂O₇²⁻?", "+6", ["+3", "+7", "+12"], "2x + 7(−2) = −2, so x = +6."),
    ("9", "Which Period 3 oxide is amphoteric?", "Al₂O₃", ["Na₂O", "MgO", "SO₂"], "Aluminium oxide reacts with both acids and bases."),
    ("10", "How does the solubility of the Group 2 hydroxides change down the group?", "It increases", ["It decreases", "It stays the same", "It increases then decreases"], "Mg(OH)₂ is sparingly soluble; Ba(OH)₂ is much more soluble. (Group 2 sulfates show the opposite trend.)"),
    ("12", "Why is nitrogen gas very unreactive?", "The N≡N triple bond has a very high bond energy", ["Nitrogen has no lone pairs", "Nitrogen molecules are ionic", "Nitrogen is a noble gas"], "A lot of energy is needed to break the triple bond, and the molecule is non-polar."),
    ("14", "What is the mechanism when ethene reacts with hydrogen bromide?", "Electrophilic addition", ["Free-radical substitution", "Nucleophilic substitution", "Nucleophilic addition"], "The electron-rich C=C attracts the δ+ hydrogen of HBr: an electrophile adds across the double bond."),
    ("16", "Which alcohol is not oxidised by acidified potassium dichromate(VI)?", "2-methylpropan-2-ol", ["Propan-1-ol", "Propan-2-ol", "Ethanol"], "Tertiary alcohols have no H on the C–OH carbon, so the orange dichromate stays orange."),
    ("17", "Which reagent distinguishes an aldehyde from a ketone?", "Tollens' reagent", ["2,4-dinitrophenylhydrazine", "Sodium borohydride", "Bromine water"], "Aldehydes give a silver mirror; 2,4-DNPH gives an orange precipitate with both."),
    ("18", "Ethanoic acid is warmed with ethanol and a little concentrated sulfuric acid. What forms?", "Ethyl ethanoate and water", ["Ethanal and water", "Ethyl ethanoate and hydrogen", "Ethanoyl chloride"], "This is esterification; the acid is a catalyst and the reaction is reversible."),
    ("19", "How is a primary amine made from a halogenoalkane?", "Heat with excess ethanolic ammonia in a sealed tube", ["Warm with aqueous sodium hydroxide", "Heat with KCN in ethanol", "React with hydrogen and a nickel catalyst"], "Excess ammonia reduces further substitution to secondary and tertiary amines."),
    ("20", "What is the repeat unit of poly(propene)?", "–CH₂–CH(CH₃)–", ["–CH₂–CH₂–", "–CH=C(CH₃)–", "–CH₂–CH₂–CH₂–"], "Addition polymers keep the monomer's carbons; the C=C becomes C–C."),
    ("21", "Which reaction adds one carbon atom to a carbon chain?", "Halogenoalkane with KCN in ethanol", ["Alcohol with acidified dichromate", "Alkene with steam", "Halogenoalkane with aqueous NaOH"], "The nitrile formed can then be hydrolysed or reduced."),
    ("21", "Which conditions convert a nitrile into a carboxylic acid?", "Heat under reflux with dilute acid", ["Room temperature with water", "Hydrogen with a nickel catalyst", "LiAlH₄ in dry ether"], "Acid hydrolysis turns –C≡N into –COOH; reduction would give an amine."),
    ("22", "What causes the small M+1 peak in a mass spectrum?", "Molecules containing one ¹³C atom", ["Molecules that gained an electron", "Doubly charged ions", "Fragments that lost a hydrogen"], "About 1.1% of carbon is ¹³C, so the M+1 height helps count the carbon atoms."),
    ("24", "Standard electrode potentials are measured against which reference?", "The standard hydrogen electrode", ["A copper/copper(II) half-cell", "A zinc/zinc ion half-cell", "Pure water"], "Standard conditions: 298 K, 100 kPa, 1.00 mol dm⁻³ solutions; the hydrogen electrode is defined as 0.00 V."),
    ("26", "Rate = k[A]²[B], with concentrations in mol dm⁻³ and time in s. What are the units of k?", "dm⁶ mol⁻² s⁻¹", ["s⁻¹", "mol dm⁻³ s⁻¹", "dm³ mol⁻¹ s⁻¹"], "Overall order 3: k = rate ÷ (mol dm⁻³)³."),
    ("27", "How does the thermal stability of the Group 2 carbonates change down the group?", "It increases", ["It decreases", "It stays the same", "Only MgCO₃ decomposes"], "Higher temperatures are needed to decompose carbonates further down the group."),
    ("27", "Why do Group 2 carbonates become more thermally stable down the group?", "Larger cations have lower charge density and polarise the carbonate ion less", ["The cations become more charged", "Lattice energy increases down the group", "The carbonate ion gets smaller"], "Less distortion of the carbonate's electron cloud means it breaks up less easily."),
    ("29", "Molecules that are non-superimposable mirror images show which isomerism?", "Optical isomerism", ["Cis–trans isomerism", "Structural isomerism", "Chain isomerism"], "They rotate plane-polarised light in opposite directions."),
    ("29", "A chiral centre is a carbon atom that is:", "bonded to four different atoms or groups", ["part of a C=C double bond", "bonded to two identical groups", "in a benzene ring"], "Four different groups make two mirror-image arrangements possible."),
    ("30", "How does benzene react with bromine in the presence of FeBr₃?", "Electrophilic substitution", ["Electrophilic addition", "Nucleophilic substitution", "Free-radical addition"], "Substitution keeps the stable delocalised ring; FeBr₃ makes the Br⁺ electrophile."),
    ("31", "Why is chlorobenzene much less reactive towards nucleophiles than chloroethane?", "A chlorine lone pair overlaps with the ring's π system, strengthening the C–Cl bond", ["Chlorine is more electronegative in benzene", "Benzene has no electrons", "The C–Cl bond is ionic"], "The partial double-bond character makes the C–Cl bond harder to break."),
    ("31", "Which halogenoalkane is hydrolysed fastest?", "1-iodobutane", ["1-chlorobutane", "1-bromobutane", "1-fluorobutane"], "The C–I bond is the weakest, so it breaks most easily."),
    ("32", "Why is phenol more acidic than ethanol?", "The phenoxide ion's negative charge is delocalised into the ring", ["Phenol has more hydrogen atoms", "Ethanol is a stronger acid", "Phenol forms hydrogen bonds"], "A more stable anion means the O–H proton is lost more readily."),
    ("33", "What forms when ethanoyl chloride reacts with water?", "Ethanoic acid and hydrogen chloride", ["Ethanol and chlorine", "Ethanal and HCl", "Ethyl ethanoate"], "Acyl chlorides hydrolyse rapidly at room temperature, giving steamy HCl fumes."),
    ("33", "Which is the strongest acid?", "Dichloroethanoic acid", ["Ethanoic acid", "Chloroethanoic acid", "Ethanol"], "Electron-withdrawing chlorine atoms stabilise the carboxylate ion."),
    ("34", "Why is phenylamine a weaker base than ammonia?", "The nitrogen lone pair is partly delocalised into the benzene ring", ["Phenylamine has no lone pair", "The ring donates electrons to nitrogen", "Phenylamine is ionic"], "The lone pair is less available to accept a proton."),
    ("35", "Which pair of monomers forms a polyester?", "A diol and a dicarboxylic acid", ["A diamine and a dicarboxylic acid", "Two alkenes", "An amino acid and an alkene"], "Each ester link forms with loss of water; a diamine and a diacid would make a polyamide."),
    ("35", "Which linkage is found in a polyamide?", "–CONH–", ["–COO–", "–C=C–", "–O–"], "Nylon and proteins both contain the amide (peptide) link."),
    ("36", "How is phenylamine made from benzene?", "Nitrate with conc. HNO₃ and H₂SO₄, then reduce with Sn and conc. HCl", ["React with ammonia directly", "Add NH₄Cl and heat", "Reduce benzene, then add HCN"], "Nitration gives nitrobenzene; reduction gives phenylamine (freed with NaOH)."),
    ("36", "Which reagent converts a carboxylic acid into an acyl chloride?", "SOCl₂", ["HCl(aq)", "Cl₂ in UV light", "NaCl"], "PCl₅ or PCl₃ also work; aqueous HCl does not."),
    ("37", "Why is D₂O added to a sample in proton NMR?", "O–H and N–H protons exchange with D, so their peaks disappear", ["It is the reference at 0 ppm", "It increases splitting", "It removes C–H peaks"], "Comparing spectra with and without D₂O identifies the O–H or N–H peak."),
]
Q["alevel/cs"] = [
    ("3", "Which type of memory must be refreshed constantly?", "DRAM", ["SRAM", "ROM", "Flash memory"], "DRAM stores bits as charge in capacitors, which leaks away."),
    ("5", "Which is a utility program?", "Disk defragmenter", ["Word processor", "Web browser", "Compiler"], "Utilities help maintain the computer; others are applications or translators."),
    ("5", "What does a linker do?", "Combines object code and library routines into one executable", ["Translates source code line by line", "Loads programs into RAM", "Checks syntax"], "A loader then copies the executable into memory."),
    ("6", "What does a firewall do?", "Checks incoming and outgoing traffic against rules and blocks what is not allowed", ["Encrypts all data on a disk", "Removes viruses from files", "Backs up data"], "It sits between a network and the outside world."),
    ("7", "Which licence lets users study, modify and redistribute source code?", "Open source", ["Shareware", "Commercial", "Freeware"], "Freeware is free to use but usually without the source code."),
    ("9", "FOR Count ← 1 TO 10 … NEXT Count. Which statement should not be inside the loop?", "Count ← Count + 1", ["OUTPUT Count", "Total ← Total + Count", "IF Count = 5 THEN …"], "Examiners (2023): FOR loops sometimes added an extra increment, so the loop ran the wrong number of times."),
    ("9", "What does a structure chart show?", "The modules of a program, their hierarchy and the parameters passed", ["The order of instructions", "The data stored in a table", "Network connections"], "Arrows show data and flags passed between modules."),
    ("10", "Which abstract data type is first in, first out?", "Queue", ["Stack", "Binary tree", "Linked list"], "A stack is last in, first out."),
    ("10", "An item is added to a circular queue that is not full. What changes?", "Only the rear pointer moves on (wrapping to the start if needed)", ["All items move down one place", "The front pointer resets to 0", "The queue is emptied first"], "Examiners (2023): many wrongly said existing contents must be moved."),
    ("11", "Which pseudocode extracts 3 characters starting at position 2 of Name?", "MID(Name, 2, 3)", ["LEFT(Name, 3)", "RIGHT(Name, 2)", "Name[2 TO 3]"], "Examiners (2023): LEFT() was used where MID() was needed."),
    ("12", "Why is the waterfall model unsuitable when requirements may change?", "Each stage is finished before the next, so going back is slow and costly", ["It has no testing stage", "It needs no documentation", "It is only for small programs"], "Iterative and RAD models suit changing requirements."),
    ("13", "Why are floating-point numbers normalised?", "To give maximum precision and a unique representation", ["To make them negative", "To use fewer bits for the exponent", "To avoid rounding errors completely"], "A normalised mantissa starts 01 (positive) or 10 (negative)."),
    ("13", "More bits are given to the mantissa and fewer to the exponent. What happens?", "Precision increases and range decreases", ["Range increases and precision decreases", "Both increase", "Nothing changes"], "The mantissa sets precision; the exponent sets range."),
    ("14", "Which protocol sends email from a client to a mail server?", "SMTP", ["POP3", "HTTP", "FTP"], "POP3 and IMAP retrieve email."),
    ("14", "What is true of packet switching?", "Packets may take different routes and are reassembled in order", ["A dedicated path is reserved", "All packets must take the same route", "No headers are needed"], "Circuit switching reserves a path for the whole communication."),
    ("15", "Which is a feature of RISC processors?", "Simple instructions of fixed length, suited to pipelining", ["Many complex multi-cycle instructions", "Few registers", "Variable-length instructions only"], "CISC has complex instructions that may take several cycles."),
    ("15", "What is a virtual machine?", "Software that emulates a computer, running on a host system", ["A computer with no hardware", "A faster processor", "A type of network"], "It lets one machine run another OS, at a cost in performance."),
    ("16", "What does the lexical analysis stage of compilation do?", "Removes comments and white space and turns the source into tokens", ["Optimises the code", "Checks grammar against the language rules", "Produces machine code"], "Syntax analysis comes next."),
    ("16", "In paging, memory is divided into:", "Fixed-size blocks called pages and frames", ["Blocks of varying size", "Files", "Registers"], "Segmentation uses variable-size blocks."),
    ("17", "Data sent to Asha is encrypted with which key?", "Asha's public key", ["Asha's private key", "The sender's private key", "The sender's public key"], "Examiners (2023): candidates confused public and private keys. Only Asha's private key can decrypt it."),
    ("17", "How is a digital signature produced?", "The message is hashed and the hash is encrypted with the sender's private key", ["The message is encrypted with the receiver's public key", "A password is attached", "The message is compressed"], "Anyone can check it with the sender's public key."),
    ("18", "What does Dijkstra's algorithm find?", "The shortest path from one node to the others in a weighted graph", ["Whether a list is sorted", "The largest number in a list", "A spanning tree of equal weights"], "A* adds a heuristic to guide the search."),
    ("18", "In supervised learning, the training data are:", "Labelled with the correct outputs", ["Unlabelled", "Random", "Always images"], "Unsupervised learning finds patterns in unlabelled data."),
    ("19", "Binary search needs the data to be:", "Sorted", ["Unsorted", "Stored in a stack", "Numeric only"], "Each comparison halves the remaining data."),
    ("19", "What is the time complexity of a linear search?", "O(n)", ["O(1)", "O(log n)", "O(n²)"], "In the worst case every item is checked."),
    ("20", "A subclass uses the attributes and methods of its superclass. This is:", "Inheritance", ["Encapsulation", "Polymorphism", "Recursion"], "Polymorphism is redefining methods in subclasses."),
    ("20", "Why use exception handling?", "To deal with run-time errors without the program crashing", ["To speed up the program", "To find syntax errors", "To encrypt data"], "For example, a file that cannot be opened."),
]
Q["alevel/math"] = [
    ("P1.3", "What is the gradient of the line through (1, 2) and (3, 8)?", "3", ["1/3", "−3", "5"], "(8 − 2) ÷ (3 − 1) = 3."),
    ("P1.4", "A sector has radius 5 cm and angle 0.8 radians. What is its perimeter?", "14 cm", ["4 cm", "10 cm", "20 cm"], "Examiners (2023): some found an area instead of a perimeter. Arc = 5 × 0.8 = 4, plus two radii."),
    ("P3.1", "Solve |2x − 3| < 5.", "−1 < x < 4", ["x < 4", "x < −1 or x > 4", "−4 < x < 1"], "−5 < 2x − 3 < 5, so −2 < 2x < 8."),
    ("P3.2", "Solve 3ˣ = 20, giving x to 3 significant figures.", "2.73", ["6.67", "1.30", "0.367"], "x = ln 20 ÷ ln 3. Examiners (2023): keep brackets when taking logarithms."),
    ("P3.3", "sec²θ − tan²θ is equal to:", "1", ["0", "cos²θ", "−1"], "From 1 + tan²θ = sec²θ."),
    ("P3.5", "∫ 1/(2x + 1) dx =", "½ ln|2x + 1| + c", ["ln|2x + 1| + c", "2 ln|2x + 1| + c", "−1/(2x + 1)² + c"], "Divide by the derivative of the inside, 2."),
    ("P3.6", "A sign change of f(x) between a and b shows a root only if f is:", "Continuous on the interval", ["Increasing", "A polynomial", "Positive at a"], "A function like 1/x changes sign at an asymptote, with no root."),
    ("P3.7", "a = (1, 2, 2) and b = (2, −1, 0). What is the angle between them?", "90°", ["0°", "45°", "60°"], "a · b = 2 − 2 + 0 = 0, so they are perpendicular."),
    ("P3.8", "What is the general solution of dy/dx = 2y?", "y = Ae^(2x)", ["y = 2x + c", "y = e^(2x) + c", "y = x² + c"], "Separate: ∫ dy/y = ∫ 2 dx, ln y = 2x + c."),
    ("P3.8", "Separating the variables in dy/dx = x/y gives:", "∫ y dy = ∫ x dx", ["∫ x dy = ∫ y dx", "∫ 1/y dy = ∫ x dx", "y = x + c"], "Examiners (2023): incorrect separation of variables was a common error."),
    ("P3.9", "(2 + 3i)(2 − 3i) =", "13", ["−5", "4 − 9i", "4 + 9i"], "A number times its conjugate is the modulus squared: 4 + 9."),
    ("S2", "X ~ Po(2) and Y ~ Po(3) are independent. What is the distribution of X + Y?", "Po(5)", ["Po(6)", "Po(2.5)", "B(5, 0.5)"], "The sum of independent Poisson variables is Poisson with the means added."),
]
Q["alevel/phy"] = [
    ("12", "A body moves at constant speed in a circle. Its acceleration is:", "Towards the centre, with constant magnitude", ["Zero", "Along the direction of motion", "Away from the centre"], "The direction of velocity changes, so there is a centripetal acceleration v²/r."),
    ("14", "Specific latent heat of fusion is the energy needed to:", "Change unit mass from solid to liquid with no change in temperature", ["Raise unit mass by 1 K", "Boil unit mass", "Melt any mass"], "Learn definitions exactly: 'unit mass' and 'no change in temperature' both matter."),
    ("15", "The mean kinetic energy of the molecules of an ideal gas is proportional to:", "The thermodynamic (kelvin) temperature", ["The Celsius temperature", "The pressure only", "The volume"], "Mean E_k = (3/2)kT."),
    ("16", "In the first law, ΔU = q + W. What is W?", "The work done on the system", ["The work done by the system", "The heat lost", "The internal energy"], "Compressing a gas does work on it, so W is positive."),
    ("18", "Electric field strength is:", "The force per unit positive charge", ["The charge per unit area", "The work per unit charge", "The force on any charge"], "Units N C⁻¹ (= V m⁻¹)."),
    ("21", "A sinusoidal alternating voltage has peak value 10 V. What is its r.m.s. value?", "7.1 V", ["5.0 V", "10 V", "14 V"], "V_rms = V₀ ÷ √2."),
    ("23", "What is the mass defect of a nucleus?", "The difference between the mass of its separate nucleons and the mass of the nucleus", ["The mass of its electrons", "The mass lost in alpha decay", "The mass of one proton"], "It corresponds to the binding energy, E = Δm c²."),
    ("24", "Why is gel used between an ultrasound probe and the skin?", "It matches acoustic impedance, so little ultrasound is reflected at the skin", ["It cools the skin", "It amplifies the signal", "It absorbs X-rays"], "Air has a very different impedance from skin, so without gel most of the wave reflects."),
]
Q["alevel/fmath"] = [
    ("F1.1", "α, β, γ are the roots of x³ − 4x² + 2x − 7 = 0. What is α + β + γ?", "4", ["−4", "2", "7"], "Sum of roots = −b/a."),
    ("F1.2", "What is the oblique asymptote of y = (x² + 1)/(x − 2)?", "y = x + 2", ["y = x", "y = x − 2", "x = 2"], "x² + 1 = (x − 2)(x + 2) + 5; x = 2 is the vertical asymptote."),
    ("F1.3", "Σ r³ for r = 1 to n equals:", "¼n²(n + 1)²", ["½n(n + 1)", "⅙n(n + 1)(2n + 1)", "n³"], "It is the square of Σ r. Writing out the first few terms helps check which sum you have."),
    ("F1.5", "The area enclosed by a polar curve between θ = α and θ = β is:", "½ ∫ r² dθ", ["∫ r dθ", "∫ r² dθ", "π ∫ r² dθ"], "Examiners (2023): forgetting the factor ½ was the most common error."),
    ("F1.6", "How is a vector perpendicular to two lines found?", "Take the vector product of their direction vectors", ["Add the direction vectors", "Take the scalar product", "Subtract the position vectors"], "It is used for the normal to a plane and for the shortest distance between skew lines."),
    ("F1.7", "What is the first step of a proof by induction?", "Show the statement is true for the first value, e.g. n = 1", ["Assume it is true for all n", "Show it is false for n = 0", "Differentiate both sides"], "Then assume true for n = k and prove for n = k + 1, and conclude."),
    ("F2.1", "cosh²x − sinh²x =", "1", ["0", "cosh 2x", "−1"], "Compare cos²x + sin²x = 1 (Osborn's rule)."),
    ("F2.2", "The eigenvalues λ of a matrix M satisfy:", "det(M − λI) = 0", ["M − λI = 0", "det M = λ", "Mλ = I"], "This is the characteristic equation."),
    ("F2.2", "If M = PDP⁻¹ with D diagonal, then Mⁿ =", "PDⁿP⁻¹", ["PⁿDⁿP⁻ⁿ", "DⁿPP⁻¹", "nPDP⁻¹"], "The P⁻¹P pairs in the middle cancel."),
    ("F2.3", "d/dx (tanh x) =", "sech²x", ["sec²x", "−sech²x", "cosh²x"], "tanh x = sinh x / cosh x; use the quotient rule."),
    ("F2.3", "d/dx (sin⁻¹ x) =", "1/√(1 − x²)", ["−1/√(1 − x²)", "1/(1 + x²)", "cos⁻¹ x"], "Not to be confused with 1/sin x."),
    ("F2.4", "∫ 1/√(x² + 1) dx =", "sinh⁻¹ x + c", ["cosh⁻¹ x + c", "tan⁻¹ x + c", "ln x + c"], "Equivalently ln(x + √(x² + 1)) + c."),
    ("F2.4", "Reduction formulae for ∫ sinⁿx dx are usually found using:", "Integration by parts", ["Partial fractions", "Substitution x = sin θ only", "The chain rule"], "Write sinⁿx = sinⁿ⁻¹x · sin x first."),
    ("F2.5", "By de Moivre's theorem, (cos θ + i sin θ)ⁿ =", "cos nθ + i sin nθ", ["cosⁿθ + i sinⁿθ", "n cos θ + i n sin θ", "cos θⁿ + i sin θⁿ"], "Used to express cos nθ in powers of cos θ."),
    ("F2.6", "The integrating factor for dy/dx + P(x)y = Q(x) is:", "e^(∫P dx)", ["∫P dx", "e^(∫Q dx)", "P(x)Q(x)"], "Examiners (2023): errors in the coefficient of the logarithm were common; integrate P carefully."),
    ("F2.6", "What is the complementary function of y'' − 5y' + 6y = 0?", "y = Ae^(2x) + Be^(3x)", ["y = Ae^(−2x) + Be^(−3x)", "y = A cos 2x + B sin 3x", "y = (A + Bx)e^(5x)"], "Auxiliary equation m² − 5m + 6 = 0 gives m = 2, 3."),
    ("M3.1", "Ignoring air resistance, what is the path of a projectile?", "A parabola", ["A circle", "A straight line", "A hyperbola"], "Horizontal motion is uniform; vertical motion has constant acceleration g."),
    ("M3.1", "At the highest point of its path, a projectile's velocity is:", "Horizontal, equal to u cos θ", ["Zero", "Vertical", "Equal to u"], "Only the vertical component is zero there."),
    ("M3.2", "A rigid body is in equilibrium when:", "The resultant force is zero and the total moment about any point is zero", ["Only the resultant force is zero", "It is not moving", "Its centre of mass is at its centre"], "Take moments about a point that removes unknown forces."),
    ("M3.2", "A solid on a slope is about to topple when:", "Its centre of mass is vertically above the lowest edge", ["Friction is zero", "The slope is 45°", "Its weight is greatest"], "Compare this with the angle at which it would slide."),
    ("M3.3", "A car rounds a smooth banked track at the design speed. The friction needed is:", "Zero", ["Equal to its weight", "Equal to mv²/r", "Directed outwards"], "The horizontal component of the normal reaction gives all the centripetal force."),
    ("M3.3", "A particle on a string moves in a vertical circle. It just completes the circle when, at the top:", "The tension is zero, so mg = mv²/r", ["Its speed is zero", "The tension equals mg", "Its acceleration is zero"], "Examiners (2023): don't assume a particle is at rest when the string goes slack."),
    ("M3.4", "An elastic string has natural length l and modulus λ. Its tension at extension x is:", "λx/l", ["λx", "λ(l + x)/l", "λl/x"], "Examiners (2023): use the modulus as given (e.g. λ = mg) and the extension, not the extended length."),
    ("M3.4", "The elastic potential energy stored in the string is:", "λx²/(2l)", ["λx/l", "½λx²", "λl²/(2x)"], "x is the extension, not the total length."),
    ("M3.5", "The force on a particle depends on its displacement x. Which form of acceleration is used?", "v dv/dx", ["dv/dt only", "dx/dt", "v²/x"], "Then separate variables in v and x."),
    ("M3.5", "The force depends on time t. Which form of acceleration is used?", "dv/dt", ["v dv/dx", "d²t/dx²", "x/t²"], "Integrate with respect to t; remember the constant of integration."),
    ("M3.6", "A smooth sphere strikes a smooth fixed wall obliquely. Which velocity component is unchanged?", "The component parallel to the wall", ["The component perpendicular to the wall", "Both components", "Neither component"], "There is no friction, so no impulse along the wall."),
    ("M3.6", "For two smooth spheres colliding obliquely, Newton's experimental law applies:", "Along the line of centres", ["Perpendicular to the line of centres", "Along the original velocity", "In every direction"], "Components perpendicular to the line of centres are unchanged."),
    ("S4.1", "The median m of a continuous random variable satisfies:", "F(m) = 0.5", ["f(m) = 0.5", "f'(m) = 0", "E(X) = m"], "Examiners (2023): some set the pdf, not the cdf, equal to 0.5."),
    ("S4.2", "A small sample comes from a normal population with unknown variance. Which distribution is used for the mean?", "t with n − 1 degrees of freedom", ["Normal with variance 1", "Chi-squared with n degrees of freedom", "Poisson"], "Examiners (2023): an incorrect t-value was the most common error."),
    ("S4.3", "In a chi-squared test, what is done with cells whose expected frequency is below 5?", "Combine them with neighbouring cells", ["Delete them", "Double them", "Ignore the test"], "Then recalculate the degrees of freedom."),
    ("S4.3", "How many degrees of freedom has a 3 × 4 contingency table?", "6", ["12", "7", "11"], "(3 − 1)(4 − 1) = 6."),
    ("S4.4", "When is a Wilcoxon signed-rank test used instead of a t-test?", "When the population cannot be assumed normal", ["When the sample is very large", "When data are categorical", "When the variance is known"], "It tests a median using ranks of differences."),
    ("S4.4", "The sign test uses:", "Only whether each difference is positive or negative", ["The size of the differences", "The ranks of the data", "The sample mean"], "Under H₀ the number of + signs is B(n, 0.5)."),
    ("S4.5", "For a probability generating function G(t), E(X) =", "G'(1)", ["G(1)", "G'(0)", "G''(1)"], "G(1) = 1 for any PGF."),
    ("S4.5", "X and Y are independent with PGFs G_X(t) and G_Y(t). The PGF of X + Y is:", "G_X(t) × G_Y(t)", ["G_X(t) + G_Y(t)", "G_X(G_Y(t))", "G_X(t) − G_Y(t)"], "Examiners (2023): the probability of X = k is the coefficient of tᵏ: read the power, not the largest coefficient."),
]

exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fill2.py"), encoding="utf-8").read())
for k, v in Q2.items():
    Q.setdefault(k, []).extend(v)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fill3.py"), encoding="utf-8").read())
for k, v in Q3.items():
    Q.setdefault(k, []).extend(v)

def place(q, correct, wrong):
    k = int(hashlib.sha1(q.encode()).hexdigest(), 16) % 4
    o = list(wrong)
    o.insert(k, correct)
    return o, k

def spread(t):
    """Move the answer of an examiner-report question to its fixed position."""
    for x in t["questions"]:
        if x["why"].startswith("Examiners (2023): ") and "spread" not in x:
            correct = x["o"][x["a"]]
            wrong = [o for i, o in enumerate(x["o"]) if i != x["a"]]
            x["o"], x["a"] = place(x["q"], correct, wrong)

def main(repo):
    total = 0
    spec = importlib.util.spec_from_file_location("fmt", os.path.join(repo, "tools/syllabus/fmt.py"))
    fmt = importlib.util.module_from_spec(spec); spec.loader.exec_module(fmt)
    import glob
    for path in glob.glob(f"{repo}/students/assets/syllabus/*/*.json"):
        f = path.split("syllabus/")[1][:-5]
        bank = json.load(open(path))
        by = {t["id"]: t for t in bank["topics"]}
        for tid, q, correct, wrong, why in Q.get(f, []):
            assert len(wrong) == 3, q
            t = by[tid]
            if any(x["q"] == q for x in t["questions"]):
                continue
            o, a = place(q, correct, wrong)
            t["questions"].append({"q": q, "o": o, "a": a, "why": why})
            total += 1
        for t in bank["topics"]:
            spread(t)
        open(path, "w", encoding="utf-8").write(fmt.dump(bank))
    print("added", total)

main(sys.argv[1])
