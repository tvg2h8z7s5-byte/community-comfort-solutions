'use strict';
// Keep delivered pages static: shared markup is expanded before committing.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const check = process.argv.includes('--check');
let stale = false;
for (const file of fs.readdirSync(path.join(root, 'site')).filter(f => f.endsWith('.html'))) {
  const target = path.join(root, 'site', file);
  const source = fs.readFileSync(target, 'utf8');
  let output = source;
  for (const part of ['header', 'footer', 'call-bar']) {
    let markup = fs.readFileSync(path.join(root, 'partials', `${part}.html`), 'utf8').trim();
    const current = file === 'index.html' ? '/' : `/${file}`;
    markup = markup.replace(/<a([^>]*?) href="([^"]+)"/g, (match, attrs, href) => {
      if (href !== current || attrs.includes('brand')) return match;
      if (attrs.includes('class="')) attrs = attrs.replace(/class="([^"]*)"/, 'class="$1 active"');
      else attrs += ' class="active"';
      return `<a${attrs} aria-current="page" href="${href}"`;
    });
    const start = `<!-- shared:${part}:start -->`;
    const end = `<!-- shared:${part}:end -->`;
    if (!output.includes(start) || !output.includes(end)) throw new Error(`Missing ${part} markers: ${file}`);
    output = output.replace(new RegExp(`${start}[\\s\\S]*?${end}`), `${start}\n${markup}\n${end}`);
  }
  if (source !== output) {
    if (check) { console.error(`Shared layout is stale: ${file}`); stale = true; }
    else fs.writeFileSync(target, output);
  }
}
if (stale) process.exitCode = 1;
