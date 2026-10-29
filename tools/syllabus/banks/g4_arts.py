# Art and Design 0400 / 9479, Design and Technology 0445 / 9705,
# Hindi as a Second Language 0549, French 0520.

BANKS = {}

ART_MCQ = {
    "record": [
        ("Recording from first-hand observation means", ["drawing or photographing real objects in front of you", "copying images from the internet", "writing an essay", "tracing a photograph"], 0, "First-hand work is valued over second-hand sources."),
        ("Annotation in a sketchbook should", ["explain your thinking, choices and next steps", "describe the weather", "list materials only", "be avoided"], 0, "It shows your reflection and intentions."),
    ],
    "explore": [
        ("Exploring media means", ["experimenting with different materials and techniques", "using only pencil", "finishing the final piece first", "copying an artist exactly"], 0, "Experiments show how ideas develop."),
        ("Studying another artist's work helps you", ["understand techniques and ideas to develop your own", "copy their final piece", "avoid making choices", "skip research"], 0, "Contextual study informs your own direction."),
    ],
    "develop": [
        ("Developing ideas means", ["refining compositions and solutions through a series of studies", "starting a new topic each week", "making one drawing", "choosing at random"], 0, "Show how each step leads to the next."),
    ],
    "present": [
        ("A final outcome should", ["realise your intentions and connect to your preparatory work", "be unrelated to your research", "be as large as possible", "copy a famous work"], 0, "The journey to it is assessed too."),
    ],
    "elements": [
        ("Complementary colours", ["sit opposite each other on the colour wheel", "are next to each other", "are shades of grey", "are only primary colours"], 0, "e.g. red and green."),
        ("Negative space is", ["the space around and between objects", "a dark colour", "a mistake", "the background colour only"], 0, "Using it strengthens composition."),
        ("Linear perspective uses", ["a horizon line and vanishing points", "only colour", "random lines", "flat shapes"], 0, "To create the illusion of depth."),
    ],
}

def art(code, board, sub, a2=False):
    stage = "as" if a2 is not None and board.startswith("Cambridge International") else None
    t = [
        ("1", "Record ideas, observations and insights (AO1)", stage, ART_MCQ["record"]),
        ("2", "Explore and select materials and techniques (AO2)", stage, ART_MCQ["explore"]),
        ("3", "Develop ideas through investigation (AO3)", stage, ART_MCQ["develop"]),
        ("4", "Present a personal, coherent response (AO4)", stage, ART_MCQ["present"]),
        ("5", "Visual elements and art history", stage, ART_MCQ["elements"]),
    ]
    if a2:
        t.append(("6", "Personal investigation (written and practical)", "a2", [("The A Level personal investigation combines", ["practical work with a related written analysis", "only a written essay", "only an exam piece", "group work"], 0, "Practical and written parts connect.")]))
    return t

BANKS["igcse/art"] = dict(
    subject="art", name="Art and Design", board="Cambridge IGCSE", code="0400",
    topics=art("0400", "Cambridge IGCSE", "art"),
    papers={
        "1": ("Coursework", "coursework", None, None, "any", ["1", "2", "3", "4", "5"]),
        "2": ("Externally Set Assignment", "practical", 480, None, "any", ["1", "2", "3", "4", "5"]),
    },
    routes={"igcse": ["1", "2"]},
    note="The Externally Set Assignment is 8 hours of supervised work after a preparation period.",
    long=[],
)

BANKS["alevel/art"] = dict(
    subject="art", name="Art and Design", board="Cambridge International AS & A Level", code="9479",
    topics=art("9479", "Cambridge International AS & A Level", "art", a2=True),
    papers={
        "1": ("Coursework", "coursework", None, None, "as", ["1", "2", "3", "4", "5"]),
        "2": ("Externally Set Assignment", "practical", 900, None, "as", ["1", "2", "3", "4", "5"]),
        "3": ("Personal Investigation", "coursework", None, None, "a2", ["1", "2", "3", "4", "6"]),
    },
    routes={"as": ["1", "2"], "a2": ["1", "2", "3"]},
    note="The AS Externally Set Assignment is 15 hours of supervised work.",
    long=[],
)

