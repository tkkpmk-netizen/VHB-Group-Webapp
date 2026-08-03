# Attribute-policy enforcement inventory

T1 selects typed commercial policies plus explicit datasets. This inventory is
the implementation checklist for T3/T4 and later sensitive paths. The policy
call belongs in the owning service before query construction or serialization;
routers and frontend visibility are not enforcement.

| Path | Policy operation | Required enforcement |
|---|---|---|
| Typed command create/update/transition | `write` | Before loading mutation inputs; deny attributes omitted from authorized conflict detail |
| Detail/list query | `read` | Before select/projection; omit denied schema and values |
| Search and result snippet | `search`, then `read` | Before search condition; snippet uses only authorized attributes |
| Filter | `filter` | Before SQL predicate construction; no hidden-match count |
| Sort | `sort` | Before order expression construction; no ordering inference |
| Group | `group` | Before group expression; no hidden keys or counts |
| Aggregate/KPI | `aggregate` | Authorize every dependency before SQL; output inherits highest sensitivity |
| Formula/rollup | `formula` / `rollup` | Authorize dependency graph before evaluation; fail closed on cycles/unknown dependencies |
| Relation picker/search | `relation`, `search`, `read` | Authorize link plus target display/search attributes |
| Database/export artifact | `export` | Build explicit authorized projection before worker payload; validate again before artifact promotion |
| Purpose-built report | `report` | Explicit typed dataset and metric definition; coverage/freshness metadata cannot reveal denied cohorts |
| Dashboard | `dashboard` | Authorize every widget dependency before query and cache key construction |
| Notification | `notification` | Authorize trigger dependencies and recipient projection; never copy denied values into jobs |
| Projection/read model | `projection` | Apply at source event/read-model construction; policy version accompanies projection |
| Public site binding | `public_binding` | Explicit declassification only; ordinary user grants never imply public access |
| File preview | `file_preview` | Authorize metadata and content before provider download |
| File download/export | `file_download` | Separate decision from preview; audit successful protected downloads |
| Change/conflict/history | `read` | Generate authorized delta from canonical state; never redact after building full response |

Current status:

- `PolicyDecisionService`, typed adapter, and unified spike exist.
- Cross-path prototypes cover query-reference denial, export omission, derived
  sensitivity, relation search, and separate file preview/download decisions.
- No protected dynamic Field is supported.
- No T3/T4 sensitive schema is active yet, so no router is permitted to claim
  attribute-policy coverage merely by hiding frontend fields.
