import { applyPatch } from './src/lib/artifactPatcher';

const artifact = `<!DOCTYPE html>
<html>
<head>
  <title>My App</title>
</head>
<body>
  <div class="card">
    <h2>Card 1</h2>
    <p>Content</p>
  </div>
  <div class="card">
    <h2>Card 2</h2>
    <p>Content</p>
  </div>
  <div class="card">
    <h2>Card 3</h2>
    <p>Content</p>
  </div>
</body>
</html>`;

// Case 1: Multi-match failure (model tries to update all 'Content' to 'Updated Content')
const patch1 = [
  {
    search: '    <p>Content</p>',
    replace: '    <p>Updated Content</p>'
  }
];

const res1 = applyPatch(artifact, patch1);
console.log("CASE 1 (multi-match):", JSON.stringify(res1, null, 2));

// Case 2: Truncated search block (model tries to update Card 1 and Card 3 in one block)
const patch2 = [
  {
    search: `  <div class="card">
    <h2>Card 1</h2>
    <p>Content</p>
  </div>
  ...
  <div class="card">
    <h2>Card 3</h2>
    <p>Content</p>
  </div>`,
    replace: `  <div class="card">
    <h2>Card 1</h2>
    <p>Updated Content</p>
  </div>
  ...
  <div class="card">
    <h2>Card 3</h2>
    <p>Updated Content</p>
  </div>`
  }
];

const res2 = applyPatch(artifact, patch2);
console.log("CASE 2 (truncated no_match):", JSON.stringify(res2, null, 2));

// Case 3: Overlapping blocks (model tries to change the body, but also changes a card inside the body)
const patch3 = [
  {
    search: `<body>
  <div class="card">
    <h2>Card 1</h2>
    <p>Content</p>
  </div>`,
    replace: `<body>
  <h1>Welcome</h1>
  <div class="card">
    <h2>Card 1</h2>
    <p>Content</p>
  </div>`
  },
  {
    search: `  <div class="card">
    <h2>Card 1</h2>
    <p>Content</p>
  </div>`,
    replace: `  <div class="card">
    <h2>Card 1</h2>
    <p>Updated Content</p>
  </div>`
  }
];

const res3 = applyPatch(artifact, patch3);
console.log("CASE 3 (overlapping_blocks):", JSON.stringify(res3, null, 2));
