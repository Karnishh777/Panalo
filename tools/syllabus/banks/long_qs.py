"""Original exam-style questions (not past papers) for the remaining banks.
Each: (topic id, paper, question, [scheme lines], answer or None)."""
import json, sys

Q = {}

Q["alevel/chem"] = [
    ("2", "2", "0.212 g of an anhydrous carbonate, M₂CO₃, reacts exactly with 20.0 cm³ of 0.200 mol dm⁻³ hydrochloric acid. Calculate the relative atomic mass of M and identify M.",
     ["M1: M₂CO₃ + 2HCl → 2MCl + H₂O + CO₂ (ratio 1 : 2)", "M1: n(HCl) = 0.0200 × 0.200 = 4.00 × 10⁻³ mol", "M1: n(M₂CO₃) = 2.00 × 10⁻³ mol, so Mr = 0.212 ÷ 0.00200 = 106", "A1: 2Ar(M) = 106 − 60 = 46, Ar = 23: sodium"], "Ar = 23, sodium"),
    ("5", "2", "Use these standard enthalpy changes of combustion (kJ mol⁻¹) to calculate the standard enthalpy change of formation of propane, C₃H₈: C(s) −394, H₂(g) −286, C₃H₈(g) −2219.",
     ["M1: a correct Hess cycle or ΔHf = Σ ΔHc(reactants) − ΔHc(propane)", "M1: 3(−394) + 4(−286) = −2326", "A1: ΔHf = −2326 + 2219 = −107 kJ mol⁻¹"], "−107 kJ mol⁻¹"),
    ("7", "2", "0.50 mol of H₂ and 0.50 mol of I₂ are heated in a sealed 1.00 dm³ flask until equilibrium: H₂(g) + I₂(g) ⇌ 2HI(g). At equilibrium there are 0.78 mol of HI. Calculate Kc.",
     ["M1: H₂ and I₂ used = 0.39 mol each", "M1: at equilibrium [H₂] = [I₂] = 0.11 mol dm⁻³", "M1: Kc = [HI]² ÷ ([H₂][I₂]) = 0.78² ÷ 0.11²", "A1: Kc = 50 (no units)"], "Kc ≈ 50, no units"),
    ("8", "2", "Use the Boltzmann distribution to explain why a small rise in temperature greatly increases the rate of a reaction.",
     ["B1: at higher temperature the curve shifts right / lower peak, area unchanged", "B1: many more molecules have energy ≥ Ea", "B1: so more frequent successful collisions per second (frequency of collisions rises only slightly)"], None),
    ("3", "2", "Explain why water (Mr 18) has a much higher boiling point than hydrogen sulfide (Mr 34).",
     ["B1: water forms hydrogen bonds between molecules", "B1: because O is much more electronegative than S (O–H strongly polar, lone pairs on O)", "B1: hydrogen bonds need more energy to overcome than the van der Waals forces between H₂S molecules"], None),
    ("14", "2", "But-1-ene reacts with hydrogen bromide to give two products. Name the major product and explain why it is formed in the larger amount.",
     ["B1: 2-bromobutane", "B1: via the secondary carbocation (CH₃CH⁺CH₂CH₃)", "B1: which is more stable than the primary one, because alkyl groups push electrons towards (are electron-donating to) the positive carbon"], "2-bromobutane"),
    ("16", "2", "Describe how you could use acidified potassium dichromate(VI) and one other reagent to distinguish between propan-1-ol, propan-2-ol and 2-methylpropan-2-ol.",
     ["B1: warm each with acidified K₂Cr₂O₇: propan-1-ol and propan-2-ol turn it orange to green", "B1: 2-methylpropan-2-ol (tertiary) leaves it orange", "B1: distil off the product: propan-1-ol gives an aldehyde, propan-2-ol a ketone", "B1: Tollens' reagent gives a silver mirror with the aldehyde only (or Fehling's: red precipitate)"], None),
    ("1", "2", "Explain why the first ionisation energy of aluminium is lower than that of magnesium, and why that of sulfur is lower than that of phosphorus.",
     ["B1: Al's outer electron is in a 3p orbital, Mg's in 3s", "B1: 3p is higher in energy / further from the nucleus / shielded by the 3s electrons, so easier to remove", "B1: in S the electron removed is from a 3p orbital that holds a pair of electrons", "B1: spin-pair repulsion makes it easier to remove"], None),
]

