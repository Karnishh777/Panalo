# Additional Mathematics 0606 and Further Mathematics 9231.
# Topic: (id, name, stage or None, [ (q, [4 options], answer index, why) ])
# Long: (topic id, paper, q, [scheme lines], answer or None)

BANKS = {}

BANKS["igcse/amath"] = dict(
    subject="amath", name="Additional Mathematics", board="Cambridge IGCSE", code="0606",
    topics=[
        ("1", "Functions", None, [
            ("If f(x) = 2x + 3, what is f⁻¹(x)?", ["(x − 3)/2", "2x − 3", "(x + 3)/2", "1/(2x + 3)"], 0, "Swap x and y in y = 2x + 3 and solve: x = (y − 3)/2."),
            ("If f(x) = x² and g(x) = x + 1, what is fg(x)?", ["(x + 1)²", "x² + 1", "x² + x", "2x + 1"], 0, "fg(x) means f(g(x)): square the whole of x + 1."),
            ("Which function has an inverse over all real x?", ["f(x) = x³", "f(x) = x²", "f(x) = |x|", "f(x) = cos x"], 0, "Only a one-one function has an inverse; x³ is one-one, the others are not."),
        ]),
        ("2", "Quadratic functions", None, [
            ("For what values of k does x² + kx + 9 = 0 have equal roots?", ["k = ±6", "k = ±3", "k = 9", "k = 0"], 0, "Equal roots when b² − 4ac = 0: k² − 36 = 0."),
            ("The minimum point of y = (x − 2)² + 5 is", ["(2, 5)", "(−2, 5)", "(2, −5)", "(5, 2)"], 0, "Completed-square form a(x − p)² + q has its vertex at (p, q)."),
            ("x² − 5x + 6 < 0 is true for", ["2 < x < 3", "x < 2 or x > 3", "x > 6", "−3 < x < −2"], 0, "The roots are 2 and 3; a positive quadratic is negative between its roots."),
        ]),
        ("3", "Factors of polynomials", None, [
            ("The remainder when x³ − 2x + 5 is divided by (x − 1) is", ["4", "6", "2", "0"], 0, "Remainder theorem: p(1) = 1 − 2 + 5 = 4."),
            ("(x + 2) is a factor of p(x) if", ["p(−2) = 0", "p(2) = 0", "p(0) = 2", "p(−2) = 2"], 0, "Factor theorem: (x − a) is a factor when p(a) = 0; here a = −2."),
        ]),
        ("4", "Equations, inequalities and graphs", None, [
            ("Solve |x − 3| = 5.", ["x = 8 or x = −2", "x = 8 only", "x = 2 or x = −8", "x = ±5"], 0, "x − 3 = 5 or x − 3 = −5."),
            ("The graph of y = |2x − 4| meets the x-axis at", ["x = 2", "x = −2", "x = 4", "x = 0 and x = 4"], 0, "The modulus is zero only where 2x − 4 = 0."),
        ]),
        ("5", "Simultaneous equations", None, [
            ("Solving y = x + 1 and y = x² − 1 gives x =", ["2 or −1", "1 or −2", "0 or 1", "2 only"], 0, "x² − 1 = x + 1 so x² − x − 2 = 0, (x − 2)(x + 1) = 0."),
            ("A line meets a curve where", ["their equations are satisfied together", "their gradients are equal", "their y-intercepts are equal", "x = 0"], 0, "Intersections are the common solutions of the two equations."),
        ]),
        ("6", "Logarithmic and exponential functions", None, [
            ("log₂ 32 =", ["5", "16", "6", "4"], 0, "Because 2⁵ = 32."),
            ("log a + log b =", ["log ab", "log (a + b)", "log a · log b", "log (a/b)"], 0, "The product rule for logarithms."),
            ("Solve 3ˣ = 20 (to 3 s.f.).", ["2.73", "6.67", "1.30", "2.99"], 0, "x = ln 20 ÷ ln 3 ≈ 2.73."),
        ]),
        ("7", "Straight-line graphs", None, [
            ("To turn y = axⁿ into a straight line, plot", ["lg y against lg x", "y against x", "y against lg x", "lg y against x"], 0, "lg y = lg a + n lg x: gradient n, intercept lg a."),
            ("The line through (1, 2) with gradient 3 is", ["y = 3x − 1", "y = 3x + 2", "y = 2x + 3", "y = 3x + 1"], 0, "y − 2 = 3(x − 1)."),
        ]),
        ("8", "Coordinate geometry of the circle", None, [
            ("The circle (x − 2)² + (y + 1)² = 16 has centre and radius", ["(2, −1), 4", "(−2, 1), 4", "(2, −1), 16", "(2, 1), 4"], 0, "(x − a)² + (y − b)² = r²."),
            ("A tangent to a circle is ___ to the radius at the point of contact.", ["perpendicular", "parallel", "equal", "at 45°"], 0, "So its gradient is the negative reciprocal of the radius's."),
        ]),
        ("9", "Circular measure", None, [
            ("The arc length of a sector of radius 5 cm and angle 1.2 rad is", ["6 cm", "15 cm", "4.17 cm", "30 cm"], 0, "s = rθ = 5 × 1.2."),
            ("The area of a sector of radius r and angle θ radians is", ["½r²θ", "rθ", "r²θ", "πr²θ"], 0, "A fraction θ/2π of πr²."),
        ]),
        ("10", "Trigonometry", None, [
            ("sin²x + cos²x =", ["1", "0", "tan x", "2"], 0, "The Pythagorean identity."),
            ("By definition, sec x =", ["1/cos x", "1/sin x", "1/tan x", "cos x/sin x"], 0, "secant is the reciprocal of cosine."),
            ("The period of y = sin 2x is", ["180°", "360°", "90°", "720°"], 0, "y = sin bx has period 360°/b."),
        ]),
        ("11", "Permutations and combinations", None, [
            ("How many ways can 5 different books be arranged in a row?", ["120", "25", "60", "5"], 0, "5! = 5 × 4 × 3 × 2 × 1 = 120."),
            ("The value of ⁶C₂ is", ["15", "30", "12", "36"], 0, "6!/(2!4!) = 15."),
        ]),
        ("12", "Series", None, [
            ("The 10th term of the arithmetic progression 3, 7, 11, … is", ["39", "43", "40", "36"], 0, "a + 9d = 3 + 36."),
            ("The sum to infinity of 8 + 4 + 2 + … is", ["16", "14", "∞", "12"], 0, "a/(1 − r) = 8/0.5."),
            ("The coefficient of x² in (1 + 2x)⁵ is", ["40", "10", "20", "80"], 0, "⁵C₂ × 2² = 10 × 4."),
        ]),
        ("13", "Vectors in two dimensions", None, [
            ("The magnitude of 3i + 4j is", ["5", "7", "1", "25"], 0, "√(3² + 4²)."),
            ("If OA = a and OB = b, then AB =", ["b − a", "a − b", "a + b", "½(a + b)"], 0, "AB = AO + OB = −a + b."),
        ]),
        ("14", "Differentiation and integration", None, [
            ("d/dx (x³) =", ["3x²", "x²", "3x³", "x⁴/4"], 0, "Bring the power down and subtract one."),
            ("d/dx (sin 3x) =", ["3 cos 3x", "cos 3x", "−3 cos 3x", "3 sin 3x"], 0, "Chain rule: derivative of the inside is 3."),
            ("∫ eˣ dx =", ["eˣ + c", "x eˣ + c", "eˣ⁺¹/(x + 1) + c", "ln x + c"], 0, "eˣ is its own derivative."),
            ("At a stationary point, dy/dx is", ["0", "1", "undefined", "negative"], 0, "The tangent is horizontal there."),
        ]),
    ],
    papers={"1": ("Paper 1", "written", 120, 80, "any", "all"), "2": ("Paper 2", "written", 120, 80, "any", "all")},
    routes={"igcse": ["1", "2"]},
    long=[
        ("2", "1", "Find the set of values of k for which the line y = kx − 1 does not meet the curve y = x² + 3.", ["M1: x² − kx + 4 = 0", "M1: no real roots: k² − 16 < 0", "A1: critical values k = ±4", "A1: −4 < k < 4"], "−4 < k < 4"),
        ("3", "1", "p(x) = 2x³ + ax² − 7x + 6. Given that (x − 1) is a factor of p(x), find a and hence factorise p(x) completely.", ["M1: p(1) = 2 + a − 7 + 6 = 0", "A1: a = −1", "M1: divide by (x − 1): 2x² + x − 6", "A1: p(x) = (x − 1)(2x − 3)(x + 2)"], "a = −1; (x − 1)(2x − 3)(x + 2)"),
        ("6", "2", "Solve log₃(x + 6) − log₃ x = 2.", ["M1: log₃((x + 6)/x) = 2", "M1: (x + 6)/x = 9", "A1: x = 3/4"], "x = 0.75"),
        ("9", "2", "A sector OAB has radius 8 cm and angle AOB = 0.9 radians. Find the perimeter and the area of the sector.", ["M1: arc AB = 8 × 0.9 = 7.2 cm", "A1: perimeter = 7.2 + 16 = 23.2 cm", "M1: area = ½ × 8² × 0.9", "A1: = 28.8 cm²"], "23.2 cm; 28.8 cm²"),
        ("10", "1", "Solve 2 sin²x = 3 cos x for 0° ≤ x ≤ 360°.", ["M1: 2(1 − cos²x) = 3 cos x", "M1: 2cos²x + 3 cos x − 2 = 0, (2cos x − 1)(cos x + 2) = 0", "A1: cos x = ½ (cos x = −2 has no solution)", "A1: x = 60°, 300°"], "60°, 300°"),
        ("12", "2", "Find the first three terms in the expansion of (2 − x/4)⁶ in ascending powers of x, and hence the coefficient of x² in (1 + 2x)(2 − x/4)⁶.", ["B1: 64", "B1: − 48x", "B1: + 15x²", "M1: x² terms: 15 + 2 × (−48)", "A1: −81"], "64 − 48x + 15x²; −81"),
        ("14", "1", "A curve has equation y = x³ − 6x² + 9x + 2. Find the coordinates of its stationary points and determine their nature.", ["M1: dy/dx = 3x² − 12x + 9", "M1: = 0 gives x = 1, x = 3", "A1: (1, 6) and (3, 2)", "M1: d²y/dx² = 6x − 12", "A1: (1, 6) maximum, (3, 2) minimum"], "(1, 6) max; (3, 2) min"),
        ("14", "2", "Find the area enclosed by the curve y = 4x − x² and the x-axis.", ["M1: limits x = 0 and x = 4", "M1: ∫(4x − x²) dx = 2x² − x³/3", "A1: area = 32 − 64/3 = 32/3"], "32/3"),
    ],
)