DT_CORE = [
    ("1", "The design process", [
        ("A design specification", ["lists the requirements a product must meet", "is the final product", "is a sketch", "is the evaluation"], 0, "It's written after research and used to evaluate."),
        ("Anthropometrics is", ["the study of human body measurements for design", "the study of materials", "a type of joint", "the cost of production"], 0, "Ergonomics uses this data."),
    ]),
    ("2", "Materials and their properties", [
        ("Which is a thermoplastic?", ["acrylic", "urea-formaldehyde", "epoxy resin", "melamine"], 0, "Thermoplastics can be reheated and reshaped."),
        ("A hardwood comes from", ["deciduous, broad-leaved trees", "coniferous trees", "plastic", "metal ore"], 0, "e.g. oak, beech."),
        ("An alloy is", ["a mixture of a metal with other elements", "a pure metal", "a type of plastic", "a wood joint"], 0, "e.g. brass (copper and zinc)."),
    ]),
    ("3", "Manufacturing processes", [
        ("Injection moulding is best suited to", ["mass production of identical plastic parts", "one-off wooden furniture", "casting bronze", "hand-sewing"], 0, "High setup cost, very low unit cost."),
        ("A jig is used to", ["guide a tool so parts are made accurately and repeatably", "hold a drink", "measure temperature", "join wood"], 0, "Useful in batch production."),
    ]),
    ("4", "Product analysis and sustainability", [
        ("Designing for disassembly helps", ["recycling and repair at the end of a product's life", "make products cheaper to sell", "hide fixings", "speed up delivery"], 0, "Part of the circular economy."),
    ]),
    ("5", "Graphic communication", [
        ("An exploded drawing shows", ["how parts fit together", "a product in use", "a cross-section", "colour schemes"], 0, "Parts are drawn spaced along their assembly lines."),
        ("Orthographic projection shows", ["front, side and plan views to scale", "a 3D view in perspective", "an exploded view", "a free sketch"], 0, "Used for manufacturing drawings."),
    ]),
    ("6", "Systems and control", [
        ("A potential divider with an LDR can be used to", ["switch on a light when it gets dark", "measure temperature", "store energy", "increase voltage"], 0, "The LDR's resistance rises in the dark."),
        ("A cam converts", ["rotary motion into reciprocating motion", "linear into rotary", "electrical into light", "heat into motion"], 0, "The follower rises and falls."),
    ]),
]

BANKS["igcse/dt"] = dict(
    subject="dt", name="Design and Technology", board="Cambridge IGCSE", code="0445",
    topics=[(i, n, None, q) for i, n, q in DT_CORE] + [("7", "Coursework: design and make project", None, [("The project folio should show", ["research, ideas, development, making and evaluation", "only the final product", "only sketches", "only an evaluation"], 0, "Every stage of the design process is marked.")])],
    papers={
        "1": ("Product Design", "written", 75, None, "any", ["1", "2", "4", "5"]),
        "2": ("School-based Assessment (project)", "coursework", None, None, "any", ["1", "7"]),
        "3": ("Resistant Materials", "written", 75, None, "any", ["2", "3", "4"]),
        "4": ("Systems and Control", "written", 75, None, "any", ["6", "3"]),
        "5": ("Graphic Products", "written", 75, None, "any", ["5", "4"]),
    },
    routes={"igcse": ["1", "2", "3"]},
    note="Paper 1, the project (component 2), and one of Papers 3, 4 or 5.",
    long=[
        ("2", "3", "A child's toy is to be made from beech. Give two reasons why beech is suitable and one finish you would apply.", ["B1: close grain, so it can be shaped and smoothed well", "B1: hard and durable, so it survives rough use", "B1: a non-toxic finish, e.g. food-safe oil or water-based varnish"], None),
        ("1", "1", "Explain why a designer would write a specification before producing ideas.", ["B1: it sets measurable requirements (function, size, cost, users)", "B1: ideas can be judged against it", "B1: the final product is evaluated against it"], None),
    ],
)