Q["alevel/bio"] = [
    ("1", "2", "In an electron micrograph a mitochondrion measures 18 mm. Its actual length is 3 µm. Calculate the magnification of the image.",
     ["M1: 18 mm = 18 000 µm", "A1: magnification = 18 000 ÷ 3 = × 6000"], "× 6000"),
    ("3", "2", "Explain how a non-competitive inhibitor affects the Vmax and the Michaelis–Menten constant (Km) of an enzyme.",
     ["B1: it binds to a site other than the active site (allosteric site)", "B1: changing the shape of the active site, so fewer enzyme–substrate complexes form", "B1: Vmax is lower; adding more substrate does not overcome it", "B1: Km is unchanged (the affinity of the remaining active enzymes is the same)"], None),
    ("4", "2", "A plant cell is placed in pure water. Explain, in terms of water potential, what happens to the cell.",
     ["B1: pure water has a higher (less negative) water potential than the cell (0 kPa)", "B1: water moves into the cell by osmosis, down the water potential gradient, through the partially permeable membrane", "B1: the cell becomes turgid; the cell wall stops it bursting"], None),
    ("6", "2", "Describe how DNA replicates semi-conservatively.",
     ["B1: hydrogen bonds between bases break and the double helix unwinds (helicase)", "B1: each strand acts as a template", "B1: free nucleotides pair with complementary bases (A–T, C–G)", "B1: DNA polymerase joins the nucleotides, so each new molecule has one old strand and one new strand"], None),
    ("8", "2", "Explain the Bohr shift and why it is useful in actively respiring tissues.",
     ["B1: high carbon dioxide concentration lowers the affinity of haemoglobin for oxygen (curve shifts right)", "B1: CO₂ forms carbonic acid, and H⁺ ions bind to haemoglobin forming haemoglobinic acid", "B1: so more oxygen is released (unloaded) where it is needed for respiration"], None),
    ("10", "2", "Explain how a population of bacteria becomes resistant to an antibiotic.",
     ["B1: a random mutation gives a bacterium resistance (e.g. a gene for an enzyme that breaks down the antibiotic)", "B1: when the antibiotic is used, resistant bacteria survive and non-resistant ones die (selection pressure)", "B1: resistant bacteria reproduce and pass on the allele, also by horizontal gene transfer on plasmids"], None),
    ("2", "2", "Describe the structure of cellulose and explain how it suits its role in plant cell walls.",
     ["B1: β-glucose monomers joined by 1,4 glycosidic bonds, alternate ones rotated 180°", "B1: long straight chains held together by many hydrogen bonds into microfibrils", "B1: giving high tensile strength, so the wall resists bursting when the cell is turgid"], None),
    ("11", "2", "Distinguish between active and passive immunity, giving one example of each.",
     ["B1: active: the person's own immune system makes antibodies after meeting an antigen", "B1: example: vaccination, or recovering from an infection", "B1: passive: antibodies are given from outside; no memory cells form, so it is short-lived", "B1: example: antibodies across the placenta or in breast milk, or an injection of antibodies"], None),
]

