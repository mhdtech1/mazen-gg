// Syncs audience stats for the media kit (media-kit/stats.json).
// Run locally with `node scripts/update-media-kit-stats.mjs`; also run daily by
// .github/workflows/media-kit-stats.yml. All sources are fetched server-side to
// avoid browser CORS limits. Each platform is fetched independently and the last
// known value is preserved if a fetch fails, so the media kit never goes blank.

import { readFile, writeFile } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const IG_APP_ID = "936619743392459";

// X / Twitter auto-syncs via the fxtwitter API. Optional manual override:
// set a number here to force it, or leave null to use the live value.
const MANUAL_X_FOLLOWERS = null;

const CONFIG = {
  youtube:    { label: "YouTube",     handle: "@mazen.dahroug", url: "https://youtube.com/@mazen.dahroug",       metric: "subscribers", channelId: "UCJdQoNFiAepDttpdZshzitA" },
  mazenclips: { label: "MazenClips",  handle: "@mazenclips",    url: "https://www.youtube.com/@mazenclips",      metric: "subscribers", channelId: "UC_E0yKfC8I5MEjGsjKob-UQ" },
  twitch:     { label: "Twitch",      handle: "@mazendahroug",  url: "https://www.twitch.tv/mazendahroug",       metric: "followers" },
  tiktok:     { label: "TikTok",      handle: "@mazen.dahroug", url: "https://www.tiktok.com/@mazen.dahroug",    metric: "followers" },
  instagram:  { label: "Instagram",   handle: "@mazen.dahroug", url: "https://instagram.com/mazen.dahroug",      metric: "followers" },
  x:          { label: "X (Twitter)", handle: "@mazendahroug",  url: "https://x.com/mazendahroug",               metric: "followers" },
};

function parseCount(s) {
  if (!s) return null;
  const m = String(s).trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const suf = (m[2] || "").toUpperCase();
  if (suf === "K") n *= 1e3;
  else if (suf === "M") n *= 1e6;
  else if (suf === "B") n *= 1e9;
  return Math.round(n);
}

async function ytSubs(channelId, handle) {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}`, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`yt ${res.status}`);
  const html = await res.text();
  // The channel's OWN count is a standalone metadata part: "content":"75 subscribers".
  // Recommended channels render as "@handle • N subscribers", which must NOT match.
  let m = html.match(/"content":"([\d.,]+\s?[KMB]?)\s+subscribers"/i);
  if (!m && handle) {
    const h = handle.replace(/^@/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    m = html.match(new RegExp("@" + h + "[^\\d]{0,14}([\\d.,]+\\s?[KMB]?)\\s+subscribers", "i"));
  }
  const n = parseCount(m && m[1]);
  if (n == null) throw new Error("yt: subs not found");
  return n;
}

async function twitchFollowers() {
  const t = await (await fetch("https://decapi.me/twitch/followcount/mazendahroug")).text();
  const n = parseInt(t.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) throw new Error("twitch parse");
  return n;
}

async function tiktokStats() {
  const html = await (await fetch("https://www.tiktok.com/@mazen.dahroug", { headers: { "user-agent": UA } })).text();
  const g = (re) => { const m = html.match(re); return m ? parseInt(m[1], 10) : null; };
  const value = g(/"followerCount":(\d+)/);
  if (value == null) throw new Error("tiktok: followers not found");
  return { value, likes: g(/"heartCount":(\d+)/), videos: g(/"videoCount":(\d+)/) };
}

async function xFollowers() {
  // fxtwitter mirrors public X profile data with no auth; vxtwitter is a backup.
  for (const url of ["https://api.fxtwitter.com/mazendahroug", "https://api.vxtwitter.com/mazendahroug"]) {
    try {
      const d = await (await fetch(url, { headers: { "user-agent": UA } })).json();
      const n = d?.user?.followers ?? d?.followers_count;
      if (n != null) return n;
    } catch {}
  }
  throw new Error("x: count missing");
}

async function igFollowers() {
  let last = "";
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://www.instagram.com/api/v1/users/web_profile_info/?username=mazen.dahroug", {
      headers: {
        "user-agent": UA,
        "x-ig-app-id": IG_APP_ID,
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://www.instagram.com/mazen.dahroug/",
        "x-requested-with": "XMLHttpRequest",
        "sec-fetch-site": "same-origin",
      },
    });
    if (r.ok) {
      const d = await r.json();
      const n = d?.data?.user?.edge_followed_by?.count;
      if (n != null) return n;
    }
    last = `ig ${r.status}`;
  }
  throw new Error(last || "ig failed");
}

// ---- load previous (to preserve last-known values on failure) --------------
let prev = { platforms: {} };
try {
  prev = JSON.parse(await readFile(new URL("../media-kit/stats.json", import.meta.url)));
} catch {}

const platforms = {};
for (const [key, cfg] of Object.entries(CONFIG)) {
  const p = prev.platforms?.[key] || {};
  platforms[key] = { ...cfg, value: p.value ?? null };
  if (p.likes != null) platforms[key].likes = p.likes;
  if (p.videos != null) platforms[key].videos = p.videos;
}

const safe = (fn) => fn().then((v) => v, (e) => { console.error("skip:", e.message); return null; });

const [ytMain, ytClips, tw, tt, ig, x] = await Promise.all([
  safe(() => ytSubs(CONFIG.youtube.channelId, CONFIG.youtube.handle)),
  safe(() => ytSubs(CONFIG.mazenclips.channelId, CONFIG.mazenclips.handle)),
  safe(twitchFollowers),
  safe(tiktokStats),
  safe(igFollowers),
  safe(xFollowers),
]);

if (ytMain != null) platforms.youtube.value = ytMain;
if (ytClips != null) platforms.mazenclips.value = ytClips;
if (tw != null) platforms.twitch.value = tw;
if (tt) {
  platforms.tiktok.value = tt.value;
  if (tt.likes != null) platforms.tiktok.likes = tt.likes;
  if (tt.videos != null) platforms.tiktok.videos = tt.videos;
}
if (ig != null) platforms.instagram.value = ig;
if (x != null) platforms.x.value = x;
if (MANUAL_X_FOLLOWERS != null) platforms.x.value = MANUAL_X_FOLLOWERS;

const out = { syncedAt: new Date().toISOString(), platforms };
await writeFile(new URL("../media-kit/stats.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");

const summary = Object.entries(platforms).map(([k, p]) => `${k}=${p.value}`).join(" ");
console.log("wrote media-kit/stats.json ::", summary);
