# English First Language 0500, English as a Second Language 0510,
# English General Paper 8021, English Language 9093, Sociology 0495,
# Global Perspectives 0457 and Global Perspectives & Research 9239.

BANKS = {}

BANKS["igcse/eng1"] = dict(
    subject="eng1", name="English First Language", board="Cambridge IGCSE", code="0500",
    topics=[
        ("1", "Reading: explicit and implicit meaning", None, [
            ("An implicit meaning is one that is", ["suggested rather than stated", "stated directly", "in the title", "a spelling error"], 0, "You infer it from clues in the text."),
            ("When asked to answer 'using your own words', you should", ["rephrase the idea without copying key words", "quote the whole sentence", "write a summary of the passage", "give your opinion"], 0, "Lifting the text's words shows no understanding."),
        ]),
        ("2", "Summary writing", None, [
            ("A good summary", ["selects the relevant points and writes them concisely in your own words", "copies sentences in order", "adds your opinion", "includes every example"], 0, "Selection and concision are what's rewarded."),
            ("Before writing a summary, you should first", ["identify the points that answer the question", "write the conclusion", "count words in the passage", "find quotations"], 0, "Plan the content, then write it fluently."),
        ]),
        ("3", "Writer's effects: language analysis", None, [
            ("'The wind howled like a wounded animal' is an example of", ["a simile", "a metaphor", "alliteration", "onomatopoeia only"], 0, "It compares using 'like'."),
            ("In a language question you earn most credit for", ["explaining the effect of specific word choices", "naming as many techniques as possible", "retelling the plot", "quoting long passages"], 0, "Analysis of effect beats technique-spotting."),
            ("Connotation means", ["the associations a word carries", "the dictionary definition", "a word's spelling", "the word's origin"], 0, "e.g. 'lair' suggests danger in a way 'home' does not."),
        ]),
        ("4", "Extended response to reading", None, [
            ("In an extended response (e.g. a letter or speech based on a text), you should", ["use and develop ideas from the text in the required form", "copy the text's structure", "ignore the text", "write a story"], 0, "Reading marks come from using the text's ideas, writing marks from form and audience."),
        ]),
        ("5", "Directed writing", None, [
            ("Directed writing tests your ability to", ["evaluate ideas from texts and write for a purpose and audience", "write a story", "describe a picture", "correct grammar"], 0, "You must select, evaluate and argue from the source material."),
            ("A discursive piece should", ["consider different viewpoints before reaching a view", "argue only one side", "be informal", "avoid paragraphs"], 0, "Balance is the key feature."),
        ]),
        ("6", "Descriptive writing", None, [
            ("The best descriptive writing usually", ["focuses on sensory detail and atmosphere rather than plot", "tells a long story", "uses lists of adjectives", "is written in the second person"], 0, "Description creates a scene, not a sequence of events."),
        ]),
        ("7", "Narrative writing", None, [
            ("A strong narrative usually has", ["a clear structure with a developed climax and resolution", "as many characters as possible", "no dialogue", "a dream ending"], 0, "Control of structure is what's rewarded."),
        ]),
        ("8", "Spelling, punctuation and grammar", None, [
            ("Which sentence is punctuated correctly?", ["It's raining, so we stayed in.", "Its raining so, we stayed in.", "It's raining so we stayed, in.", "Its' raining, so we stayed in."], 0, "It's = it is; the comma comes before 'so'."),
            ("A comma splice is", ["two main clauses joined only by a comma", "a list with commas", "a comma before 'and'", "a missing apostrophe"], 0, "Use a full stop, semicolon or conjunction instead."),
        ]),
    ],
    papers={
        "1": ("Reading", "written", 120, 80, "any", ["1", "2", "3", "4"]),
        "2": ("Directed Writing and Composition", "written", 120, 80, "any", ["5", "6", "7", "8"]),
    },
    routes={"igcse": ["1", "2"]},
    note="Some schools take Component 3 (coursework) instead of Paper 2.",
    long=[
        ("3", "1", "Re-read a paragraph of description from a passage you are studying. Choose three words or phrases and explain how each creates an effect. (Practise on any unseen passage; mark yourself with this scheme.)", ["B1: three well-chosen, precise words or phrases (not whole sentences)", "B1: the meaning of each explained in context", "B1: the effect on the reader explained (what it makes you feel or picture)", "B1: links between choices, e.g. a pattern of violent or calm imagery"], None),
        ("2", "1", "Summarise, in no more than 120 words, the reasons a writer gives for a change they describe (use a passage of your choice). Use this scheme to mark yourself.", ["B1: 8 or more relevant points selected", "B1: points written in your own words", "B1: concise: no examples, repetition or opinion", "B1: organised and fluent, within the word limit"], None),
        ("5", "2", "Write a speech to your school's parents arguing whether homework should be banned for students under 16. Mark yourself with this scheme.", ["B1: a clear view, developed and sustained", "B1: counter-arguments considered and answered", "B1: register suited to the audience (parents) and the form (a speech)", "B1: well-structured paragraphs with linking", "B1: accurate spelling, punctuation and grammar"], None),
        ("6", "2", "Describe a market at the moment it opens in the morning. Mark yourself with this scheme.", ["B1: a vivid, sustained atmosphere rather than a story", "B1: precise sensory detail (sounds, smells, light)", "B1: varied sentence structures for effect", "B1: ambitious, well-chosen vocabulary", "B1: accurate spelling, punctuation and grammar"], None),
    ],
)