BANKS["alevel/fmath"] = dict(
    subject="fmath", name="Further Mathematics", board="Cambridge International AS & A Level", code="9231",
    topics=[
        ("F1.1", "FP1: Roots of polynomial equations", "as", [
            ("If α, β, γ are the roots of x³ − 4x² + 2x − 7 = 0, then α + β + γ =", ["4", "−4", "7", "2"], 0, "Sum of roots = −b/a."),
            ("For the same cubic, αβγ =", ["7", "−7", "2", "4"], 0, "Product of roots of ax³ + bx² + cx + d is −d/a."),
        ]),
        ("F1.2", "FP1: Rational functions and graphs", "as", [
            ("The vertical asymptote of y = (2x + 1)/(x − 3) is", ["x = 3", "x = −3", "y = 2", "x = −½"], 0, "The denominator is zero at x = 3."),
            ("The horizontal asymptote of y = (2x + 1)/(x − 3) is", ["y = 2", "y = 0", "y = 3", "y = −1/3"], 0, "As x → ±∞, y → 2x/x = 2."),
        ]),
        ("F1.3", "FP1: Summation of series", "as", [
            ("Σ r from r = 1 to n =", ["½n(n + 1)", "n(n + 1)", "n²", "⅙n(n + 1)(2n + 1)"], 0, "The standard result."),
            ("The method of differences works when each term can be written as", ["f(r) − f(r + 1)", "f(r) × f(r + 1)", "f(r)²", "1/f(r)"], 0, "Then most terms cancel in pairs."),
        ]),
        ("F1.4", "FP1: Matrices", "as", [
            ("det [[2, 1], [5, 3]] =", ["1", "11", "−1", "6"], 0, "2 × 3 − 1 × 5."),
            ("A matrix has no inverse when", ["its determinant is 0", "it is square", "its determinant is 1", "it is symmetric"], 0, "A singular matrix has determinant zero."),
            ("For invertible A and B, (AB)⁻¹ =", ["B⁻¹A⁻¹", "A⁻¹B⁻¹", "AB", "BA"], 0, "Inverses reverse the order."),
        ]),
        ("F1.5", "FP1: Polar coordinates", "as", [
            ("The area enclosed by r = f(θ) between θ = α and θ = β is", ["½∫ r² dθ", "∫ r dθ", "∫ r² dθ", "½∫ r dθ"], 0, "Each thin sector has area ½r² δθ."),
            ("The point with Cartesian coordinates (0, 2) has polar coordinates", ["(2, π/2)", "(2, 0)", "(0, 2)", "(2, π)"], 0, "r = 2 along the positive y-axis, θ = π/2."),
        ]),
        ("F1.6", "FP1: Vectors", "as", [
            ("The vector product a × b is", ["perpendicular to a and b", "parallel to a", "a scalar", "always zero"], 0, "a × b is normal to the plane of a and b."),
            ("Two planes are perpendicular when their normals have scalar product", ["0", "1", "−1", "equal to their lengths"], 0, "Perpendicular normals mean perpendicular planes."),
        ]),
        ("F1.7", "FP1: Proof by induction", "as", [
            ("Proof by induction needs a base case and", ["the inductive step from k to k + 1", "a counter-example", "proof by contradiction", "the case n = 0 only"], 0, "Assume true for k, show true for k + 1."),
        ]),
        ("F2.1", "FP2: Hyperbolic functions", "a2", [
            ("By definition, cosh x =", ["½(eˣ + e⁻ˣ)", "½(eˣ − e⁻ˣ)", "eˣ − e⁻ˣ", "1/sinh x"], 0, "The definition of cosh."),
            ("cosh²x − sinh²x =", ["1", "0", "−1", "cosh 2x"], 0, "The hyperbolic identity (compare cos² + sin² = 1)."),
        ]),
        ("F2.2", "FP2: Matrices (eigenvalues)", "a2", [
            ("The eigenvalues of a matrix A satisfy", ["det(A − λI) = 0", "A − λ = 0", "det A = λ", "Ax = 0"], 0, "The characteristic equation."),
        ]),
        ("F2.3", "FP2: Differentiation", "a2", [
            ("d/dx (tan⁻¹ x) =", ["1/(1 + x²)", "1/√(1 − x²)", "sec²x", "−1/(1 + x²)"], 0, "A standard result."),
        ]),
        ("F2.4", "FP2: Integration", "a2", [
            ("A reduction formula expresses Iₙ in terms of", ["Iₙ₋₁ or Iₙ₋₂", "Iₙ₊₁", "n only", "a constant"], 0, "Usually found by integrating by parts."),
        ]),
        ("F2.5", "FP2: Complex numbers", "a2", [
            ("By de Moivre's theorem, (cos θ + i sin θ)ⁿ =", ["cos nθ + i sin nθ", "cosⁿθ + i sinⁿθ", "n cos θ + i n sin θ", "cos θⁿ + i sin θⁿ"], 0, "de Moivre's theorem."),
            ("The cube roots of unity sum to", ["0", "1", "3", "−1"], 0, "1 + ω + ω² = 0."),
        ]),
        ("F2.6", "FP2: Differential equations", "a2", [
            ("The auxiliary equation of y″ − 5y′ + 6y = 0 has roots", ["2 and 3", "−2 and −3", "1 and 6", "5 and 6"], 0, "m² − 5m + 6 = 0."),
        ]),
        ("M3.1", "FM: Motion of a projectile", "as", [
            ("A projectile's horizontal velocity (no air resistance) is", ["constant", "zero at the top", "increasing", "equal to g"], 0, "No horizontal force acts."),
        ]),
        ("M3.2", "FM: Equilibrium of a rigid body", "as", [
            ("A rigid body is in equilibrium when the resultant force is zero and", ["the total moment about any point is zero", "it is at rest", "its weight is zero", "friction is limiting"], 0, "Both conditions are needed."),
        ]),
        ("M3.3", "FM: Circular motion", "as", [
            ("The acceleration of a particle moving in a circle at constant speed v, radius r, is", ["v²/r towards the centre", "zero", "v/r along the tangent", "rω outward"], 0, "Centripetal acceleration."),
        ]),
        ("M3.4", "FM: Hooke's law", "as", [
            ("The elastic potential energy stored in a string of modulus λ, natural length l, extension x is", ["λx²/(2l)", "λx/l", "½λx", "λl/x"], 0, "The standard result."),
        ]),
        ("M3.5", "FM: Linear motion under a variable force", "as", [
            ("Acceleration can be written as", ["v dv/dx", "dx/dt", "v/x", "x dv/dt"], 0, "a = dv/dt = (dv/dx)(dx/dt) = v dv/dx."),
        ]),
        ("M3.6", "FM: Momentum (oblique impact)", "as", [
            ("In an oblique impact of a sphere with a smooth wall, the velocity component parallel to the wall", ["is unchanged", "reverses", "is multiplied by e", "becomes zero"], 0, "A smooth wall exerts no force parallel to itself."),
        ]),
        ("S4.1", "FS: Continuous random variables", "as", [
            ("For a probability density function f, ∫ f(x) dx over all x =", ["1", "0", "the mean", "the median"], 0, "Total probability is 1."),
        ]),
        ("S4.2", "FS: Inferential statistics (t-tests)", "as", [
            ("A t-test is used instead of a z-test when", ["σ is unknown and the sample is small", "the data are discrete", "n is very large", "the mean is known"], 0, "With σ estimated from a small sample, the t-distribution applies."),
        ]),
        ("S4.3", "FS: Chi-squared tests", "as", [
            ("In a χ² test, expected frequencies should be at least", ["5", "1", "10", "0"], 0, "Combine classes if not."),
        ]),
        ("S4.4", "FS: Non-parametric tests", "as", [
            ("A sign test or Wilcoxon test is used when", ["no distribution can be assumed", "the population is normal", "σ is known", "n > 100"], 0, "Non-parametric tests make no distributional assumption."),
        ]),
        ("S4.5", "FS: Probability generating functions", "as", [
            ("For a PGF G(t), the mean is", ["G′(1)", "G(1)", "G″(1)", "G(0)"], 0, "Differentiate and set t = 1."),
        ]),
    ],
    papers={
        "1": ("Further Pure Mathematics 1", "written", 120, 75, "as", ["F1."]),
        "2": ("Further Pure Mathematics 2", "written", 120, 75, "a2", ["F2."]),
        "3": ("Further Mechanics", "written", 90, 50, "as", ["M3."]),
        "4": ("Further Probability & Statistics", "written", 90, 50, "as", ["S4."]),
    },
    routes={"as": ["1", "3"], "a2": ["1", "2", "3", "4"]},
    note="AS Further Mathematics is Paper 1 with Paper 3 or Paper 4; check your school's route.",
    long=[
        ("F1.1", "1", "The roots of x³ + 2x² − 3x + 5 = 0 are α, β and γ. Find the value of α² + β² + γ².", ["M1: α + β + γ = −2, αβ + βγ + γα = −3", "M1: α² + β² + γ² = (α + β + γ)² − 2(αβ + βγ + γα)", "A1: = 4 + 6 = 10"], "10"),
        ("F1.3", "1", "Use the method of differences to find Σ 1/(r(r + 1)) from r = 1 to n.", ["M1: 1/(r(r + 1)) = 1/r − 1/(r + 1)", "M1: terms cancel in pairs", "A1: = 1 − 1/(n + 1)"], "1 − 1/(n + 1)"),
        ("F1.4", "1", "M = [[3, 1], [2, 4]]. Find M⁻¹ and the image of the point (1, 1) under M.", ["M1: det M = 12 − 2 = 10", "A1: M⁻¹ = (1/10)[[4, −1], [−2, 3]]", "B1: image (4, 6)"], None),
        ("F1.7", "1", "Prove by induction that Σ r from r = 1 to n = ½n(n + 1) for all positive integers n.", ["B1: n = 1: both sides equal 1", "M1: assume true for n = k", "M1: add (k + 1): ½k(k + 1) + (k + 1) = ½(k + 1)(k + 2)", "A1: so true for n = k + 1, hence for all n by induction"], None),
        ("M3.3", "3", "A particle of mass 0.5 kg moves in a horizontal circle of radius 0.8 m at a constant speed of 4 m s⁻¹. Find the magnitude of the resultant force on it.", ["M1: F = mv²/r", "A1: = 0.5 × 16 ÷ 0.8 = 10 N"], "10 N"),
        ("S4.3", "4", "In a χ² goodness-of-fit test with 5 classes, the expected frequencies come from a distribution whose mean was estimated from the data. State the number of degrees of freedom and why.", ["B1: 5 − 1 − 1 = 3", "B1: one is lost because totals agree, one because a parameter (the mean) was estimated"], "3"),
    ],
)
