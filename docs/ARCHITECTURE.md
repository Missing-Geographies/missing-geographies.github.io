# Missing Geographies Architecture

This documentation describes the current working version. Do not refactor script.js or styles.css broadly. Many bottom-of-file patches are intentional and should not be removed without testing.

## Project Purpose

Missing Geographies is an interactive web artwork and living archive. It gathers voices, images, texts, sounds, and fragments from Iranians in diaspora and stages each contribution as a call from somewhere outside Iran back toward a place in Iran.

The project treats missing as more than nostalgia. Missing is a geography of removal: ordinary experiences interrupted, freedoms withheld, futures deferred, and versions of life that could not fully appear. The map, audio, subtitles, Persian/English labels, fragments, and dark archival visual language all work together to hold that feeling.

## Public Map Entry Point

The public map is served through GitHub Pages:

`https://shokrangit.github.io/missing-geographies-map/`

The page entry point is `index.html`. It loads:

- `styles.css` for layout, atmosphere, overlays, labels, panels, cursor, and final visual locks.
- D3 and TopoJSON from CDNs.
- `script.js` for all map behavior, story loading, animation, audio, subtitles, overlays, and late repair patches.

`index.html` is intentionally small. Most behavior is created or modified by JavaScript.

## Google Sheets / PublicMapData Flow

The frontend reads public story data from `PUBLIC_MAP_CSV_URL` in `script.js`. That URL points to a published Google Sheet CSV, specifically the `PublicMapData` output sheet.

The expected public columns include:

- `id`
- `title`
- `display_name`
- `origin_city`, `origin_country`, `origin_lng`, `origin_lat`
- `destination_city`, `destination_country`, `destination_lng`, `destination_lat`
- `year`
- `quote`
- `audio_url`
- `file_or_link`
- `location_privacy`
- language/subtitle columns such as `content_language`, `translation_en`, `transcript_fa`, `subtitle_en`, `translation_status`, `subtitle_cues_en`

Do not change this contract casually. The Apps Script publisher and frontend `rowToStory()` depend on these names.

If the public CSV is empty or fails to load, the frontend falls back to `fallbackStories` so the map can still render a sample call.

## Story Object Structure

`rowToStory()` converts a PublicMapData CSV row into the story object used by the map. A story generally contains:

- identity: `id`, `title`, `person`
- Iran/home side: `originCity`, `originCountry`, `originCoords`
- diaspora/current side: `destinationCity`, `destinationCountry`, `destinationCoords`
- time/text/media: `yearLeft`, `quote`, `audio`, `fileOrLink`
- privacy/language fields: `locationPrivacy`, `contentLanguage`, `translationEn`, `transcriptFa`, `subtitleEn`, `translationStatus`, `subtitleCuesEn`

Later bottom patches sanitize story data, especially city names and known coordinate problems such as Bushehr/Boushehr and Los Angeles typo variants.

## D3 Globe Rendering

The globe is an SVG managed by D3 in `script.js`. It uses an orthographic projection and world shapes from `world-atlas`. The base render flow draws:

- the sphere/ocean
- graticule lines
- country shapes
- Iran outline/highlight
- optional call-country outline
- route line
- story/destination points
- labels

The core `render()` function is defined early, then wrapped by later patches. The final active behavior depends on those wrappers running in order.

## Journey / Call Phases

A call begins when a viewer selects a diaspora point, a clustered story point, or a floating memory fragment. The journey moves through phases such as:

- idle
- calling
- travel
- line-arrived
- line-fade
- home-zoom
- arrived

These phases control what is visible: outside city labels, route line, home point, Iran labels, image/text fragments, audio state, and final arrival behavior.

## Route Animation

The route line visually carries a call from the diaspora/current place toward the origin place in Iran. The base line is built from projected coordinates using a curved path. A later patch refines the line into a more delicate signal-like route.

Route behavior is tightly connected to journey timing, camera rotation, and label visibility. It should be tested after any change to `renderLine()`, `selectStory()`, projection scale, or journey durations.

## Audio Playback

The hidden native audio element is `#story-audio`. JavaScript prepares audio for the selected story and exposes custom controls through the audio dock:

- play/pause
- back 10 seconds
- forward 10 seconds
- progress range
- time display

The audio dock is styled as a quiet floating control that becomes more readable while active or playing.

## Subtitle System