BANKS["igcse/eng2"] = dict(
    subject="eng2", name="English as a Second Language", board="Cambridge IGCSE", code="0510",
    topics=[
        ("1", "Reading for detail", None, [
            ("When a question asks for 'two' details, you should", ["give exactly two separate points", "give as many as possible", "copy a whole paragraph", "give one point twice"], 0, "Extra points can be ignored or count against you."),
            ("Skimming a text means", ["reading quickly for the general idea", "reading every word carefully", "looking for one fact", "reading the last line only"], 0, "Scanning is looking for specific information."),
        ]),
        ("2", "Note-making", None, [
            ("Good notes are", ["brief points under the given headings", "full sentences copied from the text", "your opinions", "a summary paragraph"], 0, "Notes should be short and relevant to each heading."),
        ]),
        ("3", "Summary writing", None, [
            ("A summary should be written", ["in your own words, as one paragraph within the word limit", "as bullet points", "as a list of quotations", "with an introduction and conclusion"], 0, "Continuous, concise prose is expected."),
        ]),
        ("4", "Informal writing (emails and letters)", None, [
            ("Which is the most suitable opening for an email to a friend?", ["Hi Sam, how are you?", "Dear Sir or Madam,", "To whom it may concern,", "Respected friend,"], 0, "Informal register for a friend."),
        ]),
        ("5", "Formal writing (reports, reviews, articles)", None, [
            ("A report usually has", ["a title and clear sections or paragraphs with a recommendation", "a greeting and signature", "dialogue", "rhyme"], 0, "Reports are organised for a reader to act on."),
            ("Which phrase fits a formal register?", ["In my view, this proposal would benefit students.", "This idea is totally awesome!", "Gonna be great!", "Loads of kids like it."], 0, "Formal writing avoids slang and contractions."),
        ]),
        ("6", "Listening", None, [
            ("In a gap-fill listening task, your answer should usually be", ["one or two words heard in the recording", "a full sentence", "a synonym of your choice", "a number only"], 0, "Write the words you hear, spelled correctly."),
        ]),
        ("7", "Speaking", None, [
            ("In the speaking test it helps to", ["develop answers with reasons and examples", "give one-word answers", "memorise a speech", "speak as fast as possible"], 0, "Extended, relevant answers score best."),
        ]),
        ("8", "Grammar and vocabulary", None, [
            ("Choose the correct sentence.", ["She has lived here since 2019.", "She lives here since 2019.", "She is living here since 2019.", "She lived here since 2019."], 0, "'Since' with an ongoing situation takes the present perfect."),
            ("'Despite ___ tired, he finished the race.'", ["being", "he was", "to be", "of being"], 0, "'Despite' is followed by a noun or -ing form."),
            ("A synonym for 'reluctant' is", ["unwilling", "eager", "careful", "angry"], 0, "Reluctant means not wanting to do something."),
        ]),
    ],
    papers={
        "1": ("Reading and Writing (Core)", "written", 90, None, "core", ["1", "2", "3", "4", "5", "8"]),
        "2": ("Reading and Writing (Extended)", "written", 120, None, "extended", ["1", "2", "3", "4", "5", "8"]),
        "3": ("Listening (Core)", "written", 40, None, "core", ["6", "8"]),
        "4": ("Listening (Extended)", "written", 50, None, "extended", ["6", "8"]),
        "5": ("Speaking", "practical", 15, None, "any", ["7", "8"]),
    },
    routes={"igcse": ["2", "4", "5"]},
    note="Core or Extended: choose your tier's papers; Speaking may be endorsed separately.",
    long=[
        ("4", "2", "Write an email (120–160 words) to a friend about a school event you helped to organise: what it was, what you did, and what you would do differently. Mark yourself with this scheme.", ["B1: all three points covered and developed", "B1: friendly, informal register throughout", "B1: well organised, with an opening and closing", "B1: a range of accurate grammar and vocabulary"], None),
        ("5", "2", "Your school wants to reduce plastic waste. Write a report for your headteacher (150–200 words) suggesting two ideas and recommending one. Mark yourself with this scheme.", ["B1: a clear title and purpose", "B1: two ideas, each explained with a benefit", "B1: a reasoned recommendation", "B1: formal register, no slang", "B1: accurate, varied language"], None),
    ],
)

