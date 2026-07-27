#!/usr/bin/env node
import { register } from "node:module";
register(new URL("./scripts/lib/ts-relative-loader.mjs", import.meta.url));

const { evaluateArtifactAcceptance } = await import(
  "./src/lib/services/deliverables/acceptance-contracts.ts"
);

// Exactly as in the test suite: Giuseppe JSON
const GIUSEPPE_JSON = JSON.stringify({
  template_slug: "restaurant-experience",
  business_name: "Giuseppe's Ristorante & Pizzeria",
  business_profile: {
    image_urls: ["https://images.unsplash.com/photo-1517248135467"],
    menu_entries: [
      { name: "Menu / offer clarity", description: "…", price: "" },
      { name: "Hours + location path", description: "…", price: "" },
      { name: "Booking / order CTA", description: "…", price: "" },
    ],
  },
});

const PREVIEW_URL = "https://preview.liamvisionary.com/p/giuseppe-s-ristorante-pizzeria";

console.log("=== Test: Giuseppe JSON (from test suite) ===");
const v = evaluateArtifactAcceptance(
  { url: PREVIEW_URL },
  { body: GIUSEPPE_JSON, contentType: "application/json" }
);
console.log("Status:", v.status);
console.log("Violations:");
v.violations.forEach(v => {
  console.log(`  - ${v.code}: ${v.message}`);
});

// Now test empty array
const EMPTY_JSON = JSON.stringify({
  template_slug: "restaurant-experience",
  business_name: "Giuseppe's Ristorante & Pizzeria",
  business_profile: {
    image_urls: ["https://images.unsplash.com/photo-1517248135467"],
    menu_entries: [],
  },
});

console.log("\n=== Test: Empty menu_entries ===");
const v2 = evaluateArtifactAcceptance(
  { url: PREVIEW_URL },
  { body: EMPTY_JSON, contentType: "application/json" }
);
console.log("Status:", v2.status);
console.log("Violations:");
v2.violations.forEach(v => {
  console.log(`  - ${v.code}: ${v.message}`);
});
