# TODO

- [ ] **Drop the legacy tables.** Migration `0002` backfills `documents` but
  deliberately leaves `chapters`, `draft_states`, `summaries`,
  `projects.bible_content`, and `projects.outline_content` in place as a rollback
  window — `make dev` runs `alembic upgrade head` on every start, so a destructive
  drop bundled into `0002` would have run automatically against the deployed
  database. Once the document UI is confirmed working on Railway, add migration
  `0003` to drop them, and delete the `Chapter`, `DraftState`, and `Summary`
  models from `backend/db_models.py`.

- [ ] **Reconsider the 10-chapter context cap.** `MAX_PRIOR_CHAPTERS`
  (`backend/context.py`) bounds how many preceding chapters get summarized into
  the planner/drafter/checker prompt. Past ~10 chapters a novel loses long-range
  memory; a rolling "story so far" summary would scale better than a window.
