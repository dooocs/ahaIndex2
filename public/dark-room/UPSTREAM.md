# A Dark Room / 小黑屋

Original: Michael Townsend and contributors, doublespeak games.
Source: https://github.com/doublespeakgames/adarkroom
Pinned upstream commit: 1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7
License: Mozilla Public License 2.0, see LICENSE.md. Bundled library notices are retained.

AmazingIndex adaptations (2026-11-02): default Simplified Chinese, local jQuery,
remove upstream analytics, validate language selection, isolate save/language keys,
localized mobile warning with opt-in continuation, and source/license/home links.
Game logic and translations otherwise remain upstream. All covered modifications
are distributed as readable source under MPL-2.0 in this directory.

Trial URL: /dark-room (no navigation tab). The Astro shell reuses the site masthead;
the original game runs in app.html on the same origin to preserve existing saves.
Site utility links and author/license credits live in the collapsed settings menu. Saves are browser-local, with the
original import/export menu. Restart only removes amazingindex.dark-room.* keys.
