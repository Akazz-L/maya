# TODO

- [ ] **Wire up `save_summary` so previous-chapter context actually works.**
  `save_summary()` (`backend/storage.py:36`) is never called by the app, so
  `load_summaries()` always returns `[]` and the planner/drafter/checker treat
  every chapter as the first. Add a step that generates a chapter summary and
  calls `save_summary(chapter_number, text)` on accept (`accept_chapter`,
  `backend/main.py:181`), so `load_summaries(chapter_number)` returns real
  prior-chapter context.
