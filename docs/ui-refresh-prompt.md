# ReproCheck UI refresh prompt

Restyle the existing ReproCheck application with a cinematic, monochrome visual
identity. Work in the existing React + Vite project; do not replace it with a
static landing page, rebuild the backend, or change any API contract.

## Preserve the product

Keep all existing scan, pinned-commit import, reviewed preset, experiment input,
preflight, confirmation, execution, cancellation, evidence download, history,
replay and comparison behavior. Retain validation, accessibility, loading/error
states and truthful distinctions between execution success and verification.
Never replace live results with mock numbers or enable unsupported features.

## Visual direction

- Black canvas, white typography, muted gray secondary text, subtle borders.
- White pill navigation with dark labels and a three-dot active indicator.
- Circular white brand mark using a simple original ReproCheck symbol.
- Oversized solid-white dot-matrix headline; no animated gradient or shimmer.
- A full-bleed video background on the home hero only, using this supplied URL:
  `https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4`
- Dark overlay for contrast. Muted, looping, inline playback; provide a visible
  motion toggle. Respect reduced-motion preferences and fall back to black if
  playback is unavailable. Do not play video behind dense experimental data.
- Use Inter for UI and the supplied BubbledotICG-FinePos stylesheet for the hero,
  with system/monospace fallbacks. Do not invent missing local font assets.
- Restrained entrance animation and a softly glowing white primary CTA.

## Adapt the layout to a working application

The first home viewport contains navigation, a short capability label, the
headline “Research code. / Verifiable results.”, an accurate description,
“Start a scan” CTA, and four real workflow labels: Scan, Review, Execute, Verify.
Do not show invented enterprise customers, uptime, latency, confidence or usage
statistics. Do not add sign-in, contact or marketing routes without backing features.

The CTA scrolls to and focuses the existing repository form. Keep configuration
import and all reviewed examples available below the hero. Allow document
scrolling; never use body overflow:hidden or clip content to fit one viewport.

Report, configuration, execution and history views use the same monochrome
palette with opaque readable panels. Keep semantic green/amber/red states,
selectable command text, horizontal code scrolling and clear focus outlines.
Preserve the existing navigation and mounted form state. Do not add a routing
framework or new dependencies for this visual change.

Desktop is primary. Narrow windows must reflow columns and wrap navigation
without hiding functions. Reduced-motion users receive an unanimated version.

## Deliver and verify

Use a new branch. Test/build the existing app and inspect the home hero, CTA,
motion toggle, real scan, configuration and history in the browser. Document any
unverified behavior and external asset dependency. Save preview screenshots.
Do not commit, push or publish unless requested.
