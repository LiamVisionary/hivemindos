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

const htmlContent = (body) => ({ body, contentType: "application/json", status: 200 });

console.log("=== Test 1: Empty menu_entries array ===");
const v1 = evaluateArtifactAcceptance(
  { url: "https://preview.example.com/p/test" },
  htmlContent(EMPTY_JSON)
);
console.log("Status:", v1.status);
console.log("Violations:");
v1.violations.forEach(v => {
  console.log(`  - ${v.code}: ${v.message}`);
});

console.log("\n=== Test 2: Single unpriced dish (dishCount=1, priced.length=0) ===");
const v2 = evaluateArtifactAcceptance(
  { url: "https://preview.example.com/p/test" },
  htmlContent(ONE_UNPRICED_JSON)
);
console.log("Status:", v2.status);
console.log("Violations:");
v2.violations.forEach(v => {
  console.log(`  - ${v.code}: ${v.message}`);
});

// Show the distinction
console.log("\n=== Analysis ===");
console.log("Test 1 (empty array):");
console.log("  - violations.length:", v1.violations.length);
console.log("  - Should trigger: menu-too-thin (dishCount < 4 && priced.length < 2)");
console.log("  - Should NOT trigger: menu-items-unpriced (requires dishCount >= 1)");

console.log("\nTest 2 (one unpriced dish):");
console.log("  - violations.length:", v2.violations.length);
console.log("  - Should trigger: both menu-items-unpriced AND menu-too-thin");
