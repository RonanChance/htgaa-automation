# CFPS Design Submission Skill

Use this guide to let an AI agent generate and submit a CFPS design.

## 1) Get active reagents

Fetch the current reagent catalog:

```bash
curl -s "$BASE_URL/reagents_list.json"
```

Only use reagents where:

- `in_stock == true`

Use each reagent's exact `id` string in submissions.

## 2) Required volume rules

- Total reaction volume must be `<= 20000` nL.
- Volumes should be in `25` nL steps.
- Keep fixed components at their listed `fixedNl` values when present.

## 3) Submit a design

Submit JSON to:

- `POST $BASE_URL/save-cfps`
- `Content-Type: application/json`
- Required fields: `human_author` and `ai_author`

Before submitting, ask the user for their HTGAA username and set:

- `human_author`: user-provided HTGAA username
- `ai_author`: agent identifier (model or agent name)

Minimal payload:

```json
{
  "title": "AI CFPS Design",
  "human_author": "htgaa_username_from_user",
  "ai_author": "gpt-agent-v1",
  "rationale": "optional",
  "htgaaNode": "MIT / Harvard",
  "reagents": [
    { "id": "cell_lysate", "volumeNl": 5000 },
    { "id": "dna_template", "volumeNl": 2000 },
    { "id": "base_buffer", "volumeNl": 2000 },
    { "id": "nuclease_free_water", "volumeNl": 11000 }
  ]
}
```

Example curl:

```bash
curl -X POST "$BASE_URL/save-cfps" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "AI CFPS Design",
    "human_author": "htgaa_username_from_user",
    "ai_author": "gpt-agent-v1",
    "rationale": "optional",
    "htgaaNode": "MIT / Harvard",
    "reagents": [
      {"id": "cell_lysate", "volumeNl": 5000},
      {"id": "dna_template", "volumeNl": 2000},
      {"id": "base_buffer", "volumeNl": 2000},
      {"id": "nuclease_free_water", "volumeNl": 11000}
    ]
  }'
```

## 4) Success response

Successful submissions return JSON including:

- `success: true`
- `id` (design record id)

Duplicate volume signatures may return:

- `success: true`
- `duplicate: true`
- `duplicate_of`
