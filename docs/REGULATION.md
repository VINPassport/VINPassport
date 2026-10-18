# Regulatory basis

Primary sources for every regulatory claim made in this repository. All links go to EUR-Lex, the
official EU law portal: free, no account, all official languages.

---

## The one that matters

### Regulation (EU) 2026/1738: vehicle circularity and end-of-life vehicles

**[Read the full text on EUR-Lex →](https://eur-lex.europa.eu/eli/reg/2026/1738/oj)**

This is the legal basis for VINPassport. It establishes the **Digital Circularity Vehicle Passport**.

| | | Provision |
|---|---|---|
| Published in the Official Journal | 24 July 2026 | n/a |
| Entered into force | 13 August 2026 | Art. 59(1), the twentieth day after publication |
| Generally applies from | 1 September 2028 | Art. 59(2) |
| Passport empowerment (Commission implementing acts) applies from | 14 September 2026 | Art. 59(2), listing Art. 13(6) |
| Scope extends to special purpose vehicles from | 1 September 2029 | Art. 2(1)(b) |
| Manufacturer "circularity strategy" required from | 1 September 2029 | Art. 9(1) |
| **Digital Circularity Vehicle Passport mandatory from** | **1 September 2032** | **Art. 13(1)** |
| Repeals | [Directive 2000/53/EC](https://eur-lex.europa.eu/eli/dir/2000/53/oj) (end-of-life vehicles) and [Directive 2005/64/EC](https://eur-lex.europa.eu/eli/dir/2005/64/oj) (3R type-approval) | n/a |

*Every date above was read from the Official Journal PDF on 2026-09-08, not from secondary analysis.*

**Provisions this project builds on:**

| Provision | Subject | Relevance |
|---|---|---|
| **Article 13** | Digital Circularity Vehicle Passport | **The legal basis.** The passport itself, which VINPassport implements. Cite 13(1), (2), (4), (5), (6) |
| **Recital 46** | Why a passport should exist; the data-carrier framing | Interpretive support **only**. Recitals say *should*, not *shall*, and create no obligations, so never cite it as an article |
| **Article 6** | Minimum recycled content in vehicles | **Plastic only.** 15 % recycled plastic by weight for types approved from 1 Sept 2032, 25 % from 1 Sept 2036 (6(1)); at least 20 % of that target from plastics recycled from end-of-life vehicles (6(2)). Drives field slots 8 and 9 |
| **Article 10** | Declaration on recycled content present in vehicles | The declaration itself, and one of the four items Art. 13(2) requires the passport to carry |
| **Article 11** | Information on removal and replacement of parts, components and materials | Annex VI payload; the first item listed in Art. 13(2) |

**Steel and aluminium are not yet mandated.** Recitals (33) and (34) empower the Commission to set
minimum recycled shares for steel and for aluminium by delegated act. **No target exists today.**
Slots 10 and 11 are held ready for those acts and must not be described as current obligations.

**Article 29 is *Mandatory removal of parts and components for reuse, remanufacturing,
refurbishment***, nothing to do with recycled content. It was cited here for recycled plastic
until 9 September 2026. The Article 46 warning below records an identical kind of slip: a real
article, genuinely relevant to the project, attached to the wrong obligation.

**Not the passport, and a common invisible mistake:**

| Provision | Subject | Why it gets confused |
|---|---|---|
| **Article 46** | Electronic systems (MOVE-HUB) | Governs exchange of the VIN, registration and roadworthiness status between national vehicle registers, and interconnection to the EU Single Window for Customs. Genuinely relevant to provenance (see also Arts. 36, 37, 39, 40), but it is **not** the passport obligation |

> **Why this warning exists.** Until 2026-09-08 this repo cited *Article 46* as the legal basis for
> the passport, in five files. The error came from Recital 46, which genuinely *is* about the
> passport, being recorded as an article. Because Article 46 also exists and is also relevant, the
> mistake was invisible. The tell is the verb: **recitals say *should*, operative articles say
> *shall***. Verified against the OJ PDF: Article 13 is headed "Digital Circularity Vehicle
> Passport"; Article 46 is headed "Electronic systems".

The clause that shapes the architecture is the interoperability requirement: the passport must be
*aligned, interoperable and, where possible, integrated with other vehicle related environmental
passports established under Union law*. That is a direct invitation to dock with the battery
passport below, and note the verb is **interoperate**, not absorb.

VINPassport reads that as a **reference**, not a copy: slot 29 `batteryPassportId` points at an EV's
battery passport, and the battery's own claims stay in that passport where they are authoritative.
Restating them here would create two records that can disagree. Whether the panel should also mirror
`batteryStateOfHealthPct` is an open question: see [FIELDS.md](FIELDS.md).

---

## The one that binds first

### Regulation (EU) 2024/1257: Euro 7

**[Read the full text on EUR-Lex →](https://eur-lex.europa.eu/eli/reg/2024/1257/oj)**

Euro 7 creates the **Environmental Vehicle Passport (EVP)**, and unlike the circularity passport it
is already law with a date six years earlier. Every provision quoted below was read from the
Official Journal HTML on 2026-10-14.

| Milestone | Date | Source |
|---|---|---|
| Entered into force | 28 May 2024 | twentieth day after publication |
| Commission to adopt EVP implementing acts, M1 and N1 | 29 May 2025 | Art. 14(8)(a) |
| **Applies to new TYPES of M1 and N1** | **29 November 2026** | Art. 21 |
| Applies to all new M1 and N1 vehicles | 29 November 2027 | Art. 21 |
| Commission to adopt EVP implementing acts, heavy and trailers | 29 November 2026 | Art. 14(9)(a) |
| Applies to new types of M2, M3, N2, N3, O3, O4 | 29 May 2028 | Art. 21 |
| Applies to all new M2, M3, N2, N3, O3, O4 | 29 May 2029 | Art. 21 |
| Small-volume manufacturers, M1 and N1 | 1 July 2030 | Art. 21 |

#### The obligation

**Article 7(4)** is the operative provision, and it binds manufacturers:

> Manufacturers **shall issue an EVP for each vehicle** and deliver that passport to the purchaser
> together with the vehicle, extracting the relevant data from sources, such as the certificate of
> conformity and the type-approval documentation. Manufacturers **shall ensure** that EVP data are
> available for display in the vehicle electronic systems or **through a QR code**, or any similar
> method, and that EVP data can be transmitted from on- to off- board.

**Article 3(68)** defines what it holds: *"a record in digital form that contains information on the
environmental performance of a vehicle at the moment of registration"*, covering pollutant emission
limits, CO2 emissions, fuel consumption, electric energy consumption, electric range, engine or
electric motor power, and **battery durability and other related values**.

**Article 4(10)** extends the data beyond the moment of registration:

> Those data shall cover data from the EVP, the OBM system and the OBFCM device, **including
> lifetime values**, and the **state of health of the traction battery**.

#### Why this provision in particular is the one to build against

<!-- disclosure-ok: Article 4(7) of Reg (EU) 2024/1257, quoted verbatim from the OJ -->

**Article 4(7)** requires manufacturers to design vehicles so as to **minimise tampering
vulnerabilities**, and the list of what must be protected is the subject matter of this repository:

> Manufacturers **shall** design, construct and assemble vehicles of categories M1, M2, M3, N1, N2
> and N3 in such a way as to **minimise vulnerabilities**, arising in all phases of their
> life-cycle, that may lead to **tampering** with the following:
> (a) fuel and reagent injection system, (b) engine and engine control units,
> **(c) traction batteries and related management systems, (d) odometer,**
> (e) pollution control systems, (f) electric motor and related control units,
> (g) OBFCM device, (h) OBD system, (i) OBM system, and **(j) EVP.**

<!-- /disclosure-ok -->

A ledger that refuses the write when a value moves the wrong way is a direct answer to 4(7)(d) and
4(7)(j). This is the closest thing in current EU law to a statutory requirement for what the
`vinpassport` contract does, and it binds **five years and nine months before** the Digital
Circularity Vehicle Passport does.

#### The implementing act

**Article 14(4)(t)** empowers the Commission to specify *"the format and data and off-board
communication methods for the EVP"*. For M1 and N1 that act is **Commission Implementing Regulation
(EU) 2025/1707** of 25 July 2025,
[OJ L, 5.9.2025](https://eur-lex.europa.eu/eli/reg_impl/2025/1707/oj/eng), in force on the
twentieth day after publication (Art. 20).

> **Read from the Official Journal on 2026-10-14.** This section recorded the act as unread,
> because EUR-Lex answers an automated request for it with `202` and an empty body. It serves the
> text normally to a browser, and the ELI path for an implementing act is `/eli/reg_impl/`, not
> `/eli/reg/`. The secondary sources summarised here before turned out to be accurate, which is
> worth recording as calibration and is still not a reason to have relied on them.

**Article 17** carries the obligation: the manufacturer issues an EVP for each vehicle (17(1)),
with the data and format of Annex V (17(2)), reachable off board by digital means (17(3)), and

> 4. The manufacturer shall ensure that EVP data are **accessible for at least 20 years** after the
> date of manufacture of the vehicle.

**Annex V** is the specification. The points that decide an implementation:

| Point | What it requires |
|---|---|
| 3.1.1 | The EVP is issued per vehicle and delivered to the purchaser with it, by digital means |
| 3.2.1 | Manufacturers keep EVP data reflecting updates in the relevant CoC fields |
| 4.1.1 | EVP data available for display **through a QR code** |
| 4.1.2 | Printed or engraved on the vehicle, visibly, legibly and indelibly, reachable without disassembly, its location named in the owner's manual |
| 4.1.3 | Or shown on an in-vehicle display, within five screens of the default one |
| 4.1.4 | High contrast, and a size a commonly available reader can read |
| 4.2.1 | The website must be **accessible to persons with disabilities**, per [Directive (EU) 2019/882](https://eur-lex.europa.eu/eli/dir/2019/882/oj) |
| 4.2.2 | Reached over a **secure web link**; the code goes to a unique vehicle-specific page, or to a generic landing page where onward navigation may ask for the **VIN** |
| 4.2.3 | *"Access to EVP data shall not require additional software, user registration or the provision of any other data besides the vehicle's VIN."* |
| 4.2.4 | Available in the official languages of the Union institutions |

Recital (14) names the standard: the QR code *"should respect the guidelines of ISO/IEC Standard
18004:2024"*. Article 2(9) defines it as *"a machine-readable matrix code that links to
information"*.

#### What the implementing act settles, and what it does not

Four choices here were made on other grounds and turn out to be the ones the act names:

- the QR encoder follows **ISO/IEC 18004** rather than the convenient library behaviour where the
  two disagree, which is recital (14) ([`site/assets/qr.mjs`](../site/assets/qr.mjs));
- the code resolves straight to a **vehicle-specific page**, so nothing has to be typed: the first
  limb of 4.2.2 rather than the landing-page fallback;
- `/verify/` needs **no wallet, no account, no login and no software**, which is 4.2.3;
- every page carries a `<main>` landmark, a way past the bar and a WCAG AA contrast floor, which is
  what 4.2.1 asks for through Directive (EU) 2019/882.

What it does not settle:

- ~~**Appendix 1 to Annex V lists the EVP parameters against CoC field identifiers.** Whether our
  panel aligns is an open question.~~ **Read 18 October 2026. It does not align, and the gap is
  the useful finding.** See the next section.
- The EVP holds environmental performance **at the moment of registration**, updated when the CoC
  fields change (3.2.1). A service history is not within its scope. Euro 7 is what puts a QR code,
  a 20 year data duty and a tampering duty on the manufacturer; the rest of what VINPassport records
  sits beside it under the circularity passport.

#### Appendix 1 to Annex V, read 18 October 2026

Source: [Implementing Regulation (EU) 2025/1707](https://eur-lex.europa.eu/eli/reg_impl/2025/1707/oj),
Annex V Appendix 1, read in a browser because EUR-Lex answers an automated request with `202`.

Five tables, restated here against their Certificate of Conformity field identifiers:

| Table | What it carries | CoC fields |
|---|---|---|
| 1. General vehicle information | Approval certificate number, date approval granted, make, **VIN**, date of manufacture, commercial name | 0.1, 0.2.1, 0.10, 0.11, 0.11(b) |
| 2. Vehicle family identifiers | PEMS family; **OBM family and battery durability family are marked Reserved** | 0.2.3.3 |
| 3. Powertrain data | Maximum net power, combustion engine and electric motor | 27.1, 27.3 |
| 4. Pollutant emissions | WLTP highest values for CO, NOx, NMHC, THC, THC+NOx, particle mass, particle number | 48 |
| 5. CO2, fuel consumption, electrical energy | WLTP values across the phases, electric range, and the OVC-HEV charge-sustaining, charge-depleting, weighted and equivalent-range rows | 49.1, 49.2, 49.4, 49.5 |

**About 20 discrete values for a conventional M1, nearer 45 for a plug-in hybrid**, and every one
of them is fixed at type approval.

**What this settles, and it is not what we assumed.** The EVP is an emissions and type-approval
record. **The odometer is not an EVP parameter. Neither is accident history, write-off status,
owner count, flood damage or service history.** None of the fields the fraud story is built on
appear in Appendix 1. Our 32-slot panel was built from the circularity passport and from what a
buyer asks, and that was the right source: the two documents answer different questions.

**Three distinct duties, which had been running together in our own material:**

<!-- disclosure-ok: restates Arts. 4(7), 4(10) and 17 of Reg (EU) 2024/1257 and Annex V of Reg (EU) 2025/1707. Quoted law, not a finding about this codebase. -->

| Provision | Duty | Changes over life? |
|---|---|---|
| **Art. 17, Annex V, App. 1** | Issue an EVP of the parameters above; keep it **accessible 20 years**; reflect updates **in the relevant CoC fields** (3.2.1) | Essentially never. CoC fields move only on re-approval |
| **Art. 4(10)** | Data available must cover the EVP, OBM and OBFCM, **including lifetime values** and traction battery state of health | **Yes.** This, not the EVP, is where odometer-adjacent and degradation data sit |
| **Art. 4(7)(d), (j)** | Design, construct and assemble so as to **minimise tampering vulnerabilities**, across **all phases of the life-cycle**, for the odometer and for the EVP | A design duty, discharged continuously |

<!-- /disclosure-ok -->

The ratchet answers 4(7)(d) and 4(7)(j). It is not an Appendix 1 obligation and must not be sold as
one. The accurate claim is that a ledger refusing a backward write is a life-cycle anti-tampering
measure under 4(7), and that lifetime values fall under 4(10), while the EVP itself is a static
emissions record we can carry cheaply alongside both.

#### What this changes

The circularity passport is our legal basis and does not move. What Euro 7 adds is a **customer with
a date**: manufacturers of new M1 and N1 types, obliged from 29 November 2026 to issue a tamper
resistant digital environmental record per vehicle, carrying odometer-adjacent lifetime values and
battery state of health, reachable by QR.

Note the overlap with [Regulation (EU) 2023/1542](#regulation-eu-20231542-batteries-and-waste-batteries):
battery state of health appears in both, four months apart. A single record that satisfies the EVP
and composes with a battery passport is a stronger position than either alone.

---

## The one it must interoperate with

### Regulation (EU) 2023/1542: batteries and waste batteries

**[Read the full text on EUR-Lex →](https://eur-lex.europa.eu/eli/reg/2023/1542/oj)**

Establishes the **battery passport** under Article 77, mandatory from **18 February 2027**, five
years ahead of the vehicle passport.

Scope is the battery, **not** the vehicle: EV batteries (any capacity), LMT batteries (any
capacity), and industrial batteries above 2 kWh. An OEM is caught because it places a battery on the
market inside a vehicle, but this regulation gives the *vehicle* no passport.

This matters for VINPassport in two ways. It is the interoperability target named by 2026/1738. And
it is already implemented on the same stack we are building on: [NIGHTPASS](https://github.com/ODATANO/NIGHTPASS)
is a battery passport on NIGHTGATE, which makes a composition demo a realistic Phase 3 goal rather
than an aspiration.

---

## The one that is not the basis, but is a required alignment target

### Regulation (EU) 2024/1781: Ecodesign for Sustainable Products (ESPR)

**[Read the full text on EUR-Lex →](https://eur-lex.europa.eu/eli/reg/2024/1781/oj)**

ESPR is the EU's general Digital Product Passport framework, and it is the one most people reach for
when they hear "digital product passport". **It explicitly excludes vehicles.**

Article 1(2) carves out vehicles within the scope of [Reg 167/2013](https://eur-lex.europa.eu/eli/reg/2013/167/oj),
[Reg 168/2013](https://eur-lex.europa.eu/eli/reg/2013/168/oj) and
[Reg 2018/858](https://eur-lex.europa.eu/eli/reg/2018/858/oj), on the basis that vehicles are covered
by sector-specific law.

**Do not cite ESPR as the basis for a vehicle passport.** It is a factual error, and an easy one for
a regulator, investor or hackathon judge to catch. Regulation 2026/1738 is the correct and only
citation for a vehicle-level passport obligation. This is recorded as a standing warning in
[DECISIONS.md D3](DECISIONS.md#settled).

**But ESPR is not irrelevant: alignment with it is mandatory.** Article 13(1) requires that the
passport *"shall be aligned, interoperable and, where possible, integrated with other vehicle
related environmental passports established under Union law … and with other relevant passports
established pursuant to Regulation (EU) 2024/1781."* Recital 46 names ESPR among the instruments the
passport should be consistent with.

Both statements hold at once, and the distinction is the whole point:

| | ESPR |
|---|---|
| **As legal basis** | ❌ Excluded: Art. 1(2) carves out vehicles |
| **As alignment target** | ✅ Required: Art. 13(1), operative and binding |

So the ESPR Digital Product Passport technical stack and its EN standards are the data model to
build **against**, not an adjacent regime to ignore. When correcting this section, do not resolve
the tension by deleting the exclusion warning above: both halves are load-bearing.

---

## Verification status

Article numbers (46, 29), the repeals, and the OJ publication date were read from the EUR-Lex text
of 2026/1738 directly.

**Euro 7 was read from the Official Journal on 2026-10-14.** Articles 3(68), 4(7), 4(10), 7(4),
14(4)(t), 14(8)(a), 14(9)(a) and 21 are quoted from the EUR-Lex HTML of 2024/1257, not from
summaries.

**Commission Implementing Regulation (EU) 2025/1707 was read the same day**, after an automated
fetch was refused: EUR-Lex returns `202` with an empty body to a script and the full text to a
browser. Recital (14), Article 2(9), Article 17 and Annex V points 2.1 to 4.2.5 are quoted from the
EUR-Lex HTML at `/eli/reg_impl/2025/1707/oj/eng`. **Appendix 1 to Annex V, the parameter table, has
been seen but not worked through**, so no claim may rest on which of our 32 slots it covers.

Dates for entry into force, general application, and the 2032 passport deadline come from secondary
legal analysis rather than the operative articles. They are consistent across multiple independent
sources, but **confirm against the final provisions before using them in anything that matters**, whether a
submission, a partner conversation, or a compliance claim.

Nothing in this repository should be represented as legal advice.