BANKS["alevel/gpaper"] = dict(
    subject="gpaper", name="English General Paper", board="Cambridge International AS Level", code="8021",
    topics=[
        ("1", "Essay: argument and structure", "as", [
            ("A strong discursive essay", ["answers the exact question with a clear, sustained line of argument", "lists everything known about the topic", "is mostly description", "avoids taking a view"], 0, "Relevance and a sustained argument earn the top marks."),
            ("Counter-arguments should be", ["raised and then evaluated or rebutted", "ignored", "placed only in the conclusion", "given as much support as your own view without judgement"], 0, "Evaluation shows balance and judgement."),
            ("A good conclusion", ["reaches a justified judgement on the question", "introduces a new argument", "repeats the introduction word for word", "apologises for the length"], 0, "It should follow from the argument."),
        ]),
        ("2", "Economic, historical, moral, political and social topics", "as", [
            ("Which is the best evidence to support a claim in a GP essay?", ["a specific, relevant example with context", "'everyone knows that…'", "a personal feeling", "a dictionary definition"], 0, "Precise examples make arguments convincing."),
        ]),
        ("3", "Science, the environment and technology", "as", [
            ("An essay on whether technology isolates people should", ["weigh different kinds of technology and contexts", "describe how phones work", "argue only that it does", "list apps"], 0, "Qualified, nuanced judgements score well."),
        ]),
        ("4", "Literature, language, the arts and media", "as", [
            ("'To what extent' questions require", ["a judgement on how far you agree", "a yes or no", "a narrative", "a definition only"], 0, "They ask for degree, not just a side."),
        ]),
        ("5", "Comprehension: reading for meaning", "as", [
            ("'Explain in your own words' means", ["paraphrase the meaning without lifting key words", "quote the passage", "give your opinion", "summarise the whole passage"], 0, "Lifting shows no understanding."),
        ]),
        ("6", "Comprehension: evaluating arguments and data", "as", [
            ("When evaluating a source's reliability, consider", ["its author, purpose, evidence and date", "its length", "its font", "how many people read it"], 0, "These affect how far it can be trusted."),
            ("A correlation in data shows", ["that two things vary together, not necessarily cause and effect", "proof that one causes the other", "an error in the data", "the average"], 0, "Correlation is not causation."),
        ]),
        ("7", "Language use: summary and accuracy", "as", [
            ("Which is grammatically correct?", ["Neither the teacher nor the students were late.", "Neither the teacher or the students was late.", "Neither the teacher nor the students was late, and.", "Neither of the teacher nor students were late."], 0, "Neither…nor; the verb agrees with the nearer subject (students → were)."),
        ]),
    ],
    papers={
        "1": ("Essay", "written", 75, 30, "as", ["1", "2", "3", "4", "7"]),
        "2": ("Comprehension", "written", 105, 50, "as", ["5", "6", "7"]),
    },
    routes={"as": ["1", "2"], "a2": ["1", "2"]},
    long=[
        ("1", "1", "'Social media does more harm than good to young people.' How far do you agree? (Plan and write in 75 minutes; mark yourself with this scheme.)", ["B1: a clear position that answers 'how far', stated early", "B1: at least three developed arguments, each with specific evidence", "B1: counter-arguments raised and evaluated", "B1: a logical structure with linked paragraphs", "B1: a reasoned conclusion that follows from the argument", "B1: accurate, fluent and varied language"], None),
        ("3", "1", "Evaluate the claim that governments, not individuals, should take the lead in tackling climate change. (Mark yourself with this scheme.)", ["B1: defines the scope (which governments, which individuals)", "B1: argues the case for government action with examples", "B1: argues the case for individual action with examples", "B1: weighs the two and reaches a judgement", "B1: clear structure and accurate expression"], None),
        ("6", "2", "A passage claims a new school timetable 'improved results' because exam averages rose the following year. Identify two weaknesses in this reasoning.", ["B1: correlation is not causation: other factors may have changed", "B1: one year's data is too little to show a trend", "B1: a different cohort sat the exams, so results aren't directly comparable", "B1: no information on how big the rise was or whether it is significant"], None),
    ],
)

