import { extractVisualPhrases, isGroundingDinoAvailable } from "./lib/groundingDinoClient";

(async () => {
  console.log("=== Testing Grounding DINO Client Utility Functions ===");

  const phrases = extractVisualPhrases(
    "Look at the blue server icon on the left. The red arrow points to the database cluster."
  );
  console.log("Extracted phrases:", phrases);

  const available = await isGroundingDinoAvailable();
  console.log("Grounding DINO backend reachable:", available);

  console.log("=== Verification Test Finished Successfully ===");
})();