Q["alevel/eco"] = [
    ("2", "2", "When the price of a good rises from $10 to $12, the quantity demanded falls from 500 to 450 units. Calculate the price elasticity of demand and explain what happens to total revenue.",
     ["M1: % change in quantity = −10%; % change in price = +20%", "A1: PED = −0.5", "B1: demand is price inelastic", "B1: total revenue rises, from $5000 to $5400"], "PED = −0.5"),
    ("3", "2", "Explain why a maximum price set below the equilibrium price may lead to a shortage and a black market.",
     ["B1: at the lower price quantity demanded rises", "B1: and quantity supplied falls", "B1: so there is excess demand (a shortage)", "B1: some buyers will pay more than the legal price, so goods are sold illegally above it"], None),
    ("4", "2", "Distinguish between demand-pull and cost-push inflation.",
     ["B1: demand-pull: aggregate demand rises faster than aggregate supply / the economy's capacity", "B1: an example cause: rising consumer spending, lower interest rates, more government spending", "B1: cost-push: rising costs of production push up the price level (AS shifts left)", "B1: an example cause: higher wages, oil or import prices, a weaker exchange rate"], None),
    ("6", "2", "A worker in Country A can make 10 units of wheat or 5 units of cloth. A worker in Country B can make 6 units of wheat or 6 units of cloth. Explain which country has a comparative advantage in each good.",
     ["M1: opportunity cost of 1 cloth: A gives up 2 wheat, B gives up 1 wheat", "M1: opportunity cost of 1 wheat: A gives up 0.5 cloth, B gives up 1 cloth", "B1: A has the comparative advantage in wheat", "B1: B has the comparative advantage in cloth, so each should specialise and trade"], None),
    ("1", "2", "Use a production possibility curve to explain the meaning of opportunity cost.",
     ["B1: opportunity cost is the next best alternative given up", "B1: a PPC shows the combinations of two goods that can be made with all resources fully used", "B1: moving along the curve, making more of one good means making less of the other: that amount is the opportunity cost"], None),
    ("5", "2", "Explain how a rise in the central bank's rate of interest might reduce inflation.",
     ["B1: borrowing becomes more expensive and saving more rewarding", "B1: so consumption and investment fall", "B1: aggregate demand falls (also via a stronger exchange rate cutting net exports)", "B1: so demand-pull pressure on the price level eases"], None),
]

Q["alevel/bus"] = [
    ("5", "2", "A business has fixed costs of $24 000 a month. It sells its product for $20 and the variable cost is $12 a unit. Calculate the break-even output and the margin of safety when it sells 4000 units.",
     ["M1: contribution per unit = $20 − $12 = $8", "A1: break-even = 24 000 ÷ 8 = 3000 units", "M1: margin of safety = 4000 − 3000", "A1: = 1000 units"], "3000 units; margin of safety 1000 units"),
    ("3", "1", "Explain two elements of the marketing mix a business could use to launch a new smartphone.",
     ["B1: one element identified, e.g. price (penetration or skimming)", "B1: explained in context, e.g. skimming earns high profit from early adopters", "B1: a second element, e.g. promotion (social media, influencers) or place (online and retail)", "B1: explained in context, e.g. reaching young buyers where they shop"], None),
    ("2", "1", "Explain two non-financial methods a manager could use to motivate employees.",
     ["B1: one method, e.g. job enrichment / job rotation / empowerment / team working", "B1: explained, e.g. more responsible, varied work meets higher-level needs (Maslow, Herzberg's motivators)", "B1: a second method, e.g. recognition / training / delegation", "B1: explained, e.g. employees feel valued, so effort and retention rise"], None),
    ("4", "2", "A factory can make 5000 units a month and makes 3500. Calculate its capacity utilisation and explain one problem of operating at this level.",
     ["M1: 3500 ÷ 5000 × 100", "A1: = 70%", "B1: fixed costs are spread over fewer units, so the average cost per unit is higher (or idle resources, lower morale)"], "70%"),
    ("1", "1", "Explain two differences between a private limited company and a public limited company.",
     ["B1: a public limited company can sell shares to the public on a stock exchange", "B1: a private limited company can only sell shares privately, with the agreement of other shareholders", "B1: a public company must publish more detailed accounts", "B1: so it can raise much more capital but risks takeover"], None),
    ("5", "2", "A business has current assets of $45 000, of which $15 000 is inventory, and current liabilities of $30 000. Calculate its current ratio and acid test ratio.",
     ["M1: current ratio = 45 000 ÷ 30 000", "A1: = 1.5 : 1", "M1: acid test = (45 000 − 15 000) ÷ 30 000", "A1: = 1 : 1"], "1.5 : 1 and 1 : 1"),
]