BANKS["alevel/eng"] = dict(
    subject="eng", name="English Language", board="Cambridge International AS & A Level", code="9093",
    topics=[
        ("1", "Reading: analysing texts", "as", [
            ("In text analysis, 'register' refers to", ["the level of formality and the language suited to a context", "the length of the text", "the number of paragraphs", "spelling"], 0, "Field, tenor and mode shape register."),
            ("Lexis means", ["the vocabulary of a text", "its sentence structure", "its sound patterns", "its layout"], 0, "Lexis = word choice."),
            ("A declarative sentence", ["makes a statement", "asks a question", "gives an order", "expresses strong feeling"], 0, "The four sentence functions: declarative, interrogative, imperative, exclamative."),
        ]),
        ("2", "Directed response", "as", [
            ("A directed response asks you to", ["write a new text for a given audience and purpose, using a source", "analyse a poem", "summarise a novel", "write a story of your choice"], 0, "You transform the source for a new context."),
        ]),
        ("3", "Shorter writing and reflective commentary", "as", [
            ("A reflective commentary should explain", ["the language choices you made and why", "the plot of your piece", "what you would write next", "grammar rules"], 0, "It links your choices to audience and purpose."),
        ]),
        ("4", "Extended writing", "as", [
            ("Writing for a specified audience means", ["adapting vocabulary, tone and structure to that audience", "using as many long words as possible", "ignoring the audience", "writing in note form"], 0, "Audience shapes every choice."),
        ]),
        ("5", "Language change", "a2", [
            ("Borrowing (as in 'bungalow' from Hindi) is an example of", ["lexical change through contact", "semantic narrowing", "grammatical change", "phonological change"], 0, "Words enter English from other languages."),
            ("When a word's meaning becomes more negative over time, this is", ["pejoration", "amelioration", "broadening", "narrowing"], 0, "e.g. 'silly' once meant blessed."),
        ]),
        ("6", "Child language acquisition", "a2", [
            ("'Holophrastic' speech is", ["one word used to express a whole idea", "two-word combinations", "full sentences", "babbling"], 0, "e.g. 'juice' meaning 'I want juice'."),
            ("Overgeneralisation, as in 'goed', shows that children", ["are learning grammatical rules", "are copying adults exactly", "cannot hear correctly", "know irregular verbs"], 0, "Applying a rule where it doesn't fit shows rule-learning."),
        ]),
        ("7", "English in the world", "a2", [
            ("A pidgin is", ["a simplified contact language with no native speakers", "a regional accent", "a dialect of English", "an extinct language"], 0, "When it gains native speakers it becomes a creole."),
        ]),
        ("8", "Language and the self", "a2", [
            ("Code-switching is", ["moving between languages or varieties within a conversation", "speaking in code", "an accent change over years", "learning a second language"], 0, "Speakers switch for identity, audience or topic."),
        ]),
    ],
    papers={
        "1": ("Reading", "written", 135, 50, "as", ["1", "2"]),
        "2": ("Writing", "written", 120, 50, "as", ["3", "4"]),
        "3": ("Language Analysis", "written", 135, 50, "a2", ["5", "6"]),
        "4": ("Language Topics", "written", 135, 50, "a2", ["7", "8"]),
    },
    routes={"as": ["1", "2"], "a2": ["1", "2", "3", "4"]},
    long=[
        ("1", "1", "Analyse the language of an advertisement of your choice, focusing on how it persuades its audience. (Mark yourself with this scheme.)", ["B1: identifies audience, purpose and context", "B1: analyses lexis with precise terminology", "B1: analyses grammar or sentence structure for effect", "B1: comments on structure and layout", "B1: links every feature to its effect on the audience"], None),
        ("6", "3", "A child of 2 years says 'daddy car go'. Comment on what this shows about the child's language development.", ["B1: telegraphic stage (about 2;0–2;6)", "B1: content words kept; function words (determiners, auxiliaries) omitted", "B1: correct subject–object–verb meaning order", "B1: links to a theory, e.g. Brown's stages or Chomsky's LAD"], None),
    ],
)

