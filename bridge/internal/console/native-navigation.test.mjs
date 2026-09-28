import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {JSDOM} from 'jsdom';

const script = readFileSync(new URL('./static/native-navigation.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./static/index.html', import.meta.url), 'utf8');
function page(t, platform) {
 const dom = new JSDOM(html, {url: 'http://wails.localhost/?workspace=1', runScripts: 'outside-only'});
 t.after(() => dom.window.close());
 const messages = [];
 const port = {postMessage: message => messages.push(message)};
 if (platform === 'windows') dom.window.chrome = {webview: port};
 if (platform === 'darwin') dom.window.webkit = {messageHandlers: {external: port}};
 dom.window.document.documentElement.dataset.theme = 'dark';
 return {dom, messages};
}

test('loaded native pages return exactly once per click through the platform port', t => {
 for (const platform of ['windows', 'darwin']) {
  // A new document must install a new listener after both outbound navigation and reload.
  for (let navigation = 0; navigation < 3; navigation++) {
   const {dom, messages} = page(t, platform);
   dom.window.eval(script);
   dom.window.eval(script);
   const button = dom.window.document.querySelector('[data-local-workspace-return]');
   button.innerHTML = '<span>Return</span>';
   button.firstChild.click();
   assert.deepEqual(messages, [
    'wails:event:emit:convenewire.local.theme.dark',
    'wails:event:emit:convenewire.local.workspace'
   ]);
  }
 }
});

test('navigation accepts only validated reference names, never a page URL', t => {
 const {dom, messages} = page(t, 'windows');
 dom.window.eval(script);
 messages.length = 0;
 const link = dom.window.document.createElement('a');
 link.href = '#ignored';
 link.dataset.authorityNode = 'node_remote001';
 link.dataset.authorityTeam = 'team_remote001';
 dom.window.document.body.append(link);
 link.click();
 assert.deepEqual(messages, ['wails:event:emit:convenewire.space.open.node_remote001.team_remote001']);
 messages.length = 0;
 link.dataset.authorityNode = 'https://untrusted.example/?secret=value';
 link.click();
 assert.deepEqual(messages, []);
});

test('ordinary browser has no native navigation capability', t => {
 const {dom, messages} = page(t, 'browser');
 dom.window.eval(script);
 dom.window.document.querySelector('[data-local-workspace-return]').click();
 assert.deepEqual(messages, []);
});