Q["alevel/cs"] = [
    ("1", "1", "Convert the denary number −45 into an 8-bit two's complement binary integer. Show your working.",
     ["M1: +45 = 00101101", "M1: invert the bits: 11010010", "A1: add 1: 11010011"], "11010011"),
    ("1", "1", "A bitmap image is 1024 × 768 pixels with a colour depth of 24 bits. Calculate the file size in mebibytes (MiB), ignoring any header.",
     ["M1: 1024 × 768 × 24 bits, or × 3 bytes", "M1: = 2 359 296 bytes", "A1: ÷ 1024 ÷ 1024 = 2.25 MiB"], "2.25 MiB"),
    ("3", "1", "Describe two differences between static RAM (SRAM) and dynamic RAM (DRAM).",
     ["B1: SRAM uses flip-flops; DRAM stores bits as charge in capacitors", "B1: DRAM must be refreshed regularly; SRAM does not", "B1: SRAM is faster to access, so it is used for cache", "B1: DRAM is cheaper per bit and denser, so it is used for main memory"], None),
    ("8", "1", "Explain what is meant by a foreign key, with an example from a school database with the tables STUDENT and CLASS.",
     ["B1: an attribute in one table that is the primary key of another table", "B1: it is used to create a relationship between the two tables", "B1: e.g. ClassID in STUDENT links to ClassID, the primary key of CLASS"], None),
    ("9", "2", "Write pseudocode for a function LinearSearch(Items, Target) that returns the index of Target in the 1D array Items[1:100], or −1 if it is not found.",
     ["M1: function header with parameters and RETURNS INTEGER", "M1: a loop over indices 1 to 100", "M1: compares Items[Index] with Target", "M1: returns Index as soon as it is found", "M1: returns −1 after the loop if not found"], None),
    ("10", "2", "A stack is held in a 1D array Stack[1:50] with a variable TopPointer (0 when empty). Describe how an item is pushed onto the stack.",
     ["B1: check whether the stack is full (TopPointer = 50)", "B1: if full, report an error / do not add", "B1: otherwise increment TopPointer by 1", "B1: store the item at Stack[TopPointer]"], None),
    ("4", "1", "Describe the roles of the program counter (PC) and the memory address register (MAR) in the fetch stage of the fetch–execute cycle.",
     ["B1: the PC holds the address of the next instruction", "B1: this address is copied to the MAR", "B1: the instruction at the address in the MAR is fetched into the MDR (then CIR)", "B1: the PC is incremented to point to the next instruction"], None),
]

Q["alevel/acc"] = [
    ("2", "2", "A machine cost $50 000 and is depreciated at 20% a year using the reducing balance method. Calculate the depreciation for years 1 and 2 and the net book value at the end of year 2.",
     ["M1: year 1: 20% × 50 000 = $10 000", "M1: net book value after year 1 = $40 000", "M1: year 2: 20% × 40 000 = $8000", "A1: net book value = $32 000"], "$10 000, $8000; NBV $32 000"),
    ("4", "2", "A business has revenue of $200 000 and cost of sales of $140 000. Calculate its gross margin and its mark-up.",
     ["M1: gross profit = $60 000", "A1: gross margin = 60 000 ÷ 200 000 × 100 = 30%", "M1: mark-up = 60 000 ÷ 140 000 × 100", "A1: = 42.9%"], "30%; 42.9%"),
    ("2", "2", "Trade receivables are $40 000. The allowance for irrecoverable debts is to be 5% of trade receivables; last year's allowance was $1500. Calculate the entry in the income statement and the net figure shown in the statement of financial position.",
     ["M1: new allowance = 5% × 40 000 = $2000", "A1: increase of $500 charged to the income statement", "A1: trade receivables shown as 40 000 − 2000 = $38 000"], "$500 expense; $38 000"),
    ("5", "2", "A firm with spare capacity is offered a one-off order for 500 units at $15 each. The variable cost is $11 a unit and fixed costs are already covered. Advise whether to accept, with one non-financial factor.",
     ["M1: contribution per unit = 15 − 11 = $4", "A1: total contribution = 500 × 4 = $2000, so profit rises: accept", "B1: one non-financial factor, e.g. regular customers may ask for the same low price", "B1: or the order may lead to future business / uses idle staff"], "Accept: +$2000"),
    ("3", "2", "A and B are partners. A's capital is $50 000 and B's $30 000. Interest on capital is 5%, B receives a salary of $10 000, and remaining profits are shared 3 : 2. Profit for the year is $60 000. Prepare the figures for the appropriation account.",
     ["M1: interest on capital: A $2500, B $1500", "M1: B's salary $10 000", "M1: residual profit = 60 000 − 4000 − 10 000 = $46 000", "A1: A's share = $27 600", "A1: B's share = $18 400"], None),
]

