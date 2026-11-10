# Landscape

Compiled on 2026-11-10 from web searches and a few directly read pages. **Verified** means the page was read directly; **Reported** means it appeared in a search result summary and was not independently confirmed; **Assumption** means it is a working belief about user behavior, not a researched fact. Pricing and availability were not checked.

## What exists

| Kind                                      | Examples                                                                                                                           | What it does                                                                                                                                                           | Evidence level                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| General inspection apps                   | SafetyCulture (its help center now serves under the name Mitti)                                                                    | Mobile checklists with photos and reports. Its help page states that offline use is supported only in the mobile app, and that notifications are not supported offline | Verified (help page read 2026-11-10) |
| Series-run inspection apps                | A pre-race inspection and impound app built for specific series                                                                    | Replaces paper forms for technical officials of one series                                                                                                             | Reported                             |
| Vendor tools tied to hardware             | ECU software checks, scrutineering data loggers                                                                                    | Verify one component or a data stream                                                                                                                                  | Reported                             |
| National federation systems               | A Spanish system whose participant guide lists pre-event technical checks, sealing, weighing, and an electronic technical passport | Run by or for the sanctioning body                                                                                                                                     | Reported                             |
| Spreadsheets, paper forms, photos in chat | The team's own checklists, regulations as PDFs                                                                                     | Whatever the team builds                                                                                                                                               | Assumption                           |

A Spanish-language search for software used in technical verification of Argentine single-make categories returned no such product. It did return Argentine regulations that refer to a form (_planilla_) handed to participants for pre-event verification, without saying whether it is digital. Absence from search results is not proof that no tool exists.

## Where SpecGarage differs

These are design intentions, not claims about other products.

| Need                                                                                         | General checklist apps                     | Official-body systems            | SpecGarage                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------- | ----------------------------------------------------------------- |
| Rules tied to a specific regulation edition, immutable once imported                         | Template versions, not regulation editions | Internal to the body             | Core invariant: editions are hashed and pinned to each inspection |
| Every result traceable to document, article, and page                                        | Not a concept                              | Not exposed to teams             | Required for every requirement                                    |
| Evidence gates the verdict (no "pass" without the required measurement conditions and files) | Free-form fields                           | Not applicable                   | Enforced by the engine                                            |
| Works fully offline on a laptop, no account                                                  | Mobile-first with sync                     | Online                           | Standalone, no network                                            |
| No personal technical passports or inspector identity                                        | Accounts and user identity                 | Often identity-based             | Internal vehicle codes and a station label only                   |
| Reports conflicts and ambiguity instead of resolving them                                    | Not applicable                             | The technical commission decides | Surfaces them; never interprets                                   |
| Used by the team preparing the car                                                           | Generic                                    | Used by the sanctioning body     | Team-side preparation, explicitly not official inspection         |

## Positioning

SpecGarage is a team-side preparation and documentation tool for category regulations, built around traceability and offline use. It does not compete with official scrutineering and does not try to be a general inspection platform. Its main risk is that the value depends on how well a team can turn regulation text into structured requirements, which is why the rulepack format and the later editor matter more than the MVP's single screen.
