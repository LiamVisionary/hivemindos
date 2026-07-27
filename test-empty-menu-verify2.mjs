#!/usr/bin/env node
import { register } from "node:module";
register(new URL("./scripts/lib/ts-relative-loader.mjs", import.meta.url));

const { evaluateArtifactAcceptance } = await import(
  "./src/lib/services/deliverables/acceptance-contracts.ts"
);

// Test Case 1: Empty menu_entries array in JSON
const EMPTY_JSON = JSON.stringify({
  template_slug: "restaurant-experience",
  business_name: "Test Restaurant",
  business_profile: {
    image_urls: ["https://example.com/hero.jpg"],
    menu_entries: [],  // <-- EMPTY ARRAY
  },
});

// Test Case 2: Single unpriced dish
const ONE_UNPRICED_JSON = JSON.stringify({
  template_slug: "restaurant-experience",
  business_name: "Test Restaurant",
  business_profile: {
    image_urls: ["https://example.com/hero.jpg"],
    menu_entries: [
      { name: "Pizza", description: "…", price: "" },
    ],
  },
});

// Test Case 3: Two dishes, one with wireframe name
const TWO_DISHES_JSON = JSON.stringify({
  template_slug: "restaurant-experience",
  business_name: "Test Restaurant",
  business_profile: {
    image_urls: ["https://example.com/hero.jpg"],
    menu_entries: [
      { name: "Menu / offer clarity", description: "…", price: "" },
      { name: "Pizza", description: "…", price: "" },
    ],
  },
});

const jsonContent = (body) => ({ body, contentType: "application/json", status: 200 });

console.log("=== Test 1: Empty menu_entries array ===");
const v1 = evaluateArtifactAcceptance(
  { url: "https://preview.example.com/p/test" },
  jsonContent(EMPTY_JSON)
);
console.log("Status:", v1.status);
console.log("Violations:");
v1.violations.forEach(v => {
  console.log(`  - ${v.code}: ${v.message}`);
});

console.log("\n=== Test 2: Single unpriced dish (dishCount=1, priced.length=0) ===");
const v2 = evaluateArtifactAcceptance(
  { url: "https://preview.example.com/p/test" },
  jsonContent(ONE_UNPRICED_JSON)
);
console.log("Status:", v2.status);
console.log("Violations:");
v2.violations.forEach(v => {
  console.log(`  - ${v.code}: ${v.message}`);
});

console.log("\n=== Test 3: Two dishes, one wireframe ===");
const v3 = evaluateArtifactAcceptance(
  { url: "https://preview.example.com/p/test" },
  jsonContent(TWO_DISHES_JSON)
);
console.log("Status:", v3.status);
console.log("Violations:");
v3.violations.forEach(v => {
  console.log(`  - ${v.code}: ${v.message}`);
});
