# Missing Geographies QA Checklist

This documentation describes the current working version. Do not refactor script.js or styles.css broadly. Many bottom-of-file patches are intentional and should not be removed without testing.

Use this checklist before and after any behavior-affecting change. The artwork is patch-layered, so small edits can affect distant systems.

## Loading The Site

- [ ] Open the public map URL.
- [ ] Confirm the page loads without a blank screen.
- [ ] Confirm D3/TopoJSON dependencies load.
- [ ] Confirm the globe renders.
- [ ] Confirm country shapes and Iran outline render.
- [ ] Confirm no obvious console errors appear.
- [ ] Confirm fallback story behavior still works if the public sheet has no rows.

## Map Idle State

- [ ] The dark archival atmosphere is present.
- [ ] The globe is full-screen or stage-like, not boxed as a generic map.
- [ ] Iran is visible or reachable through the Iran view control.
- [ ] Pale diaspora/floating-fragment points are visible when story data exists.
- [ ] Floating memory fragments drift without blocking the main navigation.
- [ ] The audio dock is quiet but visible.

## Missing Geographies Dropdown

- [ ] The top navigation shows the custom Missing Geographies dropdown.
- [ ] Opening the dropdown reveals the expected page items.
- [ ] The dropdown uses the archive-panel visual language.
- [ ] The old separate Home/About/Map/Contribute row does not visually conflict with the custom dropdown.
- [ ] Closing the dropdown works by clicking away or selecting an item.

## About Overlay

- [ ] Click About inside the Missing Geographies dropdown.
- [ ] Confirm it opens the on-map About panel instead of navigating to the old About page.
- [ ] Confirm the About panel text is readable.
- [ ] Confirm the close button works.
- [ ] Confirm clicking outside closes the panel.
- [ ] Confirm the map behind the panel is subtly dimmed, not broken.
- [ ] Confirm the About panel remains usable on mobile.

## Contribute Opens Tally In A New Tab

- [ ] Click Contribute inside the Missing Geographies dropdown.
- [ ] Confirm the Tally contribution form opens in a new tab.
- [ ] Confirm the map tab remains open.
- [ ] Confirm dropdowns close after activation.
- [ ] Confirm keyboard activation also opens the form in a new tab.

## Iran / ایران Button

- [ ] Click the Iran / ایران or Iran view control.
- [ ] Confirm the globe rotates/zooms toward Iran.
- [ ] Confirm any open clusters close.
- [ ] Confirm image/text fragments hide or reset as intended.
- [ ] Confirm subtitles/audio state is not corrupted.

## Single City Point Call

- [ ] Click a diaspora point representing one story.
- [ ] Confirm call/buzz feedback begins.
- [ ] Confirm the map rotates toward the outside-Iran city.
- [ ] Confirm the starting country/city highlight appears.
- [ ] Confirm the call begins without opening a cluster.

## Clustered City Point Call

- [ ] Use data with multiple stories in the same diaspora city.
- [ ] Click the clustered city point.
- [ ] Confirm it blooms into individual story points.
- [ ] Confirm opening the cluster does not start audio/call travel by itself.
- [ ] Click one bloomed story point.
- [ ] Confirm the selected story call begins.
- [ ] Confirm cluster labels/counts are readable and not visually dominant.

## Route Animation

- [ ] Confirm the route line appears after the call focus phase.
- [ ] Confirm the line travels from diaspora/current place toward Iran.
- [ ] Confirm the line feels delicate and signal-like, not a heavy GIS route.
- [ ] Confirm route animation remains aligned with globe rotation.

## Line Fade

- [ ] Confirm the line reaches Iran.
- [ ] Confirm it holds briefly.
- [ ] Confirm it fades cleanly.
- [ ] Confirm labels/arrival point remain visible at the right moment.

## Iran Arrival

- [ ] Confirm the globe zooms toward the Iranian origin city.
- [ ] Confirm the home/arrival point appears.
- [ ] Confirm the arrival point is golden/warm, not styled like the pale diaspora points.
- [ ] Confirm image/text fragments appear only at the intended final arrival moment.

## English / Persian City Label

- [ ] Confirm the English city/year label appears near the Iranian arrival point.
- [ ] Confirm the Persian city name appears underneath when known.
- [ ] Confirm the Persian line uses right-to-left direction correctly.
- [ ] Confirm the Persian line sits visually under the English line, not offset awkwardly.
- [ ] Confirm Nastaliq-style font fallbacks are preserved.

## Bushehr / Boushehr Test

- [ ] Test a story whose Iranian city is Bushehr.
- [ ] Test a story whose Iranian city is Boushehr.
- [ ] Confirm the label keeps the intended spelling.
- [ ] Confirm the Persian label appears as بوشهر when applicable.
- [ ] Confirm the point uses city-level coordinates, not province-level coordinates.
- [ ] Confirm the point is not visually pushed too far offshore or inland.