BANKS["igcse/soc"] = dict(
    subject="soc", name="Sociology", board="Cambridge IGCSE", code="0495",
    topics=[
        ("1", "Theory and methods", None, [
            ("Quantitative data is", ["numerical data", "data from in-depth interviews", "personal documents", "observations written as notes"], 0, "Quantitative = numbers; qualitative = words and meanings."),
            ("A sample that represents the population is", ["representative", "random", "biased", "reliable"], 0, "Representativeness allows generalisation."),
            ("Positivists prefer", ["scientific, quantitative methods", "unstructured interviews", "participant observation", "personal diaries"], 0, "Interpretivists prefer qualitative methods."),
        ]),
        ("2", "Culture, identity and socialisation", None, [
            ("Norms are", ["unwritten rules of behaviour", "laws passed by government", "beliefs about God", "biological instincts"], 0, "Norms guide everyday behaviour."),
            ("Primary socialisation mainly takes place in", ["the family", "school", "the workplace", "the media"], 0, "In early childhood, within the family."),
        ]),
        ("3", "Social inequality", None, [
            ("Social mobility means", ["movement between social classes", "moving house", "migration", "changing jobs within a class"], 0, "Upward or downward mobility."),
            ("A meritocracy is a system where rewards are based on", ["ability and effort", "inheritance", "gender", "ethnicity"], 0, "Functionalists claim modern societies are meritocratic."),
        ]),
        ("4", "Family", None, [
            ("A nuclear family consists of", ["parents and their dependent children", "grandparents, parents and children", "a single parent", "relatives living nearby"], 0, "The extended family includes wider kin."),
        ]),
        ("5", "Education", None, [
            ("The 'hidden curriculum' is", ["the values and attitudes learned informally at school", "the exam syllabus", "homework", "private tuition"], 0, "e.g. punctuality, obedience."),
        ]),
        ("6", "Crime, deviance and social control", None, [
            ("Deviance is", ["behaviour that goes against social norms", "always illegal", "only violent crime", "behaviour approved of by society"], 0, "Deviance need not be criminal."),
            ("Formal social control includes", ["the police and courts", "peer pressure", "gossip", "family disapproval"], 0, "Informal control comes from family, peers and community."),
        ]),
        ("7", "Media", None, [
            ("A 'moral panic' is", ["an exaggerated public reaction to a group seen as a threat", "a financial crash", "a news report", "a type of censorship"], 0, "Cohen's study of Mods and Rockers."),
        ]),
    ],
    papers={
        "1": ("Paper 1", "written", 120, None, "any", ["1", "2", "3"]),
        "2": ("Paper 2", "written", 105, None, "any", ["4", "5", "6", "7"]),
    },
    routes={"igcse": ["1", "2"]},
    long=[
        ("1", "1", "Describe two advantages of using questionnaires in sociological research.", ["B1: one advantage, e.g. large samples can be reached quickly and cheaply", "B1: developed: so results can be generalised", "B1: a second advantage, e.g. standardised questions give reliable, comparable data", "B1: developed: easy to analyse statistically"], None),
        ("6", "2", "Explain why some social groups appear more often in official crime statistics.", ["B1: one reason, e.g. police target certain groups (labelling, stereotyping)", "B1: developed with how this raises recorded crime", "B1: a second reason, e.g. material deprivation or subcultures", "B1: developed with a link to evidence or a theorist"], None),
    ],
)

