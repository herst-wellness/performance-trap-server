'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

test('interactive controls retain comfortable touch targets without overflowing narrow screens', () => {
  const button = rule('.button');
  assert.match(button, /min-height:\s*44px/);
  assert.match(button, /max-width:\s*100%/);
  assert.match(button, /white-space:\s*normal/);
  assert.match(button, /text-align:\s*center/);
  assert.match(button, /overflow-wrap:\s*anywhere/);

  const links = rule('.back-link, .text-link');
  assert.match(links, /display:\s*inline-flex/);
  assert.match(links, /min-height:\s*44px/);
  assert.match(links, /max-width:\s*100%/);

  const consentRow = rule('.consent-row');
  assert.match(consentRow, /min-height:\s*44px/);
  const consentInput = rule('.consent-row input');
  assert.match(consentInput, /flex:\s*0 0 20px/);
  assert.match(consentInput, /width:\s*20px/);
  assert.match(consentInput, /height:\s*20px/);

  assert.match(css, /\.rating-row select\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*1rem/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.pathway-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.voice-controls\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.voice-button\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});
