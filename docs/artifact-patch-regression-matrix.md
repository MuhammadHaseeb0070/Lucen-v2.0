# Artifact Patch Regression Matrix

## Scope
- Artifact update target UX
- Patch parse/apply/persist pipeline
- Version lineage + head/revert semantics
- Refresh + cross-device durability
- Token/cost transparency surfaces
- Non-regression for standard chat/artifact flows

## P0 Integrity Cases
| ID | Scenario | Steps | Expected |
|---|---|---|---|
| P0-1 | Initial artifact save with lineage | Generate new artifact | Row inserts with `id`, `lineage_id=id`, `version_no=1`, `is_head=true` |
| P0-2 | Patched artifact persists as version | Click Update, request change, patch succeeds | New DB row created, prior head demoted, assistant message contains patched `<lucen_artifact ...>` |
| P0-3 | Persistence failure handling | Force `create_patched_artifact_version` failure | Turn marked failed-to-persist; no false success claim |
| P0-4 | Refresh durability | Patch artifact, refresh app | Patched artifact card still available in chat |
| P0-5 | Cross-device durability | Patch on device A, open same chat on device B | Patched artifact appears and can be opened |

## Versioning + Head Semantics
| ID | Scenario | Steps | Expected |
|---|---|---|---|
| V-1 | Head source of truth | Build lineage V1-V3, revert to V1 | UI head uses `is_head`, not max `version_no` |
| V-2 | Selector navigation | Navigate old/new versions | Content updates correctly, `Use this` only shown off-head |
| V-3 | Stale parent rejected | Concurrent patch attempts on same lineage | Older parent patch rejected by RPC stale-parent guard |

## UX and Edge Cases
| ID | Scenario | Steps | Expected |
|---|---|---|---|
| UX-1 | Update target chip visibility | Select Update on artifact | Composer shows update-target chip (attachment-like) |
| UX-2 | Cancel update target | Click chip remove icon | Update binding clears |
| UX-3 | Missing target fallback | Ask “update this artifact” without selecting target | Assistant asks to select target and lists detected artifacts |
| UX-4 | Multi-artifact disambiguation | Multiple artifacts in thread, ask update | No silent patch; disambiguation guidance shown |
| UX-5 | Oversized artifact warning | Bind >40k and >100k artifacts | Soft warning and hard-block behaviors trigger |

## Cost Transparency
| ID | Scenario | Steps | Expected |
|---|---|---|---|
| C-1 | Patch preflight signal | Bind medium/large artifact | UI displays estimated token context |
| C-2 | Cost explanation visibility | Open usage tab | Patch-cost explanation note visible |
| C-3 | Stream non-success charge control | Abort/error stream before useful output | No unnecessary charge for zero-token failed stream |

## Non-Regression
| ID | Scenario | Steps | Expected |
|---|---|---|---|
| NR-1 | Standard chat (no patch) | Send regular prompt | No behavior change |
| NR-2 | Standard artifact generation | Generate artifact without Update mode | Artifact cards/rendering unchanged |
| NR-3 | File/image attachments | Send attachments while update chip exists | Both attachment flow and update target UI coexist |
| NR-4 | Hub listing correctness | Load my/public artifacts | Head versions only shown in lists |
| NR-5 | Side chat | Open side chat and send query | No regression in side chat input/streaming |

## Execution Guidance
- Run all P0 + Versioning suites before merge.
- Run UX + Cost + Non-regression suites on staging.
- Re-run P0-4/P0-5 after any migration/service changes.