Q["alevel/psy"] = [
    ("1", "2", "Explain one difference between an independent measures design and a repeated measures design, and give one advantage of each.",
     ["B1: independent measures: different participants in each condition; repeated: the same participants do every condition", "B1: advantage of independent measures: no order effects (practice, fatigue)", "B1: advantage of repeated measures: no participant variables between conditions", "B1: or fewer participants are needed for repeated measures"], None),
    ("1", "2", "A researcher wants to test whether doodling while listening improves recall of a phone message. Write a directional hypothesis and identify the independent and dependent variables.",
     ["B1: e.g. participants who doodle will recall more names from the message than those who do not", "B1: IV: whether the participant doodles or not", "B1: DV: the number of items correctly recalled (operationalised)"], None),
    ("1", "2", "Explain what is meant by inter-rater reliability and suggest how a researcher could improve it in an observation.",
     ["B1: the extent to which two or more observers record the same behaviour in the same way", "B1: improve by using clear, operationalised behavioural categories", "B1: and by training observers together / comparing scores and checking correlation"], None),
    ("5", "1", "Describe the results of Milgram's (1963) study of obedience.",
     ["B1: 26 of the 40 participants (65%) went to the maximum 450 V", "B1: all participants went to at least 300 V", "B1: many showed signs of extreme stress, e.g. sweating, trembling, nervous laughter"], None),
    ("4", "1", "Bandura et al. (1961) studied the imitation of aggression. Describe two findings of the study.",
     ["B1: children who saw an aggressive model imitated more physical and verbal aggression than those who saw a non-aggressive model or no model", "B1: elaborated, e.g. hitting the Bobo doll with the mallet in the same way", "B1: boys showed more imitative physical aggression than girls", "B1: children (especially boys) imitated a same-sex model more"], None),
]

Q["alevel/soc"] = [
    ("2", "1", "Explain two strengths of using participant observation in sociological research.",
     ["B1: a strength: high validity / rich qualitative data", "B1: explained: the researcher sees behaviour in its natural setting and from the group's point of view (verstehen)", "B1: a second strength: access to hidden or deviant groups", "B1: explained: trust built over time lets the researcher see what interviews would miss"], None),
    ("1", "1", "Explain what is meant by socialisation, referring to two agencies of socialisation.",
     ["B1: the process of learning the norms and values of a culture", "B1: primary socialisation, e.g. the family, in early childhood", "B1: secondary socialisation, e.g. school, peers, the media, religion", "B1: explained how one agency transmits norms, e.g. sanctions, role models"], None),
    ("3", "2", "Explain two ways in which family roles may have changed in modern industrial societies.",
     ["B1: one change, e.g. more symmetrical / joint conjugal roles", "B1: explained, e.g. more women in paid work, men sharing domestic tasks (Young and Willmott)", "B1: a second change, e.g. the 'dual burden' / changing children's roles / more lone-parent households", "B1: explained with a reason or evidence"], None),
    ("2", "1", "Explain the difference between reliability and validity in research.",
     ["B1: reliability: research that can be repeated with the same results", "B1: e.g. standardised methods such as structured questionnaires are more reliable", "B1: validity: research that gives a true picture of what it set out to study", "B1: e.g. qualitative methods such as unstructured interviews are often more valid"], None),
]

