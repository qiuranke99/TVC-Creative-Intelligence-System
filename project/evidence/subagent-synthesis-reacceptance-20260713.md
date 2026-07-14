# TCIS v3 Current-Snapshot Reacceptance Synthesis

Date: 2026-07-13  
Decision owner: main agent

## Allocation And Verdicts

| Workstream | Independent closure target | Candidate finding | Main-agent disposition |
|---|---|---|---|
| Professional architecture | Doctrine, authority/timing and document truth | Doctrine sound; P11/P14 projection and L-level taxonomy drifted | Accepted and repaired |
| Capability/package integrity | Canonical projection, cleanup containment and standalone manifest | Canonical registry could be deleted by stale generated manifest; manifest allowed duplicate/traversal entries | Accepted and repaired |
| State lifecycle | WAL, lock ownership, retained revisions and append API | Terminal WAL stayed on read path; PID reuse lock; quadratic storage; unsafe unused append API | Accepted and repaired |
| Canonical state | Cross-locale deterministic hashes | Implicit locale collation changed state hashes | Accepted and repaired |
| Runtime validation | Behavior versus structural self-report | Empty tests and broken store behavior could appear green | Accepted and repaired |
| Media QA | Supported media structures and selected evidence | Seven false accepts and two false rejects across PNG/JPEG/GIF/WebP/WAV/MP4/inspector identity | Accepted; all nine corpus cases repaired |
| CLI/state QA | Persisted interaction and lock invariants | Signoff mismatch, successful no-op feedback and contradictory locked artifact fields | Accepted and repaired |
| Package-status review | Current truth and prior receipt | 2026-07-11 PASS labels were historical during active reacceptance | Accepted; current receipt/docs replaced |

Three initial read-only audit assignments returned no evidence because their prompts were rejected by the execution service. They were not counted as findings and were replaced by narrower release-QA assignments. No result was accepted on agent authority alone.

## Rejected Approaches

- Reuse of the 2026-07-11 receipt: rejected because current bytes and timestamps had changed.
- Existing tests as the complete oracle: rejected by media, validation, WAL and CLI counterexamples.
- Full rebuild: rejected after defects were shown to have coherent root boundaries and the repaired system passed complete regression.
- Treat structural media validation as rendered-quality proof: rejected; independent actual-media inspection remains mandatory.
- Infer L4-L6 evidence locally: rejected as impossible without real clients, rights, vendors, production, blind review and results.

## Post-Repair Evidence

- Full suite after the 2026-07-14 public-package boundary addition: 121/121 PASS.
- Runtime validation: 5/5 PASS including isolated store behavior.
- Fixtures: 73/73 PASS, no skip or unmapped item.
- Synthetic projects: 9/9 PASS.
- Independent CLI/state recheck: empty feedback, durable conflict and exact lock reload all PASS.
- Media counterexample corpus: all nine expected accept/reject outcomes PASS.
- Static standalone checks: 21/21 PASS before manifest freeze.

The final package verdict is owned by the main agent and is valid only with the final manifest-bound verifier receipt.
