// The content model for the prerendered landing pages. Pure data — no fs, no
// DOM — so pages.test.mjs can assert the rules that decide whether any of this
// ranks (see SEO plan, Phase 3) instead of leaving them to review.
//
// The rule that matters: each page needs ~400+ words of genuinely distinct
// substance. Five near-identical pages differing only in a filename are
// doorway pages, get algorithmically filtered, and leave the site worse off
// than one good page would. pages.test.mjs enforces the word count; only a
// human can enforce "distinct", so keep the export walkthroughs and the
// format-specific mechanics as the thing that separates them.
//
// Export steps below were verified against vendor documentation on
// 2026-08-08 (Garmin Connect web, COROS Help Center, Wahoo Fitness Support).
// A confidently wrong walkthrough produces bounces, which is exactly the
// signal these pages exist to avoid — recheck before editing, don't guess.

/** Canonical origin. Overridable for a staging build; never for a real deploy. */
export const SITE_URL = (process.env.SITE_URL || 'https://activitymaxxer.com').replace(/\/$/, '')

export const BRAND = 'ActivityMaxxer'

/**
 * @typedef {object} Page
 * @property {string} slug            '' is the app shell itself
 * @property {string} title           <title> and og:title
 * @property {string} description     meta description and og:description
 * @property {boolean} [sitemapOnly]  true for '/', whose HTML Vite already emits
 * @property {string} [heading]       <h1>
 * @property {string} [intro]         lead paragraph, HTML
 * @property {string} [body]          the page itself, HTML
 * @property {{q: string, a: string}[]} [faq]  plain text only — it is reused verbatim
 *                                             as FAQPage JSON-LD, which takes no markup
 */

