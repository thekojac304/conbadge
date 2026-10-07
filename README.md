Con Badge

An interactive digital convention badge. Load a VRM avatar (exported from
VRChat or made in VRoid) onto a phone you wear on a lanyard, and it comes alive:
it breathes, blinks, fidgets, reacts to being touched, and leans when you move.

No servers, no accounts, no uploads — the avatar file is read from your device
and cached locally. Runs in any modern mobile browser and installs to the home
screen as an app.

Live: https://thekojac304.github.io/conbadge/


What it does

Always-on idle life. Layered breathing, randomised blinking, wandering gaze,
soft knee bend with a slow bounce, drifting arms, micro-expressions, and a
procedurally animated tail and ears. Nothing loops on an obvious cycle — the
motions run at different frequencies so they drift in and out of phase.

16 idle gestures fired at random intervals: wave, stretch, head scratch,
body shake, sniff, weight shift, paw lift, toe tap, heel raise, leg stretch,
tail swish, ear flick, blep, look around, head tilt, foot shuffle.

Touch reactions across 15 zones. Head and ears get a happy wag, cheeks
blush, the nose gets booped (recoil, blink, sparkles, then a blep), chest
giggles with a squash-and-stretch bounce, belly rubs are contented, hips get a
startled fluster, hands wave back, thighs are ticklish.

Petting. Drag across the avatar and it builds up — big smile, softened eyes,
leaning into your hand, tail going, hearts drifting upward. Eases back out when
you stop.

Motion sensors. Shake the phone and he gets dizzy. Tilt it and he shifts
weight to stay upright. Optional tilt parallax swings the camera a few degrees
so the badge reads as a window into a box rather than a flat picture.


Using it

Open the page, tap Choose avatar, pick a .vrm file. It's cached, so you
only do this once.

Modes

ModeWhat it's forSetupToolbar visible, long-press opens settings. For tuning at home.PlayEvery control hidden — just the avatar. For wearing at a con.

Enter play mode with the play button in the toolbar. To get back out: tap the
top-left corner for an exit button, or hold that corner for about a
second. Nobody discovers that by idly poking the badge, but you can do it
one-handed.

Controls

ActionResultTap the avatarReaction for that body partDrag on the avatarPet himDrag on the backgroundOrbit the cameraTwo-finger dragSlide the framing verticallyPinchZoomLong-press (setup mode)Open settingsShake the phoneDizzy

Settings

Four tabs: Badge (name, pronouns, nameplate, background), Camera (lock,
height, saved default view, auto-return), Avatar (tail curl and side, a
searchable blendshape browser, load a different avatar), Display (battery
saver, keep awake, motion sensors, parallax, particles, play mode).

Camera lock stops anyone dragging your framing while leaving touch reactions
working — the con-proof setting. Pair it with a saved default view and an
auto-return timer if you'd rather let people look around.


Hosting it yourself

It's a static site: drop the files on any web server, or use GitHub Pages.
See HOSTING.md for a step-by-step.

HTTPS is required for motion sensors, wake lock, and Add to Home Screen.
Those silently do nothing on file:// or plain HTTP. GitHub Pages gives you
HTTPS for free; self-hosting needs a real or self-signed certificate.

If you self-host, make sure .js files are served with a JavaScript MIME type —
browsers refuse ES modules served as text/plain. Every mainstream web server
gets this right by default.


Avatar compatibility

Works with any VRM 0.x or 1.0 file. All animation drives the normalised
humanoid bones the VRM spec guarantees, so poses, gestures and touch zones
work on any rig regardless of scale or proportions — offsets are expressed as
fractions of the avatar's own measurements rather than fixed distances.

Some things are detected by name and may need adjusting for an unusual avatar:


Expressions are matched against morph-target names (VRoid Fcl_*, ARKit,
and common English namings). The load readout lists what it found.
Tail and ear bones are found by name (tail, shippo, ear, mimi).
Spring physics: many VRChat-to-VRM conversions strip them. If the file has
none, tail and ear motion is generated procedurally instead, with a phase lag
down the chain so it whips rather than moving as one rigid piece.


Mobile GPU note: avatars with hundreds of morph targets can silently fail to
render on phones. The loader keeps only the morphs it recognises (capped at 48)
and prunes the rest, which is what makes 400+ blendshape VRoid exports usable.


Tuning

Nearly every constant lives at the top of config.js, commented, so you can
adjust the look without touching logic: resting arm and knee angles, wave and
scratch shapes, tail curl limits, blink timing, petting sensitivity, parallax
strength, shake threshold, and more.

Useful debug switches in the same file:


ZONE_DEBUG — draws a coloured dot at every touch anchor so you can see
exactly where the zones sit
SOLID_DEBUG — flat-shades every mesh, to separate geometry problems from
material problems
DEBUG — skeleton and geometry bounds


The clapperboard button in the toolbar opens a test bar that fires any gesture
or reaction on demand, which beats waiting for the idle cycle.


Project layout

Plain ES modules, no build step and no dependencies to install — three.js and
three-vrm load from a CDN via an import map.

FileRoleindex.htmlMarkup, styles, import mapconfig.jsTuning constants and the touch-zone mapcore.jsRenderer, scene, camera, shared state, storage, sensorspose.jsPose accumulator, expression driver, arm IKcamera.jsFraming, saved views, parallax, render passanim.jsIdle, gestures, tail/ears, particles, petting, reactionsavatar.jsVRM loading, mesh repair, morph pruning, rig measurementinput.jsTaps, petting drags, long-press, play-mode escapeui.jsSettings, modes, test bar, blendshape browsermain.jsFrame loop and boot

Dependencies flow one way — core and config at the bottom, main at the
top, with no circular imports. Modules that would otherwise need each other
communicate through a small hooks object.

The build stamp shown in the load readout (e.g. b33) identifies the running
version, which is handy for confirming a deploy actually landed.


Credits

Built with three.js and
@pixiv/three-vrm.

Avatar files are yours and stay on your device.