Q["igcse/phy"] = [
    ("1.2", "4", "A car accelerates uniformly from 5.0 m/s to 25 m/s in 8.0 s. Calculate its acceleration and the distance it travels in this time.",
     ["C1: a = (25 − 5.0) ÷ 8.0", "A1: a = 2.5 m/s²", "C1: distance = average speed × time = 15 × 8.0", "A1: = 120 m"], "2.5 m/s²; 120 m"),
    ("1.4", "4", "A stone of mass 240 g is lowered into a measuring cylinder. The water level rises from 50 cm³ to 146 cm³. Calculate the density of the stone.",
     ["C1: volume = 146 − 50 = 96 cm³", "C1: density = 240 ÷ 96", "A1: = 2.5 g/cm³"], "2.5 g/cm³"),
    ("1.7", "4", "A student of mass 60 kg climbs a flight of stairs 3.0 m high in 4.0 s. Calculate the useful power developed. (g = 9.8 N/kg)",
     ["C1: work done = mgh = 60 × 9.8 × 3.0", "A1: = 1764 J", "C1: power = 1764 ÷ 4.0", "A1: = 440 W (441 W)"], "440 W"),
    ("4.3", "4", "Resistors of 6.0 Ω and 3.0 Ω are connected in parallel to a 6.0 V supply. Calculate the combined resistance and the current from the supply.",
     ["C1: 1/R = 1/6.0 + 1/3.0", "A1: R = 2.0 Ω", "A1: I = 6.0 ÷ 2.0 = 3.0 A"], "2.0 Ω; 3.0 A"),
    ("3.2", "4", "Light passes from air into glass. The angle of incidence is 40° and the angle of refraction is 25°. Calculate the refractive index of the glass.",
     ["C1: n = sin i ÷ sin r", "C1: = sin 40° ÷ sin 25° = 0.643 ÷ 0.423", "A1: = 1.5 (1.52)"], "1.5"),
    ("5.2", "4", "A radioactive source has a half-life of 6 hours and an activity of 800 Bq. Calculate its activity after 24 hours.",
     ["C1: 24 h = 4 half-lives", "A1: 800 → 400 → 200 → 100 → 50 Bq"], "50 Bq"),
    ("1.8", "4", "Calculate the pressure due to the water at a depth of 12 m. (Density of water = 1000 kg/m³, g = 9.8 N/kg)",
     ["C1: p = ρgh = 1000 × 9.8 × 12", "A1: = 1.2 × 10⁵ Pa (117 600 Pa)"], "1.2 × 10⁵ Pa"),
    ("2.2", "4", "Calculate the energy needed to heat 0.50 kg of water from 20 °C to 80 °C. (Specific heat capacity of water = 4200 J/(kg °C))",
     ["C1: E = mcΔT = 0.50 × 4200 × 60", "A1: = 126 000 J"], "126 000 J"),
]

Q["igcse/chem"] = [
    ("3", "4", "Calcium carbonate decomposes on heating: CaCO₃ → CaO + CO₂. Calculate the mass of calcium oxide made from 25 g of calcium carbonate. (Ar: Ca = 40, C = 12, O = 16)",
     ["M1: Mr(CaCO₃) = 100, so moles = 25 ÷ 100 = 0.25", "M1: moles of CaO = 0.25 (1 : 1)", "A1: mass = 0.25 × 56 = 14 g"], "14 g"),
    ("4", "4", "Concentrated aqueous sodium chloride is electrolysed using inert electrodes. Name the products at each electrode and write the ionic half-equation at the cathode.",
     ["B1: anode (positive): chlorine", "B1: cathode (negative): hydrogen", "B1: 2H⁺ + 2e⁻ → H₂", "B1: the solution left contains sodium hydroxide"], None),
    ("7", "4", "Describe how to prepare pure, dry crystals of copper(II) sulfate from copper(II) oxide and dilute sulfuric acid.",
     ["B1: warm the acid and add copper(II) oxide until some is left over (excess)", "B1: filter to remove the excess copper(II) oxide", "B1: heat the filtrate to evaporate some water, to the point of crystallisation", "B1: leave to cool so crystals form", "B1: filter off the crystals and dry them between filter papers"], None),
    ("6", "4", "Use collision theory to explain why increasing the concentration of an acid increases the rate of its reaction with magnesium.",
     ["B1: more acid particles in the same volume", "B1: so more frequent collisions between particles", "B1: more successful collisions per second"], None),
    ("11", "4", "Ethene can be made into poly(ethene). Name this type of polymerisation and describe a test that shows ethene is unsaturated.",
     ["B1: addition polymerisation", "B1: add bromine water", "B1: it changes from orange to colourless"], None),
    ("8", "4", "Explain why the Group I metals become more reactive down the group.",
     ["B1: the atoms get larger, with more electron shells", "B1: so the outer electron is further from the nucleus / more shielded, less strongly attracted", "B1: so it is lost more easily"], None),
]

