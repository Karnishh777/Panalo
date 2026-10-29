# ICT 0417 and Information Technology 9626.

BANKS = {}

BANKS["igcse/ict"] = dict(
    subject="ict", name="ICT", board="Cambridge IGCSE", code="0417",
    topics=[
        ("1", "Types and components of computer systems", None, [
            ("Which is an example of system software?", ["an operating system", "a word processor", "a spreadsheet", "a web browser"], 0, "System software runs the computer; application software does user tasks."),
            ("RAM is best described as", ["volatile memory that holds data in use", "permanent storage", "a type of ROM", "an output device"], 0, "Its contents are lost when power is off."),
        ]),
        ("2", "Input and output devices", None, [
            ("Which is a direct data entry device?", ["a barcode reader", "a keyboard", "a mouse", "a monitor"], 0, "It captures data without typing."),
            ("A sensor in a greenhouse is an", ["input device", "output device", "storage device", "processor"], 0, "It sends readings to the computer."),
        ]),
        ("3", "Storage devices and media", None, [
            ("Which has no moving parts?", ["a solid-state drive", "a hard disk drive", "a DVD", "magnetic tape"], 0, "SSDs use flash memory."),
            ("Magnetic tape is best for", ["large backups accessed rarely", "fast random access", "booting a computer", "a phone's storage"], 0, "Serial access suits archives."),
        ]),
        ("4", "Networks and the effects of using them", None, [
            ("What does a router do?", ["connects a local network to other networks such as the internet", "stores web pages", "prints documents", "only connects two computers"], 0, "It forwards packets between networks."),
            ("Which is a benefit of cloud storage?", ["files can be accessed from anywhere with internet", "it never needs internet", "it can't be hacked", "it is always free"], 0, "Access anywhere; relies on connection and the provider."),
        ]),
        ("5", "The effects of using IT", None, [
            ("Repetitive strain injury can be reduced by", ["ergonomic keyboards and regular breaks", "brighter screens", "faster processors", "larger hard disks"], 0, "A health issue, not a safety one."),
        ]),
        ("6", "ICT applications", None, [
            ("An expert system includes a knowledge base and", ["an inference engine", "a printer driver", "a web server", "a spreadsheet"], 0, "Plus a rules base and user interface."),
        ]),
        ("7", "The systems life cycle", None, [
            ("The correct order is", ["analysis, design, development and testing, implementation, documentation, evaluation", "design, analysis, implementation, testing", "testing, design, analysis", "implementation, analysis, design"], 0, "Analyse first, evaluate last."),
            ("Parallel running means", ["the old and new systems run together for a time", "the new system replaces the old at once", "one department changes first", "the system is changed in stages"], 0, "Safer but more costly."),
        ]),
        ("8", "Safety and security", None, [
            ("Phishing is", ["fake emails trying to trick you into giving personal details", "a virus that deletes files", "a firewall", "a type of encryption"], 0, "Check sender and links."),
            ("Encryption", ["makes data unreadable without the key", "deletes data", "blocks all viruses", "speeds up a network"], 0, "It protects data if intercepted."),
        ]),
        ("9", "Audience", None, [
            ("When designing for young children, you should use", ["large text, simple language and images", "dense text", "technical terms", "small fonts"], 0, "Match the product to its audience."),
        ]),
        ("10", "Communication", None, [
            ("CC in an email means", ["a copy is sent to another recipient visibly", "a hidden copy", "the email is confidential", "the email is compressed"], 0, "BCC hides recipients."),
        ]),
        ("11", "File management", None, [
            ("Which file type is best for a photograph on a web page?", ["JPEG", "CSV", "RTF", "TXT"], 0, "JPEG compresses photos well."),
            ("A CSV file stores", ["data as plain text separated by commas", "images", "sound", "formatted documents"], 0, "Easy to import into spreadsheets and databases."),
        ]),
        ("12", "Images", None, [
            ("To resize an image without distorting it, you should", ["keep the aspect ratio", "change only the width", "crop it", "rotate it"], 0, "Maintain the proportions."),
        ]),
        ("13", "Layout", None, [
            ("A header in a document", ["appears at the top of every page", "is the first paragraph", "is a table title", "is a footnote"], 0, "Footers appear at the bottom."),
        ]),
        ("14", "Styles", None, [
            ("Using styles in a document helps", ["keep formatting consistent", "check spelling", "add images", "encrypt the file"], 0, "Change a style once and it updates everywhere."),
        ]),
        ("15", "Proofing", None, [
            ("Validation checks that data is", ["reasonable and within rules", "exactly correct", "copied accurately", "spelt correctly"], 0, "Verification checks it was entered accurately."),
            ("A range check would stop", ["an age of 250 being entered", "a misspelt name", "a typo in a postcode that is still valid", "a duplicate record"], 0, "It checks a value lies between limits."),
        ]),
        ("16", "Graphs and charts", None, [
            ("Which chart best shows parts of a whole?", ["a pie chart", "a line graph", "a scatter graph", "a table"], 0, "Each sector is a share of the total."),
        ]),
        ("17", "Document production", None, [
            ("Mail merge combines", ["a master document with a data source", "two images", "a spreadsheet and a chart", "web pages"], 0, "To personalise letters for many people."),
        ]),
        ("18", "Databases", None, [
            ("A primary key", ["uniquely identifies each record", "is always a name", "links to another table only", "is optional"], 0, "No two records share it."),
            ("Which field type suits a phone number?", ["text", "integer", "Boolean", "date"], 0, "Leading zeros and '+' signs must be kept."),
        ]),
        ("19", "Presentations", None, [
            ("A master slide is used to", ["set consistent design across all slides", "add a single animation", "print handouts", "record narration"], 0, "Change it once for every slide."),
        ]),
        ("20", "Spreadsheets", None, [
            ("Which formula adds cells A1 to A10?", ["=SUM(A1:A10)", "=ADD(A1-A10)", "=A1+A10", "=TOTAL(A1,A10)"], 0, "SUM with a range."),
            ("$A$1 in a formula is", ["an absolute reference", "a relative reference", "a range", "a function"], 0, "It doesn't change when copied."),
            ("=IF(B2>=50,\"Pass\",\"Fail\") returns 'Pass' when B2 is", ["50 or more", "less than 50", "exactly 49", "empty"], 0, ">= means greater than or equal to."),
        ]),
        ("21", "Website authoring", None, [
            ("In a web page, the presentation layer is created with", ["CSS", "HTML only", "a database", "a spreadsheet"], 0, "HTML is content, CSS is presentation."),
            ("A relative file path", ["is relative to the current page's folder", "starts with http://", "is always absolute", "points to a different website"], 0, "Relative paths keep a site portable."),
        ]),
    ],
    papers={
        "1": ("Theory", "written", 90, 80, "any", ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]),
        "2": ("Document Production, Databases and Presentations", "practical", 135, 70, "any", ["11", "12", "13", "14", "15", "17", "18", "19"]),
        "3": ("Spreadsheets and Website Authoring", "practical", 135, 70, "any", ["11", "12", "15", "16", "20", "21"]),
    },
    routes={"igcse": ["1", "2", "3"]},
    long=[
        ("7", "1", "Describe two methods of implementing a new system and give one advantage of each.", ["B1: direct changeover: the old system is replaced at once", "B1: advantage: fast and cheap, benefits immediately", "B1: parallel running: both systems run together", "B1: advantage: if the new system fails, the old one is still there"], None),
        ("8", "1", "Explain two ways a student could protect their personal data online.", ["B1: one method, e.g. strong passwords / two-factor authentication", "B1: explained: makes unauthorised access harder", "B1: a second method, e.g. not opening links in unexpected emails (phishing) / privacy settings", "B1: explained"], None),
        ("15", "2", "Explain the difference between validation and verification, with an example of each.", ["B1: validation: the computer checks data is reasonable / follows rules", "B1: e.g. a range check on age", "B1: verification: checks data has been entered or copied accurately", "B1: e.g. double entry of a password / visual check"], None),
    ],
)