BANKS["alevel/dt"] = dict(
    subject="dt", name="Design and Technology", board="Cambridge International AS & A Level", code="9705",
    topics=[(i, n, "as", q) for i, n, q in DT_CORE] + [
        ("7", "AS design and make project", "as", [("A design brief", ["is a short statement of the problem to be solved", "is the final evaluation", "is a materials list", "is a test report"], 0, "The specification comes after research.")]),
        ("8", "Product design (A Level)", "a2", [("Which is an advantage of CAD/CAM?", ["accurate, repeatable manufacture from digital designs", "no need for designers", "always cheaper for one-offs", "no need for materials"], 0, "Accuracy, speed and repeatability.")]),
        ("9", "A Level design and make project", "a2", [("An A Level project evaluation should", ["test the product against the specification, with users", "describe how you felt", "only list the materials", "skip testing"], 0, "Objective testing and user feedback.")]),
    ],
    papers={
        "1": ("Design and Technology", "written", 180, None, "as", ["1", "2", "3", "4", "5", "6"]),
        "2": ("Design and Make Project", "coursework", None, None, "as", ["1", "7"]),
        "3": ("Product Design", "written", 180, None, "a2", ["1", "2", "3", "4", "8"]),
        "4": ("Design and Make Project", "coursework", None, None, "a2", ["1", "9"]),
    },
    routes={"as": ["1", "2"], "a2": ["1", "2", "3", "4"]},
    long=[
        ("3", "1", "Compare injection moulding and vacuum forming for making 10 000 plastic phone cases.", ["B1: injection moulding: high mould cost but very low unit cost at volume", "B1: produces precise, detailed, varied wall thickness", "B1: vacuum forming: cheap moulds, but thin sheets and less detail", "B1: judgement: injection moulding suits 10 000 units"], None),
    ],
)

BANKS["igcse/hindi"] = dict(
    subject="hindi", name="Hindi as a Second Language", board="Cambridge IGCSE", code="0549",
    topics=[
        ("1", "पठन — Reading comprehension", None, [
            ("'पर्यावरण' का अर्थ है", ["environment", "festival", "education", "market"], 0, "पर्यावरण = environment."),
            ("किसी अनुच्छेद का मुख्य विचार ढूँढने के लिए आपको", ["पूरा अनुच्छेद पढ़कर केंद्रीय बात पहचाननी चाहिए", "केवल पहला शब्द पढ़ना चाहिए", "शीर्षक छोड़ देना चाहिए", "हर संख्या लिखनी चाहिए"], 0, "The main idea runs through the whole paragraph."),
        ]),
        ("2", "लेखन — Writing (letters, articles, essays)", None, [
            ("औपचारिक पत्र की शुरुआत आमतौर पर किससे होती है?", ["महोदय/महोदया", "प्रिय दोस्त", "अरे यार", "नमस्ते भाई"], 0, "Formal letters open with महोदय/महोदया."),
            ("निबंध में निष्कर्ष", ["मुख्य बातों को समेटता है और अपनी राय देता है", "नई बात शुरू करता है", "शीर्षक दोहराता है", "आवश्यक नहीं है"], 0, "A conclusion draws the points together."),
        ]),
        ("3", "व्याकरण — Grammar", None, [
            ("'लड़का' का बहुवचन है", ["लड़के", "लड़कियाँ", "लड़कों", "लड़की"], 0, "Masculine -आ nouns become -ए in the plural (direct case)."),
            ("'मैं कल दिल्ली ___' (future)", ["जाऊँगा", "गया", "जाता हूँ", "जा रहा था"], 0, "Future tense: जाऊँगा/जाऊँगी."),
            ("'ने' का प्रयोग किस काल में सकर्मक क्रिया के कर्ता के साथ होता है?", ["भूतकाल (perfective)", "वर्तमान काल", "भविष्यत् काल", "आज्ञार्थ"], 0, "e.g. राम ने खाना खाया."),
        ]),
        ("4", "शब्दावली — Vocabulary and topics", None, [
            ("'स्वास्थ्य' का अर्थ है", ["health", "freedom", "weather", "travel"], 0, "स्वास्थ्य = health."),
            ("'तेज़' का विलोम है", ["धीमा", "बड़ा", "सुंदर", "गरम"], 0, "Fast ↔ slow."),
        ]),
        ("5", "सुनना — Listening", None, [
            ("सुनने की परीक्षा में पहले", ["प्रश्न पढ़कर समझ लें कि क्या सुनना है", "उत्तर अनुमान से लिख दें", "रिकॉर्डिंग अनसुनी करें", "केवल अंत सुनें"], 0, "Reading the questions first tells you what to listen for."),
        ]),
        ("6", "बोलना — Speaking", None, [
            ("बोलने की परीक्षा में अच्छे उत्तर", ["कारण और उदाहरण के साथ विस्तार से दिए जाते हैं", "एक शब्द में दिए जाते हैं", "अंग्रेज़ी में दिए जाते हैं", "याद किए गए भाषण होते हैं"], 0, "Developed answers score better."),
        ]),
    ],
    papers={
        "1": ("Reading and Writing", "written", 120, None, "any", ["1", "2", "3", "4"]),
        "2": ("Listening", "written", 50, None, "any", ["4", "5"]),
        "3": ("Speaking", "practical", 15, None, "any", ["3", "4", "6"]),
    },
    routes={"igcse": ["1", "2", "3"]},
    long=[
        ("2", "1", "अपने विद्यालय के वार्षिक उत्सव के बारे में अपने मित्र को एक पत्र लिखिए (120–150 शब्द): क्या हुआ, आपने क्या किया, और आपको सबसे अच्छा क्या लगा। (इस योजना से स्वयं को अंक दें।)", ["B1: तीनों बिंदु पूरे और विस्तार से", "B1: अनौपचारिक पत्र का सही प्रारूप (संबोधन, समापन)", "B1: विविध और उचित शब्दावली", "B1: सही व्याकरण (लिंग, वचन, काल)"], None),
    ],
)