Q["igcse/bio"] = [
    ("6", "4", "Write the balanced chemical equation for photosynthesis and explain why increasing light intensity stops increasing the rate of photosynthesis above a certain point.",
     ["B1: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂ (light, chlorophyll)", "B1: another factor becomes limiting", "B1: e.g. carbon dioxide concentration or temperature"], None),
    ("5", "4", "Explain why the activity of an enzyme falls when the temperature rises above its optimum.",
     ["B1: the enzyme is denatured", "B1: the shape of the active site changes", "B1: so the substrate no longer fits / is no longer complementary, and fewer enzyme–substrate complexes form"], None),
    ("9", "4", "Explain why the wall of the left ventricle is thicker than the wall of the right ventricle.",
     ["B1: the left ventricle pumps blood all around the body (the right only to the lungs)", "B1: so it needs more muscle to create a higher pressure"], None),
    ("17", "4", "In pea plants the allele for tall (T) is dominant to the allele for short (t). Two heterozygous tall plants are crossed. Use a genetic diagram to find the expected percentage of short offspring.",
     ["B1: parents Tt × Tt", "B1: gametes T and t from each parent", "B1: offspring TT, Tt, Tt, tt", "B1: 1 in 4 short: 25%"], "25%"),
    ("3", "4", "Define osmosis and explain why potato strips placed in a concentrated sugar solution lose mass.",
     ["B1: the net movement of water molecules from a region of higher water potential to a region of lower water potential through a partially permeable membrane", "B1: the solution has a lower water potential than the potato cells", "B1: so water leaves the cells by osmosis"], None),
    ("12", "4", "Describe anaerobic respiration in human muscles during vigorous exercise and explain why breathing stays fast after exercise ends.",
     ["B1: glucose is broken down to lactic acid without oxygen", "B1: releasing much less energy than aerobic respiration", "B1: afterwards extra oxygen is needed to break down the lactic acid (oxygen debt)"], None),
]

Q["igcse/eco"] = [
    ("2", "2", "Explain two factors that could cause the supply of a product to increase.",
     ["B1: one factor, e.g. lower costs of production (raw materials, wages)", "B1: explained: more profitable to produce at each price, so the supply curve shifts right", "B1: a second factor, e.g. improved technology / a subsidy / good weather", "B1: explained with its effect on supply"], None),
    ("4", "2", "Explain two causes of unemployment.",
     ["B1: one cause, e.g. cyclical: a fall in aggregate demand in a recession", "B1: explained: firms produce less, so need fewer workers", "B1: a second cause, e.g. structural: decline of an industry / skills mismatch, or frictional", "B1: explained with how it creates unemployment"], None),
    ("2", "2", "The price of a good falls from $5 to $4 and the quantity demanded rises from 100 to 130 units. Calculate the price elasticity of demand and state whether demand is elastic or inelastic.",
     ["M1: % change in quantity = +30%, % change in price = −20%", "A1: PED = −1.5", "B1: elastic (greater than 1, ignoring the sign)"], "−1.5, elastic"),
    ("6", "2", "Explain two benefits of free trade for a country.",
     ["B1: one benefit, e.g. countries specialise where they have a comparative advantage", "B1: explained: more output overall, lower costs and prices", "B1: a second benefit, e.g. more choice for consumers / bigger markets for firms / competition raising efficiency", "B1: explained"], None),
]

Q["igcse/bus"] = [
    ("5", "1", "A business sells 2000 units at $15 each. Its fixed costs are $8000 and its variable cost is $6 a unit. Calculate its profit.",
     ["M1: revenue = 2000 × 15 = $30 000", "M1: total costs = 8000 + 2000 × 6 = $20 000", "A1: profit = $10 000"], "$10 000"),
    ("2", "1", "Explain two methods of training new employees.",
     ["B1: induction training: introduces the business, its rules and the people", "B1: explained, e.g. helps new workers settle in quickly and become productive", "B1: on-the-job or off-the-job training", "B1: explained with an advantage, e.g. on-the-job is cheap and practical"], None),
    ("3", "1", "Explain two methods of primary market research a new café could use.",
     ["B1: questionnaires / surveys", "B1: advantage in context, e.g. asks local people what food and prices they want", "B1: a second method, e.g. observation / interviews / focus groups / test marketing", "B1: advantage in context"], None),
    ("1", "1", "Explain two differences between a sole trader and a partnership.",
     ["B1: a sole trader is owned by one person; a partnership by 2 to 20 partners", "B1: so a partnership can raise more capital / share skills and workload", "B1: decisions: a sole trader decides alone; partners must agree (may disagree)", "B1: profits shared between partners; a sole trader keeps all profit"], None),
]

