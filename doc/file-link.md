# File link

A **file link** opens ActivityMaxxer with an activity file already loaded:

```
https://activitymaxxer.com/#f=<base64url(file bytes)>
```

It carries the original file. A **share link** (`#a=`) carries a lossy copy that ActivityMaxxer encoded itself. The first sender is Træningsdagbog (`Mcklmo/training-plan`), which opens a Garmin activity's original file in Safari, but the format is not Garmin-specific.

Decided in [training-plan#20](https://github.com/Mcklmo/training-plan/issues/20). Research: [activitymaxxer-handoff.md](https://github.com/Mcklmo/training-plan/blob/research/activitymaxxer-handoff/research/activitymaxxer-handoff.md).

## Format

- `#f=` followed by the file's bytes as base64url (no padding; `lib/base64url.js`).
- The bytes can be anything the file loader opens: FIT, TCX or GPX, either plain, gzipped or in a ZIP (see below). The sender doesn't say which; the loader sniffs it.
- No version character and no other parameters. The file's own magic bytes describe it.
- The payload lives in the fragment, so it is never sent to the server and no edge URL limit applies. Measured on iOS 18.3: an 8M-character fragment arrives intact through `UIApplication.open` and `SFSafariViewController`. A 30-min Garmin FIT is about 112K characters, a 6-h ride about 1.3M. (`xcrun simctl openurl` truncates at about 2,048 characters, so don't test with it.)

## Receiving

A hook beside `useSharedActivityFromUrl`, mounted once in `AppShell`, on page load:

1. If `location.hash` doesn't start with `#f=`, do nothing (one string comparison).
2. Remove the hash with `history.replaceState` straight away, before decoding. A 100K+ character GPS track must not stay in the address bar, history or bookmarks. Reloading shows the empty drop zone.
3. Decode the base64url into bytes.
4. Call `loadRef({ type: 'file', file: new File([bytes], 'activity') })`. With no extension, the registry goes through `sniffFileRef`: inflate, detect the format, parse.

## ZIP support in the file loader

Garmin's API returns an activity's original file as a ZIP, and so does Garmin Connect's "Export original". The file loader learns to open ZIPs. This helps files dropped by hand as well as file links.

- Sniff the ZIP local-file-header magic (`PK\x03\x04`) beside the gzip check in `fileFormat.js`.
- Take the first entry whose inflated bytes `detectActivityFormat` recognises. Support compression method 0 (stored) and 8 (deflate, via `DecompressionStream('deflate-raw')`). No new dependency.
- Read entry sizes and offsets from the central directory, not the local headers. Garmin's ZIPs set the data-descriptor flag (bit 3), so their local headers say size 0. Each holds one deflated `<activityId>_ACTIVITY.fit`.
- A ZIP with no recognisable entry gets the same error as any unparseable file.

## Size cap

Gunzip and unzip in the file loader both stop at **64 MiB** of inflated output and fail with the decode error below, following `gunzipCapped` in `shareCodec.js`. A crafted link is an easy way to deliver a decompression bomb. There is no separate cap on the length of the payload.

## When loading fails

- **Bad base64url, or over the size cap:** the error screen with "This link's activity couldn't be read."
- **Decodes, but isn't a parseable activity:** the same parse error a dropped file gets.
- **No "Try again"** for either: repeating the same bytes repeats the failure. `ErrorState` hides the button when it gets no `onRetry`.

## Out of scope

- **Worker:** no change. The file never reaches the server.
- **Privacy text:** no change. "Your files never leave your browser" stays true.
- **Activity name:** not carried. The chart gets ActivityMaxxer's usual title.

## Rollout

Deploy ActivityMaxxer with this before the sender starts using it. Without it, a file link just shows the empty drop zone. Test the real-device path once (iPhone → Safari) as part of implementation.
