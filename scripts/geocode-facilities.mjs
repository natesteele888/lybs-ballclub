#!/usr/bin/env node
/* ============================================================
   One-time geocode of every address in data/league-info.json's
   "facilities" list, so each field can carry a real Google Street
   View deep link (js/league-info.js builds the URL from lat/lng --
   see that file).

   Uses OpenStreetMap's Nominatim, not a Google geocoding API: no
   key needed, nothing to bill, and the 23 addresses here are
   exactly the "light use" case Nominatim's own usage policy asks
   for -- a proper User-Agent, max 1 request/second, run once and
   cache the result rather than geocoding on every page load. See
   https://operations.osmfoundation.org/policies/nominatim/.

   Usage:
     node scripts/geocode-facilities.mjs
   Writes the lat/lng straight into data/league-info.json's
   facilities (committed -- these don't change once a field has
   been geocoded, same as the addresses themselves).
   ============================================================ */

import { readFile, writeFile } from 'node:fs/promises';

const DELAY_MS = 1100; // Nominatim's policy: max 1 request/second
const USER_AGENT = 'LYBSBallclubFacilityGeocoder/1.0 (+https://github.com/natesteele888/lybs-ballclub -- one-time geocode, contact via repo issues)';

async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Geocode failed for "${address}": HTTP ${res.status}`);
  const results = await res.json();
  if (!results.length) return null;
  return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
}

async function main() {
  const path = new URL('../data/league-info.json', import.meta.url);
  const data = JSON.parse(await readFile(path, 'utf8'));
  let found = 0, missing = 0;

  for (let i = 0; i < data.facilities.length; i++) {
    const f = data.facilities[i];
    if (f.lat && f.lng) { found++; continue; } // already geocoded, skip (re-run is safe/cheap)
    process.stdout.write(`Geocoding ${f.name} (${f.address})... `);
    const coords = await geocode(f.address);
    if (coords) {
      f.lat = coords.lat; f.lng = coords.lng;
      console.log(`${coords.lat}, ${coords.lng}`);
      found++;
    } else {
      console.log('NOT FOUND -- leaving lat/lng unset, Street View link will be omitted for this field');
      missing++;
    }
    if (i < data.facilities.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nDone -- ${found}/${data.facilities.length} geocoded, ${missing} not found. Wrote ${path.pathname}.`);
}

main().catch(err => { console.error(err); process.exit(1); });
