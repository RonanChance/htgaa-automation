# tools/

Developer tooling that is **not** part of the SvelteKit build. Unlike `scripts/`
(gitignored), everything here is committed so it can be shared and, later, wired
into CI.

## CFPS ⇆ autonomous-cfps sync

Keeps the CFPS designer in step with the `CFPSReagentList` pydantic model in the
private repo [`ginkgobioworks/autonomous-cfps`](https://github.com/ginkgobioworks/autonomous-cfps).
The model is the single source of truth for the reagent field names, the fixed
volumes / 25 nL grid / 20 µL total, the template rules, **and** the per-reagent
costs.

### Pieces

- **`extract_cfps_spec.py`** — imports the pydantic model (introspection, no
  source-parsing) and prints a canonical spec as JSON. Must run inside the
  autonomous-cfps environment.
- **`sync-cfps.mjs`** — orchestrator. Runs the extractor, writes the committed
  `src/lib/cfpsReagentSpec.generated.json` (the contract the app validates
  against — costs are stripped, it ships in the browser bundle), then pushes the per-reagent costs into the **live** PocketBase
  `cfps_reagent_groups` record so cost changes are near-instant with no rebuild.

### Two update paths, on purpose

| What | Where it lives | How it updates | Why |
| --- | --- | --- | --- |
| Costs | PocketBase (`costPerMl`) | `--apply` writes live PB | instant, no redeploy |
| Contract (fields, constants, template rules) | committed `cfpsReagentSpec.generated.json` | commit + deploy | validation logic stays reviewable |

### Usage

```bash
# dry run: regenerate the JSON and print the PB cost diff (writes nothing to PB)
npm run sync:cfps

# also push the cost changes to live PocketBase (backs up the record first)
npm run sync:cfps:apply

# only regenerate the committed contract JSON, skip PocketBase entirely
node tools/sync-cfps.mjs --no-pb
```

Requirements: [`uv`](https://docs.astral.sh/uv/) on PATH, an autonomous-cfps
checkout (defaults to `../autonomous-cfps`, override with `AUTONOMOUS_CFPS_PATH`),
and `PB_EMAIL` / `PB_PASSWORD` (read from the environment or the repo `.env`).

After running, review the diff to `src/lib/cfpsReagentSpec.generated.json` and
commit it if the contract changed. PB backups are written to
`scripts/pb-backups/` (gitignored).

### CI later

The same `npm run sync:cfps` is CI-ready: a scheduled GitHub Action can check out
autonomous-cfps (read-only fine-grained PAT or GitHub App token), `uv sync` it,
run the script with `AUTONOMOUS_CFPS_PATH` set, apply costs to PB, and open a PR
when `cfpsReagentSpec.generated.json` changes.
