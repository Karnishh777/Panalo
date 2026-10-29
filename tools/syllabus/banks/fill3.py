# The last thin topics brought up to three questions (loaded by fill_qs.py). Original questions.
Q3 = {}
ART = [
    ("1", "Which is first-hand (primary) recording?", "Drawing a plant you are looking at", ["Copying a photo from the internet", "Tracing a magazine picture", "Printing an artist's work"], "Examiners (2023): many portfolios had little recording from primary sources, and second-hand sources were often not credited."),
    ("2", "Why try several media before choosing one?", "To find which best expresses your idea and develop it further", ["To fill more pages", "Because the syllabus bans one medium", "To copy an artist exactly"], "Examiners (2023): candidates often didn't use what they discovered to move the work forward."),
    ("3", "How should an artist you research be used?", "Analyse how their work is made and use what you learn in your own ideas", ["Write their biography", "Copy one painting as your final piece", "Paste in their photo"], "Examiners (2023): some gave a biography instead of researching the artwork."),
    ("3", "What makes annotation useful?", "It analyses decisions and explains how the work will develop", ["It describes what is on the page", "It lists materials only", "It repeats the title"], "Examiners (2023): annotations were mostly descriptive rather than analytical."),
    ("4", "What should a final piece show?", "A personal response that grows clearly out of the supporting studies", ["A new idea unrelated to the studies", "A copy of an artist's work", "Only technical skill"], "The journey from studies to outcome is assessed."),
    ("4", "How should a 3D piece be submitted in a portfolio?", "As photographs", ["Posted as the object", "As a written description only", "It cannot be submitted"], "Examiners (2023): photograph 3D objects and organic matter rather than sending them."),
]
Q3["alevel/art"] = ART[:4] + ART[4:] + [
    ("6", "In the written personal investigation, what makes the writing strong?", "Critical analysis of sources linked to your own practical work", ["A long biography", "Copied text with no references", "Only describing your feelings"], "Cite sources and connect them to your decisions."),
]
Q3["igcse/art"] = ART
Q3["alevel/bio"] = [
    ("10", "How is cholera transmitted?", "Through water or food contaminated with faeces containing Vibrio cholerae", ["By mosquito bites", "Through the air", "By sexual contact"], "Treatment of sewage and clean drinking water prevent it."),
]
Q3["alevel/chem"] = [
    ("9", "Why does atomic radius decrease across Period 3?", "Nuclear charge increases while shielding stays similar", ["Electrons are added to new shells", "Shielding increases sharply", "Neutrons repel electrons"], "Examiners (2023): say 'similar shielding', and link more protons to stronger attraction."),
    ("17", "What is the product when propanone is reduced with NaBH₄?", "Propan-2-ol", ["Propan-1-ol", "Propanal", "Propanoic acid"], "Ketones are reduced to secondary alcohols."),
    ("20", "Why are addition polymers like poly(ethene) hard to dispose of?", "They are non-biodegradable because of strong non-polar C–C and C–H bonds", ["They dissolve in water", "They decompose quickly", "They are ionic"], "Burning them can release toxic gases."),
]
Q3["alevel/dt"] = [
    ("1", "What is a design specification?", "A list of measurable requirements the product must meet", ["A sketch of the final idea", "The list of tools used", "A review of the product"], "Each point should be testable in evaluation."),
    ("3", "Which process makes many identical hollow plastic bottles?", "Blow moulding", ["Vacuum forming", "Sand casting", "Laser cutting"], "Injection moulding makes solid parts; vacuum forming makes thin shells."),
    ("4", "What does a life cycle assessment consider?", "The environmental impact from raw materials to disposal", ["Only the price", "Only how it looks", "Only the factory's profit"], "Includes manufacture, transport, use and end of life."),
    ("4", "Which design choice makes a product easier to recycle?", "Using a single material that is easy to separate", ["Gluing several plastics together", "Adding mixed coatings", "Using more fixings"], "Design for disassembly helps reuse and recycling."),
    ("5", "What does third-angle orthographic projection show?", "Front, plan and side views laid out with standard positions", ["One 3D view", "A perspective drawing", "Only the cross-section"], "The plan goes above the front view in third angle."),
    ("6", "In a control system, what is an input transducer?", "A sensor that turns a physical change into an electrical signal", ["A motor", "A buzzer", "A battery"], "For example a thermistor or light-dependent resistor."),
    ("7", "What should the evaluation of a design project do?", "Test the product against the specification and suggest justified improvements", ["Repeat the design brief", "Describe the making only", "Say it is perfect"], "Use evidence from tests and users."),
    ("7", "Why build and test models during development?", "To check function, size and appearance before the final product", ["To save writing", "Because the brief says so", "To decorate the folder"], "Record what each model taught you."),
    ("8", "What is meant by ergonomics?", "Designing products to fit the people who use them", ["Designing only for appearance", "Reducing material cost", "Making products heavier"], "Uses anthropometric data, such as hand sizes."),
    ("8", "What is planned obsolescence?", "Designing a product to have a limited useful life", ["Making a product last for ever", "Recycling a product", "Testing a prototype"], "It raises sustainability concerns."),
    ("9", "Why is a Gantt chart useful in a project?", "It plans tasks against time so progress can be checked", ["It shows the circuit", "It lists materials", "It replaces the specification"], "Update it as the project changes."),
    ("9", "What makes a client's feedback useful?", "It is recorded and used to change the design", ["It is ignored", "It praises the product only", "It is collected after the exam"], "Show how each change came from evidence."),
]
Q3["alevel/eng"] = [
    ("2", "In a directed response, what matters most?", "Writing for the given audience, purpose and form", ["Retelling the original text", "Using as many long words as possible", "Writing a story"], "Examiners (2023): some used a warning tone when the task asked for advice or persuasion."),
    ("2", "What should the comparison with the original text do?", "Analyse how language choices differ and why, with examples", ["Summarise both texts", "Describe your feelings", "Repeat your own text"], "Examiners (2023): weaker comparisons summarised content with few examples."),
    ("3", "A review task asks about a trip. What is a weakness?", "Writing a recount with no evaluation", ["Giving a judgement", "Mentioning specific activities", "Using a suitable register"], "Examiners (2023): many reviews read like holiday accounts."),
    ("3", "A story opening is set. What should you avoid?", "Writing a whole story", ["Creating atmosphere", "Introducing a character", "Hinting at conflict"], "Examiners (2023): some wrote a complete story instead of an opening."),
    ("4", "Which is a common sentence error to avoid in extended writing?", "Joining sentences with commas (comma splicing)", ["Using paragraphs", "Varying sentence length", "Using a full stop"], "Examiners (2023): comma splicing and fragments recurred."),
    ("5", "Which is a theory of language change?", "Aitchison's damp spoon (and crumbling castle)", ["Chomsky's LAD", "Halliday's functions", "Skinner's operant conditioning"], "Others: S-curve, wave model, random fluctuation."),
    ("6", "Which theorist argued children are born with a language acquisition device?", "Chomsky", ["Skinner", "Halliday", "Crystal"], "Use child-language data to support or challenge theories."),
    ("7", "What is Schneider's dynamic model about?", "Stages in how new varieties of English develop in former colonies", ["Child language", "Pronunciation of RP", "Gender and talk"], "Examiners (2023): RP was often wrongly described as the British standard."),
    ("7", "What does 'acrolect' mean?", "The most prestigious variety, closest to the standard", ["A dialect spoken by children", "A creole only", "Slang"], "Basilect is furthest from it; mesolect is between."),
    ("8", "In data analysis, what should be checked against the IPA reference table?", "The phonemic transcription before commenting on pronunciation", ["The spelling only", "The speaker's age", "The punctuation"], "Examiners (2023): candidates misread phonemic symbols instead of checking the table."),
    ("8", "What is meant by a sociolect?", "A variety of language used by a social group", ["A regional accent", "One person's speech", "A dead language"], "An idiolect is one person's language."),
]
Q3["alevel/fmath"] = [
    ("F2.1", "sinh x is defined as:", "(eˣ − e⁻ˣ)/2", ["(eˣ + e⁻ˣ)/2", "eˣ − e⁻ˣ", "1/cosh x"], "cosh x = (eˣ + e⁻ˣ)/2."),
    ("F2.5", "What are the nth roots of unity?", "e^(2πik/n) for k = 0, 1, …, n − 1", ["1 and −1 only", "n, 2n, 3n", "k/n for k = 1 to n"], "They are equally spaced on the unit circle and sum to 0."),
]
Q3["alevel/gpaper"] = [
    ("2", "An essay asks if a country should help poorer nations. What keeps it relevant?", "Discussing the country-level argument the question asks about", ["Writing about rich individuals giving to charity", "Telling a personal story", "Listing facts with no argument"], "Examiners (2023): some focused on rich individuals instead of the country context."),
    ("2", "How should you choose an essay question?", "By how well you can answer that question, not just how much you know about the topic", ["Pick the topic you know most facts about", "Pick the shortest question", "Pick randomly"], "Examiners (2023): many chose familiar topics they couldn't answer well."),
    ("3", "Which shows a balanced argument?", "Weighing evidence on both sides and reaching a reasoned judgement", ["Only giving one side", "Listing facts", "Using emotional language only"], "Measured, supported points do better than sweeping claims."),
    ("3", "Why avoid sweeping generalisations like 'everyone has a mobile'?", "They are inaccurate and weaken the argument", ["They are too short", "They are informal", "They are always true"], "Examiners (2023): unsupported generalisations were common."),
    ("4", "Which is more suitable in a formal essay?", "Do not", ["Don't", "Wanna", "Kids"], "Examiners (2023): avoid contractions and informal words."),
    ("4", "What is the best way to use advanced vocabulary?", "Only where it is precise and correctly used", ["As often as possible", "Never", "In every sentence"], "Examiners (2023): complex words were sometimes used wrongly."),
    ("5", "When asked to answer in your own words, you should:", "Rephrase without reusing the key words of the text", ["Copy the sentence", "Quote the whole paragraph", "Add your opinion"], "Examiners (2023): reusing the original words lost credit."),
    ("5", "A question asks about disadvantages for one person. What loses marks?", "Writing about advantages or about other people", ["Using evidence from the text", "Being concise", "Explaining each point"], "Answer exactly the angle the question sets."),
    ("6", "What turns a point into a developed point?", "Explaining its likely impact or consequence", ["Repeating the evidence", "Adding a quotation only", "Making it longer"], "Examiners (2023): some developments just restated the evidence."),
    ("7", "In a summary, what should you avoid?", "Copying long phrases and adding your own opinions", ["Using your own words", "Keeping to the word limit", "Including key points"], "Precision matters: choose words that keep the original meaning."),
    ("7", "Why must synonyms be chosen carefully?", "A near-synonym can change the meaning", ["They must always be longer", "They are not allowed", "They earn no marks"], "Examiners (2023): 'easily' was a poor substitute for 'contactlessly'."),
]
Q3["alevel/gpr"] = [
    ("1", "What does evaluating evidence involve?", "Judging its reliability, relevance and sufficiency", ["Counting the sources", "Agreeing with it", "Rewriting it"], "Examiners (2023): explain why something is a strength or weakness, don't just state it."),
    ("2", "How should two perspectives be compared?", "Directly, on the same criteria, with a judgement", ["One after the other with no link", "Only describing them", "Choosing the longer one"], "Examiners (2023): answers without comparison were limited to half marks."),
    ("2", "Why develop one line of evaluation fully?", "Depth on one criterion earns more than several undeveloped ones", ["It is shorter", "It avoids judgement", "It hides weaknesses"], "Examiners (2023): this advice recurs for this skills-based syllabus."),
    ("3", "Which source is usually most credible for a scientific claim?", "A peer-reviewed study", ["An anonymous social media post", "An advert", "A personal blog"], "Check the author, expertise, purpose and date."),
    ("3", "Why suggest further research in an essay?", "To show awareness of the limits of the evidence used", ["To make it longer", "To avoid a conclusion", "It is never credited"], "Examiners (2023): more candidates now consider further research."),
    ("4", "How should an essay be written for Questions 2 and 3?", "In full paragraphs, not bullet points", ["As bullet points", "As a table", "As a single sentence"], "Concise answers are fine only in Question 1."),
    ("4", "What makes a strong conclusion?", "A judgement that follows from the evaluation", ["A new argument", "A summary with no judgement", "A quotation"], "Examiners (2023): judgements were often asserted rather than based on evidence."),
    ("5", "What should the reflection in a team project focus on?", "What was learned, how your view changed and how you'll act differently", ["A list of meetings", "Blaming team members", "Only what went well"], "Examiners (2023): reflections were often descriptive rather than evaluative."),
    ("5", "In a presentation, what makes slides support the argument?", "Data and evidence rather than only pictures", ["Decorative images only", "Long paragraphs of text", "No slides at all"], "Examiners (2023): many slides had pictures that offered no support."),
    ("6", "A research report should be:", "An argument that answers a question, not a narrative of facts", ["A list of everything known", "A story", "A summary of one source"], "Examiners (2023): reports often lacked argument."),
    ("6", "Why choose an unusual question for the research report?", "It allows a fresh argument and avoids over-familiar ground", ["Familiar topics score zero", "It is shorter", "It needs no sources"], "Examiners (2023): many chose very familiar topics."),
]
Q3["alevel/it"] = [
    ("16", "Which changeover method runs the old and new systems together?", "Parallel running", ["Direct changeover", "Phased implementation", "Pilot running"], "It is safe but costly in time and staff."),
]
Q3["alevel/psy"] = [
    ("3", "What does the working memory model propose?", "Short-term memory has several parts, such as the phonological loop and visuo-spatial sketchpad", ["Memory is one single store", "Memory only stores pictures", "Long-term memory has no limit and no parts"], "The central executive controls attention."),
]
Q3["igcse/dt"] = [
    ("1", "Why is a design brief written?", "To state the problem, the user and the context clearly", ["To list tools", "To evaluate the product", "To show the final drawing"], "The specification then turns it into measurable points."),
    ("3", "Which process is used to shape thin thermoplastic sheet over a mould?", "Vacuum forming", ["Sand casting", "Turning on a lathe", "Forging"], "Heat the sheet, then the vacuum pulls it over the mould."),
    ("4", "Which material is most sustainable for a disposable product?", "A biodegradable or recyclable material", ["Mixed plastics glued together", "Chrome-plated steel", "Non-recyclable composite"], "Consider the whole life cycle."),
    ("5", "What is an exploded drawing used for?", "To show how parts fit together", ["To show the price", "To show the colour scheme only", "To replace the specification"], "Parts are drawn apart along assembly lines."),
    ("6", "In a circuit, what does an LDR do?", "Its resistance changes with light level", ["It produces light", "It stores charge", "It switches at a set temperature"], "Used as a light sensor in a potential divider."),
    ("7", "In coursework, what does good development show?", "Ideas improved through models, tests and feedback", ["One idea drawn neatly", "Photos with no notes", "Copied products"], "Explain each decision."),
    ("7", "What should testing the final product check?", "Each point of the specification", ["Only its appearance", "How long it took", "The cost of tools"], "Use users and measurements as evidence."),
]
Q3["igcse/eng1"] = [
    ("1", "What does an 'implicit' meaning question ask for?", "What is suggested but not stated directly", ["A word copied from the text", "A summary", "Your opinion of the writer"], "Support inferences with evidence from the text."),
    ("2", "In a summary, which approach works best?", "Select the relevant points and write them concisely in your own words", ["Copy whole sentences", "Add examples of your own", "Comment on the language"], "Keep to the length set."),
    ("4", "In the extended response to reading, what matters?", "Using and developing ideas from the text in the form asked", ["Ignoring the text", "Copying long extracts", "Writing a story"], "Write in the voice and form the task gives."),
    ("5", "In directed writing, what gains marks for reading?", "Evaluating and developing the ideas from the texts", ["Listing the ideas", "Writing your own unrelated views", "Quoting at length"], "Writing marks reward audience, structure and accuracy."),
    ("6", "What makes descriptive writing effective?", "Precise detail and imagery that build an atmosphere", ["A fast-moving plot", "Lots of dialogue", "A list of events"], "Description focuses on senses and impressions, not events."),
    ("7", "What helps a narrative most?", "A clear structure with a developed ending", ["Many characters", "Long descriptions with no events", "An unfinished ending"], "Control pace and choose a focused plot."),
    ("8", "Which is correct?", "It's raining, so the dog stays in its kennel.", ["Its raining, so the dog stays in it's kennel.", "It's raining, so the dog stays in it's kennel.", "Its raining, so the dog stays in its kennel."], "It's = it is; its shows possession."),
    ("8", "Which sentence is correctly punctuated?", "I was tired; I went to bed.", ["I was tired, I went to bed.", "I was tired I went to bed.", "I was tired: and I went to bed."], "A comma cannot join two complete sentences (comma splice)."),
]
Q3["igcse/eng2"] = [
    ("1", "A question asks for one detail. What is best?", "A short, precise answer taken from the text", ["Copying the whole paragraph", "Giving three details", "Guessing from general knowledge"], "Read the question carefully: extra wrong details can cancel a right one."),
    ("2", "In note-making, what should notes be?", "Brief points under the headings given", ["Full sentences copied from the text", "Your own opinions", "Repeated points"], "Each note should be a separate, relevant point."),
    ("2", "What is lost if two notes say the same thing?", "The second note earns no extra mark", ["Nothing", "Both marks are lost", "The whole question"], "Make every note a different point."),
    ("3", "What should a summary include?", "The relevant points, in your own words and in the word limit", ["Your opinion", "Quotations from the text", "Every detail"], "Organise points logically."),
    ("3", "Why keep to the word limit?", "Long summaries are penalised and lose focus", ["It doesn't matter", "Shorter always means more marks", "Examiners count every letter"], "Plan the points first."),
    ("4", "Which tone suits an email to a friend?", "Friendly and informal", ["Formal and impersonal", "Rude", "Like a report"], "Match register to the reader."),
    ("4", "What must an informal email cover?", "All three bullet points in the task", ["Only the first bullet point", "Anything you like", "A list of facts"], "Develop each point."),
    ("5", "Which is suitable for a report to a head teacher?", "Formal language with clear headings or paragraphs", ["Slang and abbreviations", "A story", "A text message style"], "Give recommendations where asked."),
    ("6", "In the listening exam, what should you do before the recording starts?", "Read the questions and note what information is needed", ["Write a summary", "Close your eyes", "Answer from memory"], "Spelling of key words still matters."),
    ("7", "In the speaking test, what helps most?", "Extending answers with reasons and examples", ["Giving one-word answers", "Reciting a memorised speech", "Speaking very fast"], "Respond naturally to the examiner's prompts."),
    ("7", "If you don't understand a question in the speaking test, you should:", "Ask politely for it to be repeated", ["Stay silent", "Change the topic", "Answer a different question"], "Asking for clarification is natural communication."),
]
Q3["igcse/french"] = [
    ("1", "Complete: « Le matin, je ___ le bus pour aller au collège. »", "prends", ["prend", "prendre", "pris"], "Prendre: je prends, tu prends, il prend."),
    ("2", "Which means 'I get on well with my sister'?", "Je m'entends bien avec ma sœur.", ["Je m'appelle ma sœur.", "J'entends ma sœur.", "Je suis bien ma sœur."], "S'entendre avec quelqu'un = to get on with someone."),
    ("2", "Choose the correct past tense: « Hier, nous ___ au cinéma. »", "sommes allés", ["avons allé", "allons", "irons"], "Aller takes être in the passé composé, and the participle agrees."),
    ("3", "« Il faut protéger l'environnement. » What does il faut mean?", "It is necessary / we must", ["It is raining", "He is going", "There is"], "Il faut + infinitive."),
    ("4", "Which means 'I would like to work abroad'?", "J'aimerais travailler à l'étranger.", ["J'aime travaillé étranger.", "Je travaille à l'étranger hier.", "J'aimerai travailler en l'étranger."], "Conditional j'aimerais + infinitive."),
    ("4", "« un stage » means:", "a work placement / internship", ["a stage in a theatre", "a salary", "a manager"], "Faire un stage = do work experience."),
    ("5", "Complete: « L'année prochaine, je ___ en Espagne. »", "voyagerai", ["voyageais", "ai voyagé", "voyage hier"], "Future tense: infinitive + -ai."),
    ("5", "« les pays francophones » are:", "countries where French is spoken", ["countries near France", "foreign countries", "European countries only"], "For example Sénégal, le Québec (Canada), la Belgique."),
]
Q3["igcse/gp"] = [
    ("1", "Which is the best first step in research?", "Write a clear question to investigate", ["Make a poster", "Choose a conclusion", "Collect any images"], "A focused question guides your sources."),
    ("2", "What is a consequence?", "A result or effect of an issue", ["A cause", "A source", "A solution"], "Explain links between causes, consequences and possible courses of action."),
    ("2", "Why consider different perspectives (personal, local/national, global)?", "Issues affect people at different scales in different ways", ["To make the answer longer", "Only global views count", "Perspectives don't matter"], "Compare them to reach a judgement."),
    ("3", "How do you judge a source's reliability?", "Check the author's expertise, purpose, evidence and date", ["Count its pages", "See if you agree", "Check its colour"], "Bias and vested interest weaken reliability."),
    ("3", "What is a vested interest?", "A personal stake that may bias a source", ["A detailed source", "A recent source", "A primary source"], "For example a company writing about its own product."),
    ("4", "What should a personal reflection show?", "How your thinking changed and what you learned", ["A list of tasks", "Only your opinion at the start", "Praise for the team"], "Be specific about evidence that changed your mind."),
    ("4", "Which is reflective writing?", "'I first thought…, but the evidence on… made me reconsider because…'", ["'We met on Monday.'", "'The topic is pollution.'", "'Our poster was blue.'"], "Reflection explains, not just describes."),
    ("5", "Why set roles in a team project?", "So tasks are shared fairly and work is coordinated", ["So one person does everything", "To avoid discussion", "It isn't needed"], "Evaluate how well the team worked."),
    ("5", "What is a good way to resolve disagreement in a team?", "Discuss the evidence and agree a way forward", ["Ignore it", "Let one person decide always", "Leave the team"], "Explain this in your reflection."),
    ("6", "What makes communication of an argument clear?", "A logical structure with evidence for each point", ["Lots of decoration", "Many unrelated facts", "No conclusion"], "Know your audience."),
    ("6", "Why reference sources?", "To show where evidence came from and let others check it", ["To make the work longer", "Because it looks nice", "It isn't needed"], "Include author, title, date and link."),
]
Q3["igcse/hindi"] = [
    ("1", "'परिश्रम' शब्द का अर्थ क्या है?", "मेहनत", ["आराम", "खेल", "डर"], "परिश्रम = कड़ी मेहनत।"),
    ("2", "औपचारिक पत्र का समापन कैसे करते हैं?", "भवदीय", ["तुम्हारा दोस्त", "बाय", "प्यार सहित"], "औपचारिक पत्र में शिष्ट भाषा का प्रयोग करें।"),
    ("4", "'प्रदूषण' किस विषय से जुड़ा है?", "पर्यावरण", ["खेल", "भोजन", "संगीत"], "पर्यावरण से जुड़े शब्द: वायु, जल, कचरा, पेड़।"),
    ("5", "सुनने की परीक्षा से पहले क्या करना चाहिए?", "प्रश्न ध्यान से पढ़ना", ["सो जाना", "उत्तर याद करना", "कुछ नहीं"], "मुख्य शब्दों पर ध्यान दें।"),
    ("5", "सुनते समय उत्तर कैसे लिखें?", "छोटे, स्पष्ट शब्दों में", ["पूरा पैराग्राफ लिखकर", "अंग्रेज़ी में", "बिना सुने"], "जो पूछा गया है वही लिखें।"),
    ("6", "बोलने की परीक्षा में अच्छा उत्तर कैसा होता है?", "कारण और उदाहरण के साथ विस्तृत", ["एक शब्द में", "बहुत तेज़ी से", "रटा हुआ भाषण"], "स्वाभाविक रूप से बातचीत करें।"),
    ("6", "अगर प्रश्न समझ न आए तो क्या कहें?", "क्या आप प्रश्न दोहरा सकते हैं?", ["चुप रहें", "विषय बदल दें", "कुछ भी बोल दें"], "विनम्रता से प्रश्न दोहराने को कहना ठीक है।"),
]
Q3["igcse/ict"] = [
    ("5", "Which is an effect of microprocessor-controlled devices in the home?", "More leisure time because chores are automated", ["Less electricity is always used", "No need for any skills", "Devices can never fail"], "Consider both positive and negative effects."),
    ("6", "Which is a use of a computer in a school?", "Recording attendance with a management system", ["Growing crops", "Driving buses", "Cooking meals"], "Others: timetables, learning platforms, reports."),
    ("9", "Why find out the audience's needs before designing?", "So the content, language and design suit them", ["To make the file smaller", "To save paper", "It isn't needed"], "Consider age, experience and accessibility."),
    ("12", "What does cropping an image do?", "Removes unwanted outer parts of it", ["Changes its colours", "Makes it larger without loss", "Rotates it"], "Resizing changes its dimensions."),
    ("13", "What are margins in a document?", "The blank space between the text and the edge of the page", ["Lines between columns", "The header text", "Page numbers"], "Gutter margins allow for binding."),
    ("14", "Why use styles in a long document?", "To apply consistent formatting quickly and build a contents page", ["To check spelling", "To insert images", "To print faster"], "Change a style once and every heading updates."),
    ("16", "What should every chart include?", "A title and labelled axes or a legend", ["Only colours", "No labels", "3D effects"], "Choose the chart type that fits the data."),
    ("16", "Which chart shows change over time?", "Line graph", ["Pie chart", "Venn diagram", "Table"], "Pie charts show parts of a whole."),
    ("17", "What is a header?", "Text that appears at the top of every page", ["The first paragraph", "A title in bold", "A footnote"], "Footers appear at the bottom; both often hold page numbers."),
    ("19", "What is a master slide used for?", "Setting the same layout and style on every slide", ["Adding sound", "Printing notes", "Timing slides"], "It keeps a presentation consistent."),
]
Q3["igcse/soc"] = [
    ("2", "What are norms?", "Unwritten rules of expected behaviour", ["Laws passed by government", "Beliefs about God", "Personal choices"], "Values are beliefs about what is important."),
    ("3", "What is social mobility?", "Movement of people between social classes", ["Moving house", "Travelling abroad", "Changing jobs at the same level"], "It can be upward or downward, within or between generations."),
    ("4", "What is a nuclear family?", "Two parents and their dependent children", ["Grandparents, parents and children", "One parent and children", "A couple with no children"], "The extended family includes other relatives."),
    ("4", "Which is evidence of family diversity?", "Growth of single-parent and same-sex families", ["Every family being nuclear", "Falling divorce", "More arranged marriages only"], "Explain why the change has happened."),
    ("5", "What is the hidden curriculum?", "Values and attitudes taught informally through school life", ["The exam syllabus", "Secret lessons", "Homework"], "For example punctuality and obedience."),
    ("6", "What is deviance?", "Behaviour that goes against a society's norms", ["Any crime", "Normal behaviour", "Legal behaviour only"], "Not all deviance is criminal."),
    ("6", "What is the dark figure of crime?", "Crime that is not reported or recorded", ["Crime at night", "Violent crime", "Crime solved by police"], "So official statistics are incomplete."),
    ("7", "What is a moral panic?", "Exaggerated media reaction to a group seen as a threat", ["A real crime wave", "A news report", "A protest"], "Cohen's folk devils."),
]
Q3["alevel/art"].append(("6", "How should sources be acknowledged in the written investigation?", "Every image and quotation is credited in a bibliography or caption", ["Only the main artist", "Not at all", "Only if copied exactly"], "Examiners (2023): the origins of visual work were often unclear because sources weren't cited."))
Q3["alevel/eng"].append(("4", "Which helps an extended piece of writing most?", "A clear structure planned around the purpose and audience", ["Writing without a plan", "Many unrelated ideas", "One very long paragraph"], "Examiners (2023): stronger responses were structured deliberately, not just chronologically."))
Q3["igcse/soc"] += [
    ("5", "How might material deprivation affect educational achievement?", "Lack of resources such as books, space or food can lower attainment", ["It always raises attainment", "It has no effect", "It only affects teachers"], "Cultural factors and labelling in school also matter."),
    ("7", "What is agenda-setting by the media?", "Choosing which issues the public thinks about", ["Printing the news", "Selling advertising", "Writing laws"], "Gatekeepers decide what is reported."),
]
Q3["igcse/eng1"] += [
    ("4", "What tone should an extended response written as a character have?", "One that fits the character and situation in the text", ["Your own normal voice", "A formal report", "Slang throughout"], "Use details from the text to make the voice convincing."),
    ("6", "Which sentence is the strongest description?", "Frost silvered the empty benches, and our breath hung in the still air.", ["It was cold and nobody was there.", "The park was very, very cold.", "I went to the park and then went home."], "Precise verbs and sensory detail create atmosphere."),
    ("7", "Why plan a narrative before writing?", "So the plot is controlled and the ending is reached", ["To use more time", "Plans earn marks on their own", "To make it longer"], "A short, well-shaped story beats a long, unfinished one."),
]
Q3["igcse/dt"].append(("4", "What is the main purpose of product analysis?", "To find out how and why an existing product was designed and made", ["To copy it exactly", "To sell it", "To repair it"], "Consider function, materials, manufacture, user and sustainability."))
Q3["igcse/eng2"].append(("6", "Answers in the listening exam should be:", "Brief, as instructed, with key words spelled recognisably", ["Long full sentences", "In a different language", "Copied from the question"], "Listen for the specific detail asked for."))