BANKS["igcse/french"] = dict(
    subject="french", name="French", board="Cambridge IGCSE", code="0520",
    topics=[
        ("1", "A: Everyday activities", None, [
            ("'Le petit-déjeuner' is", ["breakfast", "lunch", "dinner", "a snack"], 0, "Le déjeuner is lunch; le dîner is dinner."),
            ("'Je me lève à sept heures' means", ["I get up at seven o'clock", "I go to bed at seven", "I leave at seven", "I eat at seven"], 0, "Se lever = to get up."),
        ]),
        ("2", "B: Personal and social life", None, [
            ("'Mon frère aîné' is my", ["older brother", "younger brother", "cousin", "uncle"], 0, "Aîné = older; cadet = younger."),
        ]),
        ("3", "C: The world around us", None, [
            ("'Il fait beau' means", ["the weather is nice", "it is cold", "it is raining", "it is windy"], 0, "Il pleut = it's raining."),
            ("'La gare' is", ["the railway station", "the car park", "the bus stop", "the shop"], 0, "Le commissariat is the police station."),
        ]),
        ("4", "D: The world of work", None, [
            ("'Un stage' in a work context is", ["a work placement", "a stage show", "a salary", "a factory"], 0, "Faire un stage = do work experience."),
        ]),
        ("5", "E: The international world", None, [
            ("'L'environnement' and 'le recyclage' belong to the topic of", ["global issues", "school", "family", "food"], 0, "Topic area E."),
        ]),
        ("6", "Grammar", None, [
            ("Hier, je ___ au cinéma.", ["suis allé(e)", "ai allé", "vais", "irai"], 0, "Aller takes être in the passé composé."),
            ("The adjective 'grand' agreeing with 'une maison' is", ["grande", "grand", "grands", "grandes"], 0, "Feminine singular adds -e."),
            ("'Si j'avais de l'argent, je ___ un vélo.'", ["achèterais", "achète", "ai acheté", "achetais"], 0, "Si + imperfect, then conditional."),
        ]),
    ],
    papers={
        "1": ("Listening", "written", 50, None, "any", ["1", "2", "3", "4", "5", "6"]),
        "2": ("Reading", "written", 60, None, "any", ["1", "2", "3", "4", "5", "6"]),
        "3": ("Speaking", "practical", 15, None, "any", ["1", "2", "3", "4", "5", "6"]),
        "4": ("Writing", "written", 60, None, "any", ["1", "2", "3", "4", "5", "6"]),
    },
    routes={"igcse": ["1", "2", "3", "4"]},
    long=[
        ("2", "4", "Écrivez un e-mail (130–150 mots) à un(e) ami(e) sur vos dernières vacances : où vous êtes allé(e), ce que vous avez fait, et vos projets pour l'année prochaine. (Mark yourself with this scheme.)", ["B1: all three points covered and developed", "B1: past tense (passé composé / imparfait) used accurately", "B1: a future form for next year's plans", "B1: opinions with reasons (parce que, car)", "B1: varied vocabulary and accurate agreement"], None),
    ],
)
