// Picks the most recent upload across ALL of Mazen's YouTube channels and
// writes it to latest-video.json (read at runtime by the site).
// Run locally with `node scripts/update-latest-video.mjs`; also run on a
// schedule by .github/workflows/latest-video.yml so the site stays current.

import { writeFile, readFile } from "node:fs/promises";

const CHANNELS = [
  { name: "Mazen Dahroug", id: "UCJdQoNFiAepDttpdZshzitA" },
  { name: "MazenClips", id: "UC_E0yKfC8I5MEjGsjKob-UQ" },
];

function firstEntry(xml) {
  const block = xml.split("<entry>")[1];
  if (!block) return null;
  const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
  const title = block.match(/<title>([^<]+)<\/title>/)?.[1];
  const published = block.match(/<published>([^<]+)<\/published>/)?.[1];
  if (!videoId || !published) return null;
  return { videoId, title: decodeXml(title ?? ""), published };
}

function decodeXml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function latestForChannel(ch) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
  const res = await fetch(url, { headers: { "user-agent": "mazen-gg-bot" } });
  if (!res.ok) throw new Error(`${ch.name}: HTTP ${res.status}`);
  const xml = await res.text();
  const entry = firstEntry(xml);
  if (!entry) throw new Error(`${ch.name}: no entries`);
  return { ...entry, channel: ch.name };
}

const results = [];
for (const ch of CHANNELS) {
  try {
    results.push(await latestForChannel(ch));
  } catch (e) {
    console.error("skip:", e.message);
  }
}

if (!results.length) {
  console.error("No videos resolved from any channel; leaving file unchanged.");
  process.exit(1);
}

results.sort((a, b) => new Date(b.published) - new Date(a.published));
const latest = results[0];

const payload = {
  videoId: latest.videoId,
  title: latest.title,
  channel: latest.channel,
  published: latest.published,
};

// Only rewrite when the chosen video changes, so the scheduled job doesn't
// produce noisy no-op commits.
let prev = null;
try {
  prev = JSON.parse(await readFile(new URL("../latest-video.json", import.meta.url)));
} catch {}

if (prev?.videoId === payload.videoId) {
  console.log(`unchanged: ${payload.videoId} (${payload.channel} — ${payload.title})`);
  process.exit(0);
}

await writeFile(
  new URL("../latest-video.json", import.meta.url),
  JSON.stringify(payload, null, 2) + "\n"
);
console.log(`updated -> ${payload.videoId} (${payload.channel} — ${payload.title})`);
