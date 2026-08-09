# ActivityMaxxer — Overview

## What it is

ActivityMaxxer is a web app for inspecting a single running or cycling
activity in detail. You drop in a workout file exported from a GPS watch (a
Garmin `.tcx` or `.fit` export) and the app turns it into a set of
synchronized, scrollable charts — pace/speed, heart rate, cadence, power, and
elevation — all sharing one timeline.

It's built in the spirit of the analysis view you'd find in Garmin Connect or
Intervals.ICU, focused on one thing: letting you look closely at *how* an
activity unfolded, second by second.

## Who it's for

Runners (and the tools they use to coach themselves) who want to look past
the single-number summary — "5k, 25 minutes, avg HR 155" — and see the shape
of the effort: where pace dropped, whether heart rate drifted upward late in
the run, how cadence held up on a climb, or where a pause in GPS coincided
with a water stop.

## What problem it solves

Most watch/phone apps show you a summary card and maybe one chart at a time.
Understanding a run often means correlating *multiple* signals at the same
moment — "my heart rate spiked right as pace dropped and elevation started
climbing" — which is hard to do when each metric lives in its own screen or
tab. This app stacks every available metric as its own chart, vertically
aligned on a shared x-axis, so a single glance across the stack tells the
whole story at that moment in the run.

## Core value it provides

- **One synced view, not four separate ones.** Pace, heart rate, cadence,
  power, and elevation are stacked and share a crosshair — hover anywhere and
  every panel highlights the same instant, with a tooltip showing elapsed
  time, distance, and each metric's value together.
- **Time or distance, your choice.** Switch the shared x-axis between
  elapsed time and distance run without losing your place.
- **Zoom in on the interesting part.** Drag to select a range (e.g. the final
  kilometer, or a hard interval) and every chart zooms to that window
  together, so you can inspect a specific stretch of the run in detail.
- **Choose what matters to you.** Toggle any metric's chart on or off, and
  independently show max / average / median reference lines per metric — so
  you can, say, see your average pace on the pace chart without cluttering
  the heart-rate chart with lines you don't care about.
- **Trustworthy numbers.** Average pace is computed correctly (total moving
  time ÷ total distance) rather than a naive average of instantaneous pace
  values, which is a common source of numbers that quietly disagree with
  what your watch already told you. This has been cross-checked against a
  real Garmin export and matches Garmin's own reported average pace to the
  second.
- **No account, no upload to a server, no setup.** Drop a file and the charts
  render immediately in the browser — the file is parsed on your own machine
  and never uploaded anywhere.
- **On a phone, connect Intervals.icu or Strava instead.** A watch file isn't
  something you can browse to on a phone, so you can connect an account once
  and pick an activity from your real history. Both are off unless you turn
  them on, and either can be disconnected in one press.
  - **Intervals.icu** — paste an API key. Your browser fetches from
    Intervals.icu **directly**; nothing about it passes through this app's
    server. It downloads the *original* file your watch uploaded.
  - **Strava** — approve read access on Strava's own page. This one **does**
    go through this app's server, because Strava requires a secret that cannot
    live in a web page. The server passes requests through and stores nothing.
    Disconnect revokes the access at Strava, not just locally.

## How it works, in brief

1. **Load an activity** — drag and drop a `.tcx`, `.fit` or `.gpx` file
   exported from a Garmin device, or pick one from a connected Intervals.icu
   account (which downloads the *original* file your watch uploaded) or a
   connected Strava account (which reads Strava's recorded data streams).
2. **The app parses and normalizes it** — extracting time, distance, pace,
   heart rate, cadence, power, and elevation into one consistent internal
   format, deriving values (like pace) that aren't stored directly, and
   detecting pauses so they don't distort the charts.
3. **Charts render, stacked and synced** — one chart per metric the file
   actually contains (a file with no power data simply shows no power
   chart), all sharing the same x-axis and hover crosshair.
4. **You explore** — toggle metrics, switch time/distance, add stat
   reference lines, and brush-zoom into the parts of the activity you care about.

## Current scope

The app currently focuses on **running and cycling**, **metric units only**,
and a **single activity at a time**, with no accounts, saved history, or
persistence — each session starts fresh with a new file. The design
anticipates future growth (swimming, comparing multiple activities, lap
breakdowns) without those features being built yet; see
[ARCHITECTURE.md](ARCHITECTURE.md) for the technical design and roadmap,
and [README.md](../README.md) for how to run the project.
