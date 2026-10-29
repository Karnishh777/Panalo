// What Cambridge's examiners say (v0.2): for each syllabus and paper, the
// advice that recurs in the Principal Examiner Reports for Teachers, in
// our own words and kept short. Shown beside exam-style questions and past
// papers, and given to Pan when it marks a photographed answer. Read from
// the June 2023 reports unless a note says otherwise.

export const SOURCE = "Cambridge Principal Examiner Reports, June 2023 (paraphrased)";

const MATHS_WORKING = "Show every step: no marks are given for unsupported answers from a calculator.";
const SF = "Work to at least 4 significant figures and give non-exact answers to 3 s.f. (angles to 1 d.p.) unless told otherwise.";

export const EXAMINER = {
  9709: {
    "*": [MATHS_WORKING, SF, "Read each question again when you finish: later parts often build on earlier ones."],
    1: ["For quadratics, show factorising, the formula with values substituted, or completing the square; check your factors expand back.", "For definite integrals, show the limits substituted, not just the calculator's value."],
    2: ["Give answers in exactly the form the question asks for, to the stated accuracy."],
    3: ["If an exact answer is asked for, a decimal approximation will not do.", "In a 'show that' question, write every step clearly; take extra care with basic algebra."],
    4: ["Draw a labelled force diagram first: it stops you missing a force in the equation."],
    5: ["Exact answers stay exact (fractions are fine); diagrams must be clear and labelled.", "When proving a given result, show every operation."],
    6: ["In hypothesis tests, conclusions must be in context and not overclaim.", "Only one solution: cross out, never overwrite."],
  },
  9702: {
    "*": ["Write the symbol equation first, then substitute; if you rearrange, state the new subject.", "Don't round intermediate values: early rounding changes the final answer.", "Learn definitions word for word: missing 'per unit' or one key word can lose the mark."],
    2: ["An incorrect final answer can still earn method marks, but only if the working is shown."],
    3: ["Calculated values should have as many significant figures as the least precise raw data; read graph points to half a small square."],
    4: ["Use technical words precisely: atom/molecule, nuclide/nucleus, force/field are not interchangeable.", "Definitions must be dimensionally correct; a symbol equation only counts if every symbol is defined."],
    5: ["Planning answers need detail: how variables are controlled, how each measurement is taken, how data are analysed."],
  },
  9701: {
    "*": ["Use precise chemical terminology; general wording loses marks.", "Answer 'explain' fully: state the rule or fact, then show how it leads to the result."],
    2: ["Learn definitions exactly, and check your calculations obey them.", "Show working; avoid early rounding."],
    4: ["Balance equations, ionic equations and half-equations for atoms and charge.", "Give answers to 3 s.f., keeping the full value between stages.", "Curly arrows must start from a bond or lone pair and end at an atom; label partial charges."],
    5: ["Practise half-lives from concentration–time graphs and titration calculations in unfamiliar settings."],
  },
  9700: {
    "*": ["When asked how structure relates to function, address both, not just one.", "Describe graphs with precise vocabulary: the rate of uptake increases steeply, then remains constant (not 'stops')."],
    3: ["Record results in a proper table even if they look wrong, and answer later parts from your actual results."],
    4: ["Learned lists only go so far: apply knowledge to the context given."],
    5: ["A plan must be logical and detailed enough for someone else to follow; don't repeat earlier details when told not to."],
  },
  9708: {
    "*": ["Answer to the command word: calculate, explain, consider and assess need different answers.", "Draw diagrams when asked for them, correctly and clearly labelled."],
    2: ["Some marks are for evaluation: reach a supported judgement.", "Include the formula when one is asked for (e.g. cross elasticity)."],
    4: ["'Evaluate' needs a developed judgement, not just a one-line comment.", "Read the whole question to catch its full breadth."],
  },
  9609: {
    "*": ["Learn precise definitions of key terms; vague definitions earn few marks.", "Use the case: interpret its data rather than repeating it."],
    1: ["Put context-rich evaluation in the conclusion, tied to the business in the question."],
    2: ["Questions a(i) and a(ii) test knowledge only: don't copy the case.", "An advantage must be to the business, not to another stakeholder."],
    3: ["Half the marks on some questions are for evaluation: make reasoned, supported judgements.", "Build analysis with chains of cause and effect."],
    4: ["Develop two or three points well rather than many briefly.", "Where the command word is 'evaluate', still give a clear answer."],
  },
  9706: {
    "*": ["Show clear workings in every calculation: method marks are always available.", "In 'explain' questions, one- or two-word answers seldom score."],
    1: ["For bank statements and cash books, check your answer with a bank reconciliation.", "Know the benefits and limitations of each costing method."],
    2: ["Present limited company statements in the accepted format; write labels in full (gross profit, cost of sales, total equity and liabilities) and get dates right."],
  },
  9618: {
    "*": ["Use correct technical terms: answers must be more detailed than at IGCSE.", "Match the command word: 'explain' needs more than 'state'."],
    1: ["Answer in the scenario's context; only the first answer in each numbered space is marked."],
    2: ["Describe algorithms as clearly defined steps; write meaningful pseudocode using the published pseudocode guide."],
    3: ["Show working when asked, and answer in the context of the scenario rather than generically."],
  },
  9990: {
    "*": ["Know every component of every core study: questions can ask about any part."],
    1: ["The final essay needs four in-depth evaluation points (two strengths, two weaknesses), at least one on the named issue."],
    2: ["When a question says 'in this study', link your answer to the scenario rather than just describing a concept."],
    3: ["Two-mark answers should be brief and precise; four-mark answers need detail on the named theory, study or treatment."],
    4: ["For top marks explain methodology, not just the procedure; Section C needs a two-sided debate with evidence."],
  },
  9699: {
    "*": ["Support points with sociological material: concepts, theories and research evidence.", "Evaluate explicitly; don't just place views side by side."],
    1: ["Give exactly what is asked: two clear, developed points where two are asked for.", "Keep essays balanced."],
    2: ["Keep the focus on the family, the unit's context.", "Essays should engage with competing views."],
  },
  9231: {
    "*": ["Show every step, especially when proving a given result.", "Use results from earlier parts and the List of formulae (MF19)."],
    1: ["Sketched graphs need labels and careful behaviour at asymptotes and limits."],
    3: ["Draw a diagram of forces or velocities; annotate the one given if there is one."],
    4: ["In hypothesis tests, state the decision on H₀ explicitly, then conclude in context without claiming proof."],
  },
  9093: {
    "*": ["Read widely across genres and know the linguistic features of texts (word classes, modality, structure, pragmatics)."],
    1: ["Use the instructions and context given to make deliberate choices in the directed response."],
    2: ["Keep to the word guidance (no more than 400 words for Question 1(a), at least 600 for Section B); no long preambles."],
    3: ["Synthesise the data with ideas from wider study; split your time equally between the two questions."],
    4: ["Write sustained, logically sequenced discursive essays supported by the stimulus material."],
  },
  8021: {
    1: ["Write in formal English with no contractions; keep the introduction short.", "Answer the question set, with examples, considering several perspectives and short- and long-term effects.", "End with an independent judgement that doesn't contradict the essay."],
    2: ["Signpost points with linking phrases and use measured language ('likely', 'may') when inferring."],
  },
  9626: {
    "*": ["Use precise technical terms; apply answers to the scenario rather than giving general points.", "Structured answers score better than lists of single points."],
    2: ["Know 3NF, naming conventions, validation rules vs input masks, and audio mixing without clipping."],
    3: ["Target each answer to the command word and to A Level depth."],
  },
  9239: {
    "*": ["Read the key words in each question ('identify', 'evidence', 'perspectives', 'judgement')."],
    1: ["Keep Question 1 brief so there's time for the higher-mark questions; explain how or why something is a strength or weakness."],
    2: ["Set up a clear debate between contrasting perspectives, compare their strengths and weaknesses, then judge."],
  },
  9479: {
    "*": ["Record from primary sources, including your own photography, rather than relying on downloaded images.", "Show a clear starting point and how your ideas progressed; select your most relevant work."],
  },
  9705: {
    "*": ["Analyse research and draw conclusions that shape the specification; copied website material earns little."],
    1: ["Health and safety points must relate to the process, not be generic.", "In analysis questions, give relevant examples to justify points."],
    3: ["Explain why a process suits a product: single words don't score. Annotate ideas to show design decisions."],
  },
  "0580": {
    "*": ["Show working: without it, a wrong answer earns no method marks.", "Use a suitable level of accuracy and check the answer makes sense in context."],
    1: ["Read the questions carefully, focusing on instructions and key words."],
    4: ["Don't cross out working that supports your answer."],
  },
  "0606": {
    "*": ["Show full, clear methods; give answers in the form and accuracy asked for.", "In 'show that' questions, every step must be shown: repeating the given answer earns nothing."],
    2: ["Where a calculator isn't allowed, write out each method step."],
  },
  "0625": {
    "*": ["Final answers need the correct value and unit to the right number of significant figures.", "Set working out logically with the formula; take g as 9.8 N/kg."],
    3: ["Don't round to 1 significant figure; write digits clearly (1 and 7, 4 and 9)."],
    5: ["Base practical explanations on practical, not theoretical, considerations."],
    6: ["Know how to improve reliability and control variables in an experiment."],
  },
  "0620": {
    "*": ["Learn the syllabus definitions of chemical terms.", "Give a name when asked for a name and a formula when asked for a formula."],
    4: ["Write formulae carefully: subscripts below the line, charges as superscripts.", "Know precipitation reactions: solubility rules, ionic equations with state symbols, and how to separate and purify the solid."],
    6: ["Record readings from one instrument to the same resolution; a negative test result is still a result."],
  },
  "0610": {
    "*": ["Use the specific information in the question in your answer; match the number of points to the marks."],
    3: ["Label lines must touch the structure labelled; give a definition when a definition is asked."],
    4: ["Read graph axes and annotations before answering; plan longer answers."],
    6: ["Conclusions should link the independent variable to the dependent variable; graph scales should fill at least half the grid."],
  },
  "0455": {
    1: ["Read each item carefully before choosing; be confident with numerical and diagrammatic data."],
    2: ["In Section A, use the source material in your answers: answers that ignore it score low."],
  },
  "0450": {
    1: ["Learn precise definitions; each point needs its own application and analysis.", "Evaluation means a justified decision that follows from your points."],
    2: ["Apply every answer to the case study business (its size, sector and type)."],
  },
  "0452": {
    2: ["Show calculations: a wrong figure with no working earns nothing.", "Apply knowledge to the scenario, not just the bookkeeping."],
  },
  "0478": {
    1: ["Use technical terminology and structure answers around the question's key terms and context."],
    2: ["Know the published pseudocode in the syllabus thoroughly."],
  },
  "0417": {
    1: ["Use generic names, not brand names, for hardware and software.", "Answer the question set with specific, detailed language."],
    2: ["Follow the style instructions exactly (serif vs sans-serif, bold/italic) and proofread for consistency."],
    3: ["Write HTML to the tags specified rather than relying on WYSIWYG; make sure screenshots and formulae are readable."],
  },
  "0495": {
    1: ["Use the details around a data source (who, when, how adapted) for extra credit.", "Write distinct, developed paragraphs: about three conceptual points in (c) and (d)."],
    2: ["Skip the introduction; part (e) needs points for and against with sociological evidence and a judgement."],
  },
  "0500": {
    1: ["Work through the texts in order, use your own words where asked, and quote precisely when analysing language.", "Avoid lifting, repetition and your own opinions in reading answers."],
    2: ["Choose form, style and register for the audience; vary sentences and use precise vocabulary."],
  },
  "0510": {
    "*": ["Be precise and brief: extra detail can make an answer wrong.", "Look for synonyms and paraphrases of the question's key words in the text."],
    1: ["Notes should be short, one per line, under the right heading; words from the text are fine."],
    2: ["Keep to the word limit for the summary; develop each bullet point in the writing tasks."],
    3: ["Listen for the specific detail asked for and ignore distractors; keep within word limits."],
    4: ["Predict the answers in gap-fill tasks, then check them at the end of each section."],
  },
  "0457": {
    1: ["Practise explaining the strengths and weaknesses of sources, and using evidence to support a claim."],
    3: ["Set an aim the team can actually meet; keep a reflective log and use project examples in the reflection."],
  },
  "0520": {
    2: ["Give only the information asked for; answers in the first person are unlikely to be right in some questions."],
    4: ["Answer every part in the tense indicated, use simple linking words for opinions, and plan a coherent piece."],
  },
  "0400": {
    "*": ["Record from direct observation and your own photography, not just the internet; label your own photos."],
  },
  "0445": {
    "*": ["Read each question for the number of points, ideas or materials asked for."],
    1: ["In part (d) evaluate your ideas rather than describe them; part (e) needs construction details and dimensions."],
    2: ["Design the project around a real user and client, and the environment the product will be used in.", "If you use CAM, show how you set up the machine and chose settings for the material."],
    3: ["Match tools and equipment to specific processes; use clear sketches with notes that add information."],
    4: ["Give units on calculations and show working; give only the number of answers asked for."],
    5: ["Practise drawing accurately with instruments."],
  },
};

/** The tips for a paper: its own, then the syllabus-wide ones. */
export function tipsFor(code, paperId) {
  const s = EXAMINER[code];
  if (!s) return [];
  return [...(s[paperId] || []), ...(s["*"] || [])];
}