BANKS["igcse/gp"] = dict(
    subject="gp", name="Global Perspectives", board="Cambridge IGCSE", code="0457",
    topics=[
        ("1", "Research and information", None, [
            ("A primary source is", ["information you collect first-hand, e.g. a survey you run", "a textbook", "a newspaper report", "an encyclopedia"], 0, "Secondary sources are others' work."),
            ("The most reliable source on a medical claim is usually", ["a peer-reviewed study", "a social media post", "an advert", "an anonymous blog"], 0, "Peer review checks methods and evidence."),
        ]),
        ("2", "Analysis: causes, consequences and perspectives", None, [
            ("A 'perspective' is", ["a point of view shaped by experience and values", "a fact", "a statistic", "a source"], 0, "GP asks you to compare personal, local, national and global perspectives."),
        ]),
        ("3", "Evaluation of sources and arguments", None, [
            ("A vested interest means", ["the author gains from persuading you", "the source is old", "the author is an expert", "the source is primary"], 0, "e.g. a company reporting on its own product."),
        ]),
        ("4", "Reflection", None, [
            ("Reflection in GP means", ["considering how your views and skills changed", "summarising the topic", "listing sources", "writing a conclusion"], 0, "Reflect on what you learned and how."),
        ]),
        ("5", "Collaboration (team project)", None, [
            ("Good teamwork in the project means", ["agreeing roles and contributing to a shared outcome", "one person doing it all", "working separately without meeting", "avoiding disagreement at all costs"], 0, "Collaboration is assessed."),
        ]),
        ("6", "Communication", None, [
            ("A good written argument is", ["clear, structured and supported by evidence", "long", "full of jargon", "based only on opinion"], 0, "Structure and evidence persuade."),
        ]),
    ],
    papers={
        "1": ("Written Examination", "written", 90, None, "any", ["1", "2", "3", "6"]),
        "2": ("Individual Report", "practical", None, None, "any", ["1", "2", "3", "4", "6"]),
        "3": ("Team Project", "practical", None, None, "any", ["4", "5", "6"]),
    },
    routes={"igcse": ["1", "2", "3"]},
    long=[
        ("3", "1", "A source claims 'Electric cars will solve air pollution in cities'. Evaluate how convincing this claim is.", ["B1: identifies the claim and any evidence offered", "B1: questions the source: author, purpose, vested interest", "B1: weakness: pollution also from roads, tyres, industry, and electricity generation", "B1: a reasoned judgement on how convincing it is"], None),
    ],
)

BANKS["alevel/gpr"] = dict(
    subject="gpr", name="Global Perspectives and Research", board="Cambridge International AS & A Level", code="9239",
    topics=[
        ("1", "Analysing arguments and evidence", "as", [
            ("An argument's conclusion is", ["what the author wants you to accept", "the last sentence", "a piece of evidence", "a counter-argument"], 0, "Find it first, then judge the support."),
            ("An assumption is", ["an unstated idea the argument depends on", "a fact with a source", "a statistic", "a conclusion"], 0, "Unstated but needed for the argument to work."),
        ]),
        ("2", "Evaluating perspectives", "as", [
            ("Evaluating a perspective means judging", ["the quality of its reasoning and evidence", "whether you like it", "its length", "how popular it is"], 0, "Assess strength, not agreement."),
        ]),
        ("3", "Research skills", "as", [
            ("A research question should be", ["focused, debatable and researchable", "very broad", "answerable with yes or no", "already settled"], 0, "It guides the whole essay or report."),
        ]),
        ("4", "Essay (individual)", "as", [
            ("The individual essay must consider", ["different perspectives on a global issue", "only your own view", "a single source", "local issues only"], 0, "Perspectives are central to the course."),
        ]),
        ("5", "Team project and reflection", "as", [
            ("In the team project, each member", ["researches a different perspective and proposes a solution", "writes the same essay", "does a presentation alone without research", "only reflects"], 0, "Plus an individual reflective paper."),
        ]),
        ("6", "Cambridge Research Report", "a2", [
            ("A research report should include", ["a methodology, analysis of sources and a reflective log", "only a literature list", "a story", "no conclusion"], 0, "Method, evidence, judgement and reflection."),
        ]),
    ],
    papers={
        "1": ("Written Examination", "written", 90, 30, "as", ["1", "2"]),
        "2": ("Essay", "practical", None, None, "as", ["2", "3", "4"]),
        "3": ("Team Project", "practical", None, None, "as", ["3", "5"]),
        "4": ("Cambridge Research Report", "practical", None, None, "a2", ["3", "6"]),
    },
    routes={"as": ["1", "2", "3"], "a2": ["1", "2", "3", "4"]},
    long=[
        ("1", "1", "Read an opinion article on any global issue. Identify its conclusion, two reasons, and one assumption, then evaluate its strength. (Mark yourself with this scheme.)", ["B1: conclusion identified accurately", "B1: two reasons identified", "B1: an unstated assumption identified", "B1: a weakness in reasoning or evidence explained", "B1: a supported overall judgement"], None),
    ],
)