Q["igcse/cs"] = [
    ("1", "1", "Convert the hexadecimal number 3F into 8-bit binary and into denary.",
     ["B1: 00111111", "B1: 63"], "00111111; 63"),
    ("1", "1", "A 10-second sound recording is sampled 44 100 times a second with a sample resolution of 16 bits, in mono. Calculate the file size in bytes.",
     ["M1: 44 100 × 16 × 10 = 7 056 000 bits", "M1: ÷ 8", "A1: = 882 000 bytes"], "882 000 bytes"),
    ("2", "1", "Describe how an even parity check is used to detect errors in data transmission.",
     ["B1: sender and receiver agree to use even parity", "B1: a parity bit is set so that each byte has an even number of 1s", "B1: the receiver counts the 1s; an odd number means an error has occurred"], None),
    ("10", "2", "An alarm (X) sounds when a door is open (D = 1) AND either the system is armed (A = 1) OR a window is open (W = 1). Write the logic expression.",
     ["B1: X = D AND (A OR W)", "B1: correct use of brackets so OR is evaluated first"], "X = D AND (A OR W)"),
    ("7", "2", "Write pseudocode that inputs 10 numbers and outputs the largest.",
     ["M1: initialise Largest with the first number (or a very small value)", "M1: a loop that runs 10 times", "M1: INPUT a number inside the loop", "M1: IF Number > Largest THEN Largest ← Number", "M1: OUTPUT Largest after the loop"], None),
    ("9", "2", "A table PRODUCT has fields ProductID, Name and Price. Write an SQL query to show the Name and Price of products costing more than 20, cheapest first.",
     ["B1: SELECT Name, Price", "B1: FROM PRODUCT", "B1: WHERE Price > 20", "B1: ORDER BY Price ASC"], None),
]

Q["igcse/acc"] = [
    ("4", "2", "A van cost $12 000 and is expected to last 5 years, with a residual value of $2000. Calculate the annual depreciation using the straight-line method and the net book value after 2 years.",
     ["M1: (12 000 − 2000) ÷ 5", "A1: = $2000 a year", "A1: net book value after 2 years = $8000"], "$2000; $8000"),
    ("6", "2", "A trader has current assets of $18 000 and current liabilities of $12 000. Calculate the current ratio and comment on it.",
     ["M1: 18 000 ÷ 12 000", "A1: = 1.5 : 1", "B1: comment, e.g. the business can cover its short-term debts, though below the 2 : 1 often suggested"], "1.5 : 1"),
    ("2", "2", "State the difference between an invoice and a credit note.",
     ["B1: an invoice is sent by the seller to a credit customer, showing the amount owed for goods sold", "B1: a credit note is sent by the seller to reduce the amount owed, e.g. for returned or faulty goods"], None),
    ("5", "2", "Revenue was $80 000. Opening inventory was $6000, purchases $50 000 and closing inventory $8000. Calculate the cost of sales and the gross profit.",
     ["M1: cost of sales = 6000 + 50 000 − 8000", "A1: = $48 000", "A1: gross profit = 80 000 − 48 000 = $32 000"], "$48 000; $32 000"),
]

def main(root):
    total = 0
    for f, items in Q.items():
        path = f"{root}/students/assets/syllabus/{f}.json"
        bank = json.load(open(path))
        topics = {t["id"]: t for t in bank["topics"]}
        for tid, paper, q, scheme, ans in items:
            t = topics[tid]
            entry = {"q": q, "marks": len(scheme), "paper": paper, "scheme": scheme}
            if ans:
                entry["ans"] = ans
            t.setdefault("long", [])
            if any(x["q"] == q for x in t["long"]):
                continue
            t["long"].append(entry)
            total += 1
        json.dump(bank, open(path, "w"), ensure_ascii=False, indent=2)
    print("added", total)

main(sys.argv[1])
