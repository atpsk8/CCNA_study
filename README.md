# CCNA Study

A study companion for the CCNA 200-301 (v1.1) exam, organized around the
*CCNA 200-301 Official Cert Guide Library, 2nd Edition* (Wendell Odom, Volumes 1 & 2).

```
npm install
npm run dev
```

## What's in it

| Section | What it does |
|---|---|
| Today | A switch faceplate where each port is a chapter (amber = started, green = done), plus what to study next. |
| Study plan | 56 chapters in 15 parts. Each chapter has a checklist: every book section (with its printed page), flashcards, quiz, and linked labs. Week-by-week schedule from your hours per week. |
| Labs | 17 labs that run in a simulated Cisco CLI right in the browser: no Packet Tracer, nothing to install. Tasks check themselves off. |
| Quizzes | 225 original questions tagged by chapter. Scoring 85%+ on a chapter checks it off in the plan. |
| Flashcards / Glossary | 196 original terms, filterable by chapter and searchable. |
| Subnetting | Random problems at three difficulty levels with typed answers. |
| Exam topics | Every v1.1 exam topic, which chapters cover it, and your coverage. |

Progress is saved in the browser (localStorage), so each visitor tracks their own.

## Opening the book

"Connect your book" lets each reader pick their own PDF. It is stored in that browser (IndexedDB) and never
uploaded. Every page number on the site then opens the PDF at that printed page. If a different edition of the
PDF lands on the wrong page, "Wrong page?" in the reader fixes the offset once for every link.

## The lab simulator (`src/sim/`)

| File | Role |
|---|---|
| `engine.js` | `LabEngine`: devices, cabling, terminals, syslog messages, ping/traceroute, SSH/Telnet, PC commands, task checks |
| `cli.js` | IOS modes, abbreviations, `?` help, Tab completion, `no` forms, and every supported command |
| `network.js` | Link state, DTP/trunks, EtherChannel, Rapid PVST+, VLAN segments, static/OSPF routing, HSRP, ACLs, NAT, DHCP, DHCP snooping, DAI, port security |
| `show.js` | `show` command output formatted like IOS XE |
| `device.js`, `ip.js`, `iface.js` | Config storage, address math, interface names |

Labs are defined in `src/data/labs.js`: topology, starting configs, tasks (each with a `check(api)` function) and a solution.

## Where the content lives

All study content is plain data in `src/data/`: `curriculum.js` (chapters, sections, printed pages),
`notes.js`, `objectives.js`, `questions-v1.js`, `questions-v2.js`, `glossary.js`, `labs.js`.
Chapter ids look like `v1-08` (Volume 1, Chapter 8).

## Copyright note

The book's chapter/section titles and page numbers are used only as references. All notes, questions,
definitions and labs are original. Don't put text, figures or questions from the book on this site if you
publish it, and don't host the PDF: each reader connects their own copy.
