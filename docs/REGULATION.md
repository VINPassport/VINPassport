# Regulatory basis

Primary sources for every regulatory claim made in this repository. All links go to EUR-Lex, the
official EU law portal — free, no account, all official languages.

---

## The one that matters

### Regulation (EU) 2026/1738 — vehicle circularity and end-of-life vehicles

**[Read the full text on EUR-Lex →](https://eur-lex.europa.eu/eli/reg/2026/1738/oj)**

This is the legal basis for VINPassport. It establishes the **Digital Circularity Vehicle Passport**.

| | | Provision |
|---|---|---|
| Published in the Official Journal | 24 July 2026 | — |
| Entered into force | 13 August 2026 | Art. 59(1) — twentieth day after publication |
| Generally applies from | 1 September 2028 | Art. 59(2) |
| Passport empowerment (Commission implementing acts) applies from | 14 September 2026 | Art. 59(2), listing Art. 13(6) |
| Scope extends to special purpose vehicles from | 1 September 2029 | Art. 2(1)(b) |
| Manufacturer "circularity strategy" required from | 1 September 2029 | Art. 9(1) |
| **Digital Circularity Vehicle Passport mandatory from** | **1 September 2032** | **Art. 13(1)** |
| Repeals | [Directive 2000/53/EC](https://eur-lex.europa.eu/eli/dir/2000/53/oj) (end-of-life vehicles) and [Directive 2005/64/EC](https://eur-lex.europa.eu/eli/dir/2005/64/oj) (3R type-approval) | — |

*Every date above was read from the Official Journal PDF on 2026-09-08, not from secondary analysis.*

**Provisions this project builds on:**

| Provision | Subject | Relevance |
|---|---|---|
| **Article 13** | Digital Circularity Vehicle Passport | **The legal basis.** The passport itself — what VINPassport implements. Cite 13(1), (2), (4), (5), (6) |
| **Recital 46** | Why a passport should exist; the data-carrier framing | Interpretive support **only**. Recitals say *should*, not *shall*, and create no obligations — never cite it as an article |
| **Article 6** | Minimum recycled content in vehicles | **Plastic only.** 15 % recycled plastic by weight for types approved from 1 Sept 2032, 25 % from 1 Sept 2036 (6(1)); at least 20 % of that target from plastics recycled from end-of-life vehicles (6(2)). Drives field slots 8–9 |
| **Article 10** | Declaration on recycled content present in vehicles | The declaration itself, and one of the four items Art. 13(2) requires the passport to carry |
| **Article 11** | Information on removal and replacement of parts, components and materials | Annex VI payload; the first item listed in Art. 13(2) |

**Steel and aluminium are not yet mandated.** Recitals (33) and (34) empower the Commission to set
minimum recycled shares for steel and for aluminium by delegated act. **No target exists today.**
Slots 10 and 11 are held ready for those acts and must not be described as current obligations.

**Article 29 is *Mandatory removal of parts and components for reuse, remanufacturing,
refurbishment*** — nothing to do with recycled content. It was cited here for recycled plastic
until 9 September 2026. The Article 46 warning below records an identical kind of slip: a real
article, genuinely relevant to the project, attached to the wrong obligation.

**Not the passport — a common and invisible mistake:**

| Provision | Subject | Why it gets confused |
|---|---|---|
| **Article 46** | Electronic systems (MOVE-HUB) | Governs exchange of the VIN, registration and roadworthiness status between national vehicle registers, and interconnection to the EU Single Window for Customs. Genuinely relevant to provenance — see also Arts. 36, 37, 39, 40 — but it is **not** the passport obligation |

> **Why this warning exists.** Until 2026-09-08 this repo cited *Article 46* as the legal basis for
> the passport, in five files. The error came from Recital 46, which genuinely *is* about the
> passport, being recorded as an article. Because Article 46 also exists and is also relevant, the
> mistake was invisible. The tell is the verb: **recitals say *should*, operative articles say
> *shall***. Verified against the OJ PDF — Article 13 is headed "Digital Circularity Vehicle
> Passport"; Article 46 is headed "Electronic systems".

The clause that shapes the architecture is the interoperability requirement: the passport must be
*aligned, interoperable and, where possible, integrated with other vehicle related environmental
passports established under Union law*. That is a direct invitation to dock with the battery
passport below — and note the verb is **interoperate**, not absorb.

VINPassport reads that as a **reference**, not a copy: slot 29 `batteryPassportId` points at an EV's
battery passport, and the battery's own claims stay in that passport where they are authoritative.
Restating them here would create two records that can disagree. Whether the panel should also mirror
`batteryStateOfHealthPct` is an open question — see [FIELDS.md](FIELDS.md).

---

## The one it must interoperate with

### Regulation (EU) 2023/1542 — batteries and waste batteries

**[Read the full text on EUR-Lex →](https://eur-lex.europa.eu/eli/reg/2023/1542/oj)**

Establishes the **battery passport** under Article 77, mandatory from **18 February 2027** — five
years ahead of the vehicle passport.

Scope is the battery, **not** the vehicle: EV batteries (any capacity), LMT batteries (any
capacity), and industrial batteries above 2 kWh. An OEM is caught because it places a battery on the
market inside a vehicle, but this regulation gives the *vehicle* no passport.

This matters for VINPassport in two ways. It is the interoperability target named by 2026/1738. And
it is already implemented on the same stack we are building on — [NIGHTPASS](https://github.com/ODATANO/NIGHTPASS)
is a battery passport on NIGHTGATE, which makes a composition demo a realistic Phase 3 goal rather
than an aspiration.

---

## The one that is not the basis — but is a required alignment target

### Regulation (EU) 2024/1781 — Ecodesign for Sustainable Products (ESPR)

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

**But ESPR is not irrelevant — alignment with it is mandatory.** Article 13(1) requires that the
passport *"shall be aligned, interoperable and, where possible, integrated with other vehicle
related environmental passports established under Union law … and with other relevant passports
established pursuant to Regulation (EU) 2024/1781."* Recital 46 names ESPR among the instruments the
passport should be consistent with.

Both statements hold at once, and the distinction is the whole point:

| | ESPR |
|---|---|
| **As legal basis** | ❌ Excluded — Art. 1(2) carves out vehicles |
| **As alignment target** | ✅ Required — Art. 13(1), operative and binding |

So the ESPR Digital Product Passport technical stack and its EN standards are the data model to
build **against**, not an adjacent regime to ignore. When correcting this section, do not resolve
the tension by deleting the exclusion warning above — both halves are load-bearing.

---

## Verification status

Article numbers (46, 29), the repeals, and the OJ publication date were read from the EUR-Lex text
of 2026/1738 directly.

Dates for entry into force, general application, and the 2032 passport deadline come from secondary
legal analysis rather than the operative articles. They are consistent across multiple independent
sources, but **confirm against the final provisions before using them in anything that matters** — a
submission, a partner conversation, or a compliance claim.

Nothing in this repository should be represented as legal advice.
