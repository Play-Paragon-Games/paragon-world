# Paragon World

Live, read-only pages for Paragon Games. `board.html` is the board view (Phase 4) and `index.html` the plain
fallback page (Phase 3); both share `world.js` (reference data, compute, live loop). GitHub Pages serves them and they poll the
`world` Supabase Edge Function (source in `supabase/functions/world/`) every 15 seconds while the tab is visible.

Both pages need a key in the URL fragment: `https://play-paragon-games.github.io/paragon-world/board.html#k=<WORLD_VIEW_KEY>`.
Without the right key the data endpoint returns 404. No data or key is stored in this repository.

Source of truth for the event format and entities: the Paragon World Map doc.
