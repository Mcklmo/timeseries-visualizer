# FIT parsing implementation — progress

Implementing the plan at `~/.claude/plans/the-run-in-fixtures-floating-mountain.md`
(add FIT file parsing to recover Stryd running power).

**Status: implementation + automated verification done. Only the manual
in-browser check is outstanding, left to the user by request.**

## Steps

- [x] `src/data/fit/parseFit.js`
- [x] `src/data/fit/FitActivitySource.js`
- [x] `src/data/fit/parseFit.test.js` (11 tests, synthetic FIT files built via `@garmin/fitsdk`'s `Encoder`)
- [x] `src/data/fit/FitActivitySource.realGarminFixture.test.js` (5 tests against the real fixture)
- [x] `src/data/ActivitySource.js` — extended `kind` JSDoc union with `'fit'`
- [x] `src/App.jsx` — instantiates `FitActivitySource`, dispatches by file extension
- [x] `src/ui/FileDropZone.jsx` — accepts `.tcx,.fit`, label copy updated
- [x] `src/ui/FileDropZone.test.jsx` — accept-attribute assertion updated
- [x] `doc/ARCHITECTURE.md` — §0 progress entry, §4 scaffold, §5 kind union, §8 FIT parsing notes
- [x] `package.json`/`package-lock.json` — `@garmin/fitsdk@^21.212.0`
- [x] Scratch inspection scripts removed from repo root
- [x] `npm test` — 27 files / 183 tests green
- [x] `npm run build` — clean; confirmed `@garmin/fitsdk` lands only in the
      dynamically-imported chunk (`dist/assets/src-*.js`), not the eager
      main bundle (`grep` for `garmin`/`fitsdk` in `dist/assets/index-*.js`
      only matches the unrelated TCX XML namespace string)
- [x] `npm run lint` — one pre-existing error in `src/stats/useMetricStats.js`
      (`react-hooks/exhaustive-deps` rule not found — an eslint-plugin
      config/version issue), confirmed present on the prior commit
      (`6f90147`) too, unrelated to this change. Not fixed — out of scope.
- [ ] **Manual browser check (left for the user, per their request):** run
      `npm run dev`, drop `fixtures/23870166877_ACTIVITY.fit`, confirm a
      Power panel renders and toggles in `ControlPanel`; then drop
      `fixtures/activity_23870166877.tcx` to confirm `.tcx` still routes
      through the unchanged TCX path.

Delete this file once the manual check above is done.
