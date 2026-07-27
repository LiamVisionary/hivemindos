#!/usr/bin/env node
import { register } from "node:module";
register(new URL("./scripts/lib/ts-relative-loader.mjs", import.meta.url));

const { evaluateArtifactAcceptance } = await import(
  "./src/lib/services/deliverables/acceptance-contracts.ts"
);

const PREVIEW_URL = "https://preview.liamvisionary.com/p/test";

function testCase(name, menuEntries) {
  const json = JSON.stringify({
    template_slug: "restaurant-experience",
    business_name: "Test",
    business_profile: {
      image_urls: ["https://example.com/hero.jpg"],
      menu_entries: menuEntries,
    },
  });
  
  const v = evaluateArtifactAcceptance(
    { url: PREVIEW_URL },
    { body: json, contentType: "application/json" }
  );
  
  console.log(`\n${name}:`);
  console.log(`  Status: ${v.status}`);
  console.log(`  Violations: ${v.violations.map(x => x.code).join(", ") || "none"}`);
  v.violations.forEach(x => {
    console.log(`    - ${x.message}`);
  });
}

testCase("Empty array", []);

testCase("One unpriced", [
  { name: "Pizza", description: "…", price: "" },
]);

testCase("One priced", [
  { name: "Pizza", description: "…", price: "$15" },
]);

testCase("Two unpriced", [
  { name: "Pizza", description: "…", price: "" },
  { name: "Pasta", description: "…", price: "" },
]);

testCase("Three unpriced", [
  { name: "Pizza", description: "…", price: "" },
  { name: "Pasta", description: "…", price: "" },
  { name: "Salad", description: "…", price: "" },
]);

testCase("Four unpriced", [
  { name: "Pizza", description: "…", price: "" },
  { name: "Pasta", description: "…", price: "" },
  { name: "Salad", description: "…", price: "" },
  { name: "Soup", description: "…", price: "" },
]);

testCase("Four with one priced", [
  { name: "Pizza", description: "…", price: "$15" },
  { name: "Pasta", description: "…", price: "" },
  { name: "Salad", description: "…", price: "" },
  { name: "Soup", description: "…", price: "" },
]);
