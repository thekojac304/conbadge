# Putting Con Badge online (HTTPS)

You need HTTPS for three things that don't work from a local file:
motion sensors (shake/tilt/parallax), Add to Home Screen, and offline caching.

Everything below is done in a **web browser** — no git commands, no terminal.
Your `.vrm` is never uploaded; it stays in the phone's storage.

---

## Option A — GitHub Pages (recommended, permanent + free)

### One-time setup (~10 minutes)

1. **Make an account** at <https://github.com> if you don't have one.

2. **Create a repository**
   - Click the **+** (top right) → **New repository**
   - Name: `conbadge`
   - Select **Public** *(Pages requires public on the free plan)*
   - Click **Create repository**

3. **Upload the files**
   - On the new empty repo page, click **uploading an existing file**
   - Drag in all of these:
     - `index.html`
     - `manifest.json`
     - `sw.js`
     - `icon-192.png`
     - `icon-512.png`
     - `icon-maskable-512.png`
   - Click **Commit changes**

4. **Turn on Pages**
   - **Settings** tab → **Pages** (left sidebar)
   - Under *Build and deployment* → Source: **Deploy from a branch**
   - Branch: **main**, folder: **/ (root)** → **Save**

5. **Wait 1–2 minutes**, then open:
   ```
   https://YOUR-USERNAME.github.io/conbadge/
   ```
   (Refresh the Pages settings screen — it shows the live link when ready.)

6. **On the phone:** open that URL → Chrome menu **⋮** → **Add to Home Screen**.
   Launch it from the icon and you get a fullscreen app with no browser bar.

---

### Updating it later (~1 minute)

When you have a new `index.html`:

1. Open your repo on github.com
2. **Add file** → **Upload files**
3. Drag in the new `index.html` (same filename = it replaces the old one)
4. **Commit changes**
5. Wait ~30–60 seconds, then reload on the phone

The service worker is **network-first** for the app itself, so a normal reload
picks up the new version. No cache-clearing dance required.

> If it ever seems stuck on an old version: close the app fully and reopen, or
> visit the URL in a normal browser tab and pull down to refresh.

---

## Option B — Netlify Drop (fastest, good for a quick test)

1. Go to <https://app.netlify.com/drop>
2. Drag the whole `conbadge` folder onto the page
3. You get an HTTPS URL within seconds

No account needed to try it. Make a free account if you want to keep the same
URL and drag-and-drop updates onto the same site later.

---

## Which to pick

| | GitHub Pages | Netlify Drop |
|---|---|---|
| Setup | ~10 min | ~1 min |
| Permanent URL | yes | needs an account |
| Update process | upload file | re-drag folder |
| Version history | yes (every upload) | no |

**Suggested path:** Netlify Drop first to confirm the sensors work on your
phone, then GitHub Pages as the permanent home.

---

## Note on privacy

A public repo means the *code* is visible to anyone — that's fine, there's
nothing secret in it. Your avatar file is **not** in the repo; it's loaded from
your phone's storage and cached only on your device.

If you'd rather nothing be public at all, that's an argument for going straight
to the Capacitor Android build, where the whole thing lives on the phone.