Subtitles are rendered into an on-map overlay, not the browser's default caption UI. The system supports several input styles:

- timed pipe cues
- SRT-style cues
- WebVTT-style cues
- fallback plain subtitle/translation text

The final subtitle patch restarts subtitle tracking after playback begins and uses a short ticker because some browsers do not fire early `timeupdate` events reliably. This timing behavior is intentional.

## Image Fragments

Image fragments can come from `file_or_link` or submitted media fields. If a selected story has an image URL, the map can show an on-map thumbnail after arrival. The thumbnail can open into a fullscreen image viewer.

Audio and subtitles are intentionally kept above or visible around the image viewer through z-index styling.

## Text Fragments

Submitted text/quote content can appear as an animated text fragment panel. Later patches delay image and text fragments until the final Iran close-up so they do not appear too early in the call journey.

## Floating Memory Fragments

The idle map includes floating memory fragments built from story data: words, years, places, or other small textual traces. These fragments drift over the archive field and can begin a call when caught/clicked.

The fragment cloud is intentionally atmospheric and part of the artwork's visual language.

## City Clustering

The original point system rendered one point per story. A later patch groups stories by destination city/country to reduce overlap.

Cluster behavior:

- one story in a city appears as a single city point
- multiple stories in the same city appear as a clustered point
- clicking a clustered point opens a bloom of individual story points
- clicking an individual bloomed point starts that story's call

Several CSS patches lock diaspora/cluster points to a pale floating-fragment color family while preserving Iran as golden.

## Persian / English City Labels

Arrival labels show the Iranian city/year in English, with a Persian city name underneath when known. The final label repair centers the two lines together and uses right-to-left settings and Nastaliq-style font fallbacks for Persian.

These labels are sensitive to SVG text direction, `text-anchor`, `unicode-bidi`, and final CSS specificity.

## Bushehr / Boushehr Handling

Bushehr/Boushehr has special handling in both frontend and Apps Script because geocoding can return province-level or imprecise coordinates. The final frontend patch normalizes known variants and sets precise city-level coordinates.

The Apps Script also includes known-city repair helpers for Bushehr/Boushehr and Los Angeles typo variants.

## About Overlay

The About item inside the Missing Geographies dropdown opens an on-map floating About panel. Later patches intentionally prevent the About item from navigating to the old About page and remove/hide older About panel artifacts.

The final About panel uses the same dark archival visual language as the map.

## Contribute / Tally Behavior

The Contribute item is redirected to the contribution form. Later patches ensure it opens the Tally form in a new tab instead of taking the viewer away from the map.

This behavior is implemented by intercepting the existing Contribute item in the custom Missing Geographies dropdown and updating its link/activation handling.

## Lantern Cursor

The lantern cursor creates a soft moving field around the viewer's pointer. It is part of the project's atmosphere and also relates to the title-dot invitation behavior.

Do not remove it unless a future plan explicitly replaces it and tests the title invitation, hover states, mobile behavior, and accessibility fallback.

## Blinking Title-Dot Invitation

The first `i` in `Missing Geographies` is turned into a blinking live dot. The original implementation opened a memory quote. Later patches replace that with a Persian invitation, then a bilingual scrollable invitation box with a language toggle.

The final behavior constrains the invitation to open only when the cursor/lantern is close to the title dot, or when the dot receives keyboard focus.

## Apps Script Workflow

The Apps Script backend is the bridge from submissions to the public map:

1. Raw Tally submissions arrive in the `submissions` sheet.
2. `processSubmissions()` builds or updates rows in `ReviewData`.
3. Rows begin unapproved.
4. The editor can geocode rows, approve rows, or unapprove rows from the custom spreadsheet menu.
5. `updatePublicMapData_()` publishes approved rows with valid origin and destination coordinates to `PublicMapData`.
6. Public language/subtitle columns are linked from `ReviewData` into `PublicMapData`.
7. Known-city repair helpers fix important coordinate/name cases.

The frontend reads only the published CSV output. The private review and submission details stay in the spreadsheet workflow.

## Patch Ordering Warning

`script.js` and `styles.css` were built iteratively. Many bottom-of-file patches intentionally override, wrap, or lock earlier behavior. Some code that looks repetitive is preserving active behavior.

Before removing, moving, or consolidating any patch, test the relevant behavior manually and confirm which function or selector is final active behavior.