## Audio Dock

- [ ] Confirm the dock is visible in idle state.
- [ ] Confirm Play/Pause works for a selected story.
- [ ] Confirm back 10 seconds works.
- [ ] Confirm forward 10 seconds works.
- [ ] Confirm progress dragging works.
- [ ] Confirm time display updates.
- [ ] Confirm the dock becomes more readable while audio is active.
- [ ] Confirm disabled or idle controls do not look broken.

## Subtitles

- [ ] Test timed pipe-format cues.
- [ ] Test SRT-style cues.
- [ ] Test WebVTT-style cues.
- [ ] Test fallback plain `subtitle_en` or `translation_en` text.
- [ ] Confirm subtitles appear when audio starts, not several seconds late.
- [ ] Confirm subtitles update after seeking.
- [ ] Confirm subtitles hide when no cue is active.
- [ ] Confirm subtitles clear when audio/story resets.
- [ ] Confirm subtitles remain visible above the audio dock and image viewer.

## Image Thumbnail

- [ ] Test a story with an image URL in the submitted file/link fields.
- [ ] Confirm no image thumbnail appears before final arrival.
- [ ] Confirm the thumbnail appears after final Iran arrival.
- [ ] Confirm the thumbnail is positioned near the arrival context without covering the main label.
- [ ] Confirm broken/non-image links do not show a broken thumbnail.

## Full Image Viewer

- [ ] Click the image thumbnail.
- [ ] Confirm fullscreen image viewer opens.
- [ ] Confirm image scales within the viewport.
- [ ] Confirm close button works.
- [ ] Confirm Escape closes the viewer.
- [ ] Confirm audio dock and subtitles remain usable/visible as intended.
- [ ] Confirm mobile image viewer is usable.

## Text Fragment Panel

- [ ] Test a story with submitted text/quote content.
- [ ] Confirm the text panel does not appear too early.
- [ ] Confirm it appears after the intended arrival phase.
- [ ] Confirm the panel text is readable.
- [ ] Confirm it does not cover the audio dock or subtitles badly.
- [ ] Confirm reset/Iran view hides or resets it correctly.

## Floating Memory Fragments

- [ ] Confirm fragments appear in idle state.
- [ ] Confirm fragments drift smoothly.
- [ ] Confirm fragment text is readable but quiet.
- [ ] Confirm clicking/catching a fragment starts the related call.
- [ ] Confirm fragments become quiet or hide during active journey when intended.
- [ ] Confirm mobile fragment density is not overwhelming.

## Lantern Cursor

- [ ] Confirm the custom lantern cursor appears on desktop.
- [ ] Confirm it follows pointer movement smoothly.
- [ ] Confirm interactive elements trigger the hover state.
- [ ] Confirm click state works.
- [ ] Confirm the cursor hides or degrades gracefully when the pointer leaves the viewport.
- [ ] Confirm it does not block clicks.

## Blinking Title-Dot Invitation

- [ ] Confirm the first `i` in Missing Geographies becomes the blinking title dot.
- [ ] Confirm the invitation opens only when the cursor/lantern is near the dot.
- [ ] Confirm keyboard focus on the dot opens the invitation.
- [ ] Confirm moving away closes the invitation after the intended delay.
- [ ] Confirm Persian text is right-to-left and readable.
- [ ] Confirm the English/Persian language toggle works.
- [ ] Confirm the invitation box scrolls internally.
- [ ] Confirm mobile layout remains usable.

## Mobile Viewport

- [ ] Test at common mobile widths.
- [ ] Confirm nav controls wrap without overlapping.
- [ ] Confirm globe remains visible.
- [ ] Confirm About panel fits and scrolls.
- [ ] Confirm title invitation fits and scrolls.
- [ ] Confirm audio dock does not cover subtitles.
- [ ] Confirm image/text fragments remain usable.
- [ ] Confirm clustered points and labels remain tappable/readable.

## Google Sheets Update Workflow

- [ ] Submit or simulate a raw Tally row in the `submissions` sheet.
- [ ] Run the Apps Script sync to create/update `ReviewData`.
- [ ] Confirm new rows begin unapproved.
- [ ] Confirm origin and destination fields are parsed correctly.
- [ ] Geocode selected rows.
- [ ] Confirm known-city repairs work for Bushehr/Boushehr and Los Angeles variants.
- [ ] Approve a row.
- [ ] Confirm approved/geocoded rows publish to `PublicMapData`.
- [ ] Confirm language/subtitle columns appear in public output.
- [ ] Refresh the public map and confirm the story appears.
- [ ] Unapprove a row.
- [ ] Confirm it disappears from `PublicMapData` and the public map after refresh/cache-bust.