BANKS["alevel/it"] = dict(
    subject="it", name="Information Technology", board="Cambridge International AS & A Level", code="9626",
    topics=[
        ("1", "Data processing and information", "as", [
            ("Information is", ["data that has been processed and given meaning", "raw facts", "a database", "binary code"], 0, "Data + context = information."),
            ("Batch processing suits", ["payroll run once a month", "airline bookings", "air traffic control", "online games"], 0, "Real-time processing suits bookings and control."),
        ]),
        ("2", "Hardware and software", "as", [
            ("A compiler", ["translates the whole program before it runs", "translates line by line as it runs", "is an operating system", "is a utility for backups"], 0, "An interpreter works line by line."),
        ]),
        ("3", "Monitoring and control", "as", [
            ("In a control system, an actuator", ["carries out a physical action, e.g. opens a window", "measures temperature", "stores data", "displays results"], 0, "Sensors measure; actuators act."),
        ]),
        ("4", "Algorithms and flowcharts", "as", [
            ("In a flowchart, a decision is shown by", ["a diamond", "a rectangle", "an oval", "a parallelogram"], 0, "Rectangles are processes; parallelograms are input/output."),
        ]),
        ("5", "eSafety and health and safety", "as", [
            ("Which is a safety risk rather than a health risk?", ["trailing cables", "eye strain", "back pain", "RSI"], 0, "Safety risks cause accidents."),
        ]),
        ("6", "The digital divide", "as", [
            ("The digital divide is", ["the gap between those with and without access to technology", "a type of network", "a security threat", "a coding error"], 0, "Caused by income, location, age, education."),
        ]),
        ("7", "Using networks", "as", [
            ("What does a VPN do?", ["creates an encrypted connection over a public network", "is a type of router", "speeds up the internet", "stores websites"], 0, "Virtual private network."),
        ]),
        ("8", "Expert systems", "as", [
            ("The inference engine of an expert system", ["applies rules to the knowledge base to reach conclusions", "stores facts", "is the user interface", "explains its reasoning only"], 0, "The reasoning part."),
        ]),
        ("9", "Spreadsheets", "as", [
            ("VLOOKUP searches", ["the first column of a table for a value and returns one from another column", "every cell for a value", "a database", "a chart"], 0, "Vertical lookup."),
        ]),
        ("10", "Database and file concepts", "as", [
            ("A foreign key", ["links a record to the primary key of another table", "is unique in its own table", "is encrypted", "is a field type"], 0, "Used to create relationships."),
            ("Normalisation aims to", ["reduce data redundancy", "add duplicate data", "speed up printing", "encrypt data"], 0, "Removes repeated data and anomalies."),
        ]),
        ("11", "Sound and video editing", "as", [
            ("Lossy compression", ["permanently removes some data to reduce file size", "keeps every bit of data", "increases file size", "is used for text files"], 0, "e.g. MP3, MP4."),
        ]),
        ("12", "Emerging technologies", "a2", [
            ("Augmented reality", ["overlays digital content on the real world", "replaces the real world entirely", "is a type of database", "is 3D printing"], 0, "VR replaces; AR overlays."),
        ]),
        ("13", "Role and impact of IT in society", "a2", [
            ("Which is an impact of online banking on society?", ["fewer bank branches and less face-to-face service", "more paper cheques", "slower payments", "no risk of fraud"], 0, "Convenience with social costs."),
        ]),
        ("14", "Networks", "a2", [
            ("TCP/IP is", ["the set of protocols the internet uses", "a type of cable", "a web browser", "an operating system"], 0, "Transmission Control Protocol / Internet Protocol."),
        ]),
        ("15", "Project management", "a2", [
            ("A Gantt chart shows", ["tasks against time", "a network's layout", "a database structure", "a program's logic"], 0, "Used to schedule and track a project."),
            ("The critical path is", ["the longest sequence of dependent tasks", "the cheapest route", "the first task", "any task with slack"], 0, "It sets the shortest possible project duration."),
        ]),
        ("16", "System life cycle", "a2", [
            ("Black-box testing checks", ["inputs and outputs without looking at the code", "each line of code", "the hardware", "user documentation"], 0, "White-box testing looks at internal logic."),
        ]),
        ("17", "Graphics creation", "a2", [
            ("Vector graphics", ["scale without losing quality", "are made of pixels", "are always photographs", "cannot be edited"], 0, "Stored as shapes and paths."),
        ]),
        ("18", "Animation", "a2", [
            ("In animation, tweening", ["generates frames between key frames", "deletes frames", "adds sound", "compresses video"], 0, "In-betweening."),
        ]),
        ("19", "Programming for the web", "a2", [
            ("JavaScript in a web page is mainly used to", ["add interactivity in the browser", "store a database", "style text", "host the website"], 0, "HTML structure, CSS style, JavaScript behaviour."),
        ]),
        ("20", "Mail merge", "a2", [
            ("A mail merge field", ["is replaced with data from the source for each record", "is a fixed piece of text", "is a header", "is an image"], 0, "e.g. «FirstName»."),
        ]),
    ],
    papers={
        "1": ("Theory", "written", 105, 75, "as", ["1", "2", "3", "4", "5", "6", "7", "8"]),
        "2": ("Practical", "practical", 150, 90, "as", ["9", "10", "11"]),
        "3": ("Advanced Theory", "written", 105, 75, "a2", ["12", "13", "14", "15", "16"]),
        "4": ("Advanced Practical", "practical", 150, 90, "a2", ["17", "18", "19", "20"]),
    },
    routes={"as": ["1", "2"], "a2": ["1", "2", "3", "4"]},
    long=[
        ("3", "1", "A greenhouse uses a computer to control temperature. Describe how the system works.", ["B1: a temperature sensor measures temperature continuously", "B1: an ADC converts the analogue reading to digital", "B1: the microprocessor compares the reading with a preset value", "B1: if too high, it sends a signal to an actuator to open a window / start a fan", "B1: the process repeats continuously (feedback)"], None),
        ("1", "1", "Compare batch processing and real-time processing, giving a suitable use for each.", ["B1: batch: data collected and processed together later, without user interaction", "B1: use: payroll / utility bills", "B1: real-time: data processed immediately as it arrives", "B1: use: booking systems / control systems"], None),
        ("15", "3", "Explain how a Gantt chart helps a project manager.", ["B1: shows each task against a timeline", "B1: shows dependencies and the critical path", "B1: helps allocate resources and spot clashes", "B1: progress can be tracked against the plan"], None),
    ],
)
