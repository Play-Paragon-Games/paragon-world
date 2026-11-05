# Paragon World

Live, read-only page for Paragon Games (Phase 3). `index.html` is served by GitHub Pages and polls the
`world` Supabase Edge Function (source in `supabase/functions/world/`) every 15 seconds while the tab is visible.

The page needs a key in the URL fragment: `https://play-paragon-games.github.io/paragon-world/#k=<WORLD_VIEW_KEY>`.
Without the right key the data endpoint returns 404. No data or key is stored in this repository.

Source of truth for the event format and entities: the Paragon World Map doc.