/** @type {Page[]} */
export const pages = [
  {
    // The app shell. Vite emits dist/index.html from index.html, head metadata
    // and all — this entry exists so the sitemap covers the home page without
    // a second list to keep in sync.
    slug: '',
    sitemapOnly: true,
    title: `${BRAND} — FIT, TCX & GPX File Viewer in Your Browser`,
    description:
      'Open a .fit, .tcx or .gpx file and see pace, heart rate, cadence, power and elevation as stacked, time-synced charts. Your file never leaves your browser.',
  },

  {
    slug: 'about',
    title: `About ${BRAND} — Your Files Never Leave Your Browser`,
    description:
      'ActivityMaxxer parses .fit, .tcx and .gpx files in your own browser. No upload, no account, no analytics. Here is exactly what reaches the network, and when.',
    heading: 'About ActivityMaxxer',
    intro:
      'ActivityMaxxer runs entirely in your browser. Your files are never sent to a server — they stay on your machine, so a file you open here never leaves your device. There are no cookies, no tracking, and no analytics. This is a non-profit project: nothing is recorded, collected, or sold.',
    body: `
      <h2>What happens when you open a file</h2>
      <p>
        Dropping a file on this site does not upload it. The browser hands the page a reference
        to the file you picked, JavaScript running in your own tab reads its bytes, parses them,
        and builds the charts from what it finds. Nothing in that sequence involves a request to
        this site's server. That is a statement about the file path, and it holds without
        qualification: opening a file is not a thing this site's server ever learns about.
      </p>
      <p>
        The practical consequences are worth spelling out, because "we don't store your data" is
        a claim every competitor makes and this is a different claim. There is no upload progress
        bar because there is no upload. There is no file size limit imposed by a server, because
        no server sees the file. Closing the tab discards the activity completely — there is
        nothing to delete, because nothing was ever written anywhere. And once the page has
        loaded, the file path keeps working with the network disconnected.
      </p>

      <h2>What does reach the network, and when</h2>
      <p>
        Three things do, and only when you ask them to. Being precise about them is the point: a
        reader who uses one of these features should not feel that the paragraph above misled
        them. Two of the three are opt-in ways to reach your own training history, and they do
        not work the same way as each other — so they are described separately rather than
        summarised together.
      </p>
      <ul>
        <li>
          <strong>The feedback link</strong> at the bottom of the page posts what you write to
          GitHub as a public issue. It is guarded by a Cloudflare Turnstile challenge, which is
          the one third-party script on the site and loads only after you open the feedback
          dialog — not on page load.
        </li>
        <li>
          <strong>Connecting an intervals.icu account</strong> makes your browser fetch your
          activities from intervals.icu <strong>directly</strong>. The API key you paste and the
          files it downloads never pass through this app's server. The key is stored in your
          browser's local storage so you do not have to paste it again; one "Disconnect" removes
          it. This exists mainly for phones, where a watch file is not something you can browse
          to in a file picker.
        </li>
        <li>
          <strong>Connecting a Strava account</strong> is the one route that
          <strong>does</strong> go through this site's server, and pretending otherwise would be
          the dishonest thing to do here. Strava's login requires a secret that cannot be kept
          in a web page, so requests travel from your browser to this site's server and on to
          Strava. That server is deliberately forgetful: it holds the secret, passes your
          request along, hands Strava's answer straight back, and keeps no database, no log of
          what you opened and no copy of anything it carried. What it costs you is real and
          worth naming — your Strava token travels through it in a request header, and your
          activity data travels back through it — over an encrypted connection to the same
          address as the page. Approval happens on Strava's own site, read-only, and pressing
          "Disconnect" revokes it at Strava rather than merely forgetting it here.
        </li>
      </ul>
      <p>
        Nothing else. No analytics script, no cookies, no accounts, no session, no server-side
        log of what you opened. The site's search performance is measured through Google Search
        Console, which reports from Google's own crawl and serving logs and puts no code on the
        page — so it tells the operator which search queries showed the site, and nothing at all
        about you.
      </p>

      <h2>What it reads</h2>
      <p>
        It reads <strong>TCX</strong>, <strong>FIT</strong> and <strong>GPX</strong> files, so
        anything from a training watch to a satellite messenger or a camera's location log can be
        charted. A GPX track carrying only position and elevation still gets speed and elevation
        panels — both are reconstructed from the positions themselves. Panels appear only for the
        channels a file actually contains: a ride recorded without a power meter simply shows no
        power chart rather than an empty one.
      </p>

      <h2>Why it exists</h2>
      <p>
        I built ActivityMaxxer as a mostly satisfied user of Garmin Connect and
        <a href="https://www.intervals.icu" target="_blank" rel="noreferrer noopener">Intervals.icu</a>
        who found a few features missing from both. In particular, I wanted advanced statistics —
        such as average, minimum, and maximum reference lines — directly on each chart, and all
        charts stacked vertically on a shared timeline.
      </p>
      <p>
        That stacking is the whole idea. Understanding a run usually means correlating several
        signals at the same instant: heart rate drifting upward while pace holds, cadence
        collapsing on a climb, a pause that lines up with a road crossing. Most apps show one
        chart at a time, so you carry that correlation in your head between tabs. Here every
        available metric is its own panel, vertically aligned on one x-axis — switchable between
        elapsed time and distance — with a shared crosshair, so one glance down the stack tells
        you what every metric was doing at that moment.
      </p>
    `,
  },

  {
    slug: 'fit-file-viewer',
    title: 'FIT File Viewer — Open a Garmin .FIT File in Your Browser',
    description:
      'Open a .fit file from a Garmin, Wahoo or COROS watch and chart pace, heart rate, cadence, power and elevation. No upload, no account — it parses in your browser.',
    heading: 'FIT file viewer',
    intro:
      'Drop a .fit file onto ActivityMaxxer and every channel it contains becomes its own chart, stacked on one shared timeline. The file is parsed in your browser and never uploaded.',
    body: `
      <h2>What is in a FIT file</h2>
      <p>
        FIT — Flexible and Interoperable Data Transfer — is the binary format the ANT+ ecosystem
        settled on and the one your watch or bike computer actually records to. Unlike TCX and
        GPX it is not text: opening one in a text editor shows nothing useful, which is why a
        viewer is the only practical way to look inside a file you have exported.
      </p>
      <p>
        Internally a FIT file is a stream of typed messages rather than a list of points. Most of
        it is <em>record</em> messages — one per sample, typically one per second — each carrying
        whichever channels were connected at that instant: timestamp, position, distance,
        altitude, heart rate, cadence, speed, power, temperature. Around those sit <em>lap</em>
        and <em>session</em> messages holding the summary figures your watch showed you, and
        optional <em>developer fields</em>, which is how third-party sensors such as running power
        pods record their own metrics into the same file.
      </p>
      <p>
        This is why FIT is the format to keep when you have a choice. It is the richest of the
        three: a TCX export of the same activity drops anything Garmin's XML schema has no element
        for, and a GPX export keeps essentially only position, elevation and time.
      </p>

      <h2>Which fields get charted</h2>
      <p>
        ActivityMaxxer reads the record messages and builds one panel per channel it finds — pace
        or speed, heart rate, cadence, power, and elevation. Panels appear only for data that is
        genuinely present, so a ride recorded without a power meter shows no power chart rather
        than a flat line at zero. Running activities are charted as pace in minutes per kilometre;
        rides and generic tracks are charted as speed. Each panel can carry its own average,
        minimum and maximum reference lines, and the whole stack shares one x-axis that switches
        between elapsed time and distance.
      </p>
      <p>
        Pauses are detected rather than averaged over, so a stop at a traffic light does not drag
        your average pace down, and the reported average matches what your watch told you.
      </p>

      <h2>Exporting a .fit file from your device</h2>
      <p>These are the current export paths for the three most common ecosystems.</p>
      <h3>Garmin</h3>
      <p>
        Use Garmin Connect on the web — the mobile app has no export option. Open the activity,
        click the gear icon at the top right of the activity page, and choose
        <strong>Export Original</strong>. That downloads a <em>ZIP archive</em> containing the
        .fit file, not the .fit file itself, so unzip it before dropping it here. The same menu
        offers Export to TCX and Export to GPX if you want one of the text formats instead.
      </p>
      <h3>COROS</h3>
      <p>
        In the COROS app, open the activity from the Activities list, tap the three dots at the
        top right, choose <strong>Export Data</strong>, and pick <strong>.FIT</strong>. The app
        then hands the file to the usual share sheet, so AirDrop or email it to wherever you want
        to open it.
      </p>
      <h3>Wahoo</h3>
      <p>
        Two options. In the Wahoo app, the three-dot menu on an activity card leads to Sharing,
        which sends the .fit to a connected third-party service. To get the raw file directly,
        connect an ELEMNT, BOLT or ROAM to a computer over USB — it mounts as an external drive —
        and copy the file you want out of its <em>Activities</em> folder.
      </p>

      <h2>On a phone</h2>
      <p>
        A .fit file is awkward to reach from a phone's file picker even when it is technically on
        the device. If you use intervals.icu, connecting it here is usually faster: your browser
        fetches the original uploaded file from intervals.icu directly, and the chart comes up
        without a download step.
      </p>
    `,
    faq: [
      {
        q: 'Is my FIT file uploaded to a server?',
        a: 'No. The file is read and parsed by JavaScript running in your own browser tab. It is never transmitted, there is no account, and closing the tab discards it.',
      },
      {
        q: 'Why did Garmin Connect give me a .zip instead of a .fit?',
        a: 'Garmin Connect wraps the Export Original download in a ZIP archive. Unzip it and drop the .fit file inside onto the page.',
      },
      {
        q: 'Why is there no power chart for my ride?',
        a: 'A panel is only drawn for a channel that is actually present in the file. If the ride was recorded without a power meter paired, the FIT file contains no power records and no power panel is shown.',
      },
      {
        q: 'Should I export FIT, TCX or GPX?',
        a: 'FIT, whenever the choice is offered. It is the file your device recorded and keeps every channel, including power and any third-party developer fields. TCX drops what its XML schema has no element for, and GPX keeps little more than position, elevation and time.',
      },
    ],
  },

  {
    slug: 'tcx-file-viewer',
    title: 'TCX File Viewer — Open a Garmin .TCX File Online',
    description:
      'Open a .tcx export and chart pace, heart rate, cadence and elevation on one shared timeline. Parsed in your browser, so the file is never uploaded anywhere.',
    heading: 'TCX file viewer',
    intro:
      'Drop a .tcx file onto ActivityMaxxer to chart it. TCX is the XML format Garmin Connect exports on request, and it carries enough per-point detail to plot a full activity.',
    body: `
      <h2>What a TCX file contains</h2>
      <p>
        TCX stands for Training Center XML — the format Garmin built for its old Training Center
        desktop software, and still what Garmin Connect produces when you ask for an XML export.
        Being XML, it is plain text: you can open one in any editor and read it, which makes it
        the easiest of the three formats to sanity-check by eye when something looks wrong.
      </p>
      <p>
        The structure is an Activity containing Laps, each containing a Track of Trackpoints. A
        Trackpoint holds a Time, usually a Position with latitude and longitude, an
        AltitudeMeters, a DistanceMeters, and a HeartRateBpm. Cadence, instantaneous speed and
        power live in a separate extensions namespace that Garmin bolted on afterwards — which is
        why some tools that claim TCX support show you heart rate but silently ignore cadence.
      </p>
      <p>
        One property makes TCX genuinely useful rather than merely adequate: it stores
        <strong>DistanceMeters explicitly, per point</strong>, as measured by the device. Distance
        does not have to be reconstructed from coordinates, so the distance x-axis matches what
        your watch reported instead of drifting from it.
      </p>

      <h2>TCX versus FIT</h2>
      <p>
        They are not competing formats so much as different stages. FIT is what the device
        records; TCX is a conversion of it. Every TCX file therefore started life as a FIT file,
        and the conversion is lossy — anything Garmin's schema has no element for is dropped,
        including developer fields from third-party sensors and most of the per-lap detail.
      </p>
      <p>
        Being text also makes TCX several times larger than the FIT it came from: a half-hour run
        that is a couple of hundred kilobytes as FIT is comfortably over a megabyte as TCX. That
        matters for storage, not for charting — both parse quickly here.
      </p>
      <p>
        Practical rule: export FIT for archiving and for anything you want to re-analyse later,
        and export TCX when a tool only accepts XML, or when you want to read the numbers
        yourself. Note also that Garmin cannot export every activity type to TCX — multisport
        activities in particular are FIT-only.
      </p>

      <h2>Exporting a .tcx from Garmin Connect</h2>
      <p>
        The export lives in Garmin Connect on the web only; the mobile app does not offer it.
      </p>
      <ol>
        <li>Sign in at Garmin Connect in a browser.</li>
        <li>Open <strong>Activities</strong> from the left-hand menu and click the activity you want.</li>
        <li>Click the <strong>gear icon</strong> at the top right of the activity page.</li>
        <li>Choose <strong>Export to TCX</strong>. Unlike Export Original, this downloads a plain
            .tcx file rather than a ZIP archive.</li>
        <li>Drop that file anywhere on this page.</li>
      </ol>

      <h2>What gets charted</h2>
      <p>
        One panel per channel found in the file — pace or speed, heart rate, cadence, power where
        the extensions carry it, and elevation — all stacked on one x-axis that switches between
        elapsed time and distance, with a shared crosshair so hovering anywhere highlights the
        same instant in every panel. Each panel can show its own average, minimum and maximum
        reference lines. Average pace is computed as total moving time divided by total distance,
        with detected pauses excluded, rather than as a naive average of instantaneous pace
        values — which is the usual reason a third-party viewer disagrees with your watch.
      </p>
    `,
    faq: [
      {
        q: 'Is my TCX file uploaded anywhere?',
        a: 'No. It is parsed by JavaScript in your own browser tab and never leaves your device. There is no account and nothing is stored.',
      },
      {
        q: 'What is the difference between TCX and FIT?',
        a: 'FIT is the binary format your device records to; TCX is a lossy XML conversion of it produced by Garmin Connect. TCX is human-readable and stores distance per point, but drops developer fields and some per-lap detail that FIT keeps.',
      },
      {
        q: 'Why does my TCX show heart rate but no cadence?',
        a: 'Cadence, speed and power are stored in a Garmin extensions namespace rather than in the core TCX schema. If the recording device never wrote those extensions, the file genuinely has no cadence in it.',
      },
      {
        q: 'Can I export any activity as TCX?',
        a: 'Almost any, but not all. Some activity types, multisport in particular, can only be exported from Garmin Connect in the original FIT format.',
      },
    ],
  },

  {
    slug: 'gpx-viewer',
    title: 'GPX Viewer — Elevation Profile and Speed from a .GPX File',
    description:
      'Open a .gpx track and get an elevation profile plus a speed chart on a shared timeline. Works with watches, satellite messengers, cameras and phone apps.',
    heading: 'GPX viewer with elevation profile',
    intro:
      'Drop a .gpx file onto ActivityMaxxer to get an elevation profile and a speed chart from a track that stores neither. Both are reconstructed from the coordinates themselves.',
    body: `
      <h2>A GPX file is only a list of positions</h2>
      <p>
        GPX is the lowest common denominator of activity formats, and deliberately so — it is an
        interchange format, not a recording format. A track point carries a latitude, a longitude,
        usually an elevation, and usually a timestamp. That is the whole file. There is no heart
        rate, no cadence, no power and, crucially, <strong>no distance and no speed</strong>:
        neither is stored anywhere in a standard GPX.
      </p>
      <p>
        Which is exactly why so many GPX viewers show you a map and nothing else. Getting a
        useful chart out of one means deriving the interesting quantities rather than reading
        them.
      </p>

      <h2>How speed and distance are reconstructed</h2>
      <p>
        Distance is accumulated point to point using the haversine formula on the coordinates,
        giving a running total along the track. Speed then comes from the deltas of that total
        against the timestamps, and is smoothed before charting — raw point-to-point speed from
        consumer GPS is far noisier than the movement it describes, because each fix carries a
        few metres of positional error that differencing amplifies. Elevation is read straight
        from the elevation tag where the file has one.
      </p>
      <p>
        A track with no sport type declared is charted as a generic <strong>Track</strong>, which
        shows speed rather than pace — pace in minutes per kilometre is a running convention and
        is actively misleading for a drive, a flight or a multi-day hike.
      </p>

      <h2>It adapts to how often the device recorded</h2>
      <p>
        A watch writes a point every second. A satellite messenger might write one every ten
        minutes, for three days. Both are valid GPX and both should chart honestly, so pause
        detection, speed smoothing and the x-axis tick format all scale off the recording's own
        median sampling interval rather than off constants tuned for 1 Hz files. In practice that
        means a sparse multi-day breadcrumb trail produces a readable chart instead of a shape
        made mostly of interpolation artefacts, while watch files behave exactly as they always
        did.
      </p>
      <p>
        This makes GPX the format that covers everything which is not a training watch:
        satellite messengers such as SPOT or inReach, cameras that log location alongside photos,
        phone tracking apps, and anything that exports a route you actually travelled.
      </p>

      <h2>Tracks versus routes — the usual surprise</h2>
      <p>
        GPX can describe two quite different things. A <em>track</em> is a recording of where
        something went, with a timestamp on each point. A <em>route</em> is a plan for where
        something should go, and its points carry no time at all — which is legal GPX, and what
        you get when you export a course from a route planner rather than an activity from a
        recording.
      </p>
      <p>
        A route cannot be charted here, because with no timestamps there is no axis to plot
        against and no way to derive speed. If you drop one, you will get an explicit message
        saying so rather than an empty chart. If that happens, the fix is to export the activity
        rather than the course.
      </p>

      <h2>Getting a .gpx file</h2>
      <p>
        From Garmin Connect on the web: open the activity, click the gear icon at the top right,
        and choose <strong>Export to GPX</strong>. Most other platforms and phone apps offer a
        GPX export somewhere in their share or download menu, since it is the format everything
        agrees on. If the source can also give you FIT or TCX, prefer those — they carry heart
        rate, cadence and power that GPX simply has nowhere to put.
      </p>
    `,
    faq: [
      {
        q: 'Can a GPX file show heart rate?',
        a: 'Not in standard GPX. Heart rate can only appear through a vendor extension, and most exports do not include one. Export FIT or TCX instead if you need heart rate, cadence or power.',
      },
      {
        q: 'Where does the speed chart come from if GPX stores no speed?',
        a: 'It is derived. Distance is accumulated between consecutive points with the haversine formula, and speed comes from the deltas of that distance against the timestamps, then smoothed to remove GPS jitter.',
      },
      {
        q: 'Why does my GPX say it is a route rather than a track?',
        a: 'Its points carry no timestamps, which is what distinguishes a planned route from a recorded track. Without time there is no axis to plot against. Export the recorded activity rather than the course.',
      },
      {
        q: 'Does a multi-day or sparsely recorded track work?',
        a: "Yes. Pause detection, smoothing and the axis tick format scale off the recording's own median sampling interval, so a point every ten minutes across several days charts as honestly as a one-second watch file.",
      },
    ],
  },
]

export const prerenderedPages = pages.filter((page) => !page.sitemapOnly)
