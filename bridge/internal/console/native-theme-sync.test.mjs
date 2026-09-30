import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createNativeWorkspace} from './static/native-workspace.mjs';

const entryURL = new URL('../../../apps/web/src/main.tsx', import.meta.url);
const entry = readFileSync(entryURL, 'utf8');
const consoleHTML = readFileSync(new URL('./static/index.html', import.meta.url), 'utf8');
const sharedURL = new URL('./static/native-navigation.js', import.meta.url);
const sharedScript = readFileSync(sharedURL, 'utf8');

function roomScript() {
  const importPath = entry.match(/import\s+["']([^"']*native-navigation\.js)["'];/)?.[1];
  assert.ok(importPath, 'the Room entry must load native navigation without Wails URL-window injection');
  const importedURL = new URL(importPath, entryURL);
  assert.equal(importedURL.href, sharedURL.href, 'Room and Console must share one navigation implementation');
  return readFileSync(importedURL, 'utf8');
}

function page(t, html, platform) {
  const dom = new JSDOM(html, {url: 'http://127.0.0.1:48123', runScripts: 'outside-only'});
  t.after(() => dom.window.close());
  const messages = [];
  const port = {postMessage: message => messages.push(message)};
  if (platform === 'windows') dom.window.chrome = {webview: port};
  if (platform === 'darwin') dom.window.webkit = {messageHandlers: {external: port}};
  return {dom, messages};
}

const flush = () => new Promise(resolve => setImmediate(resolve));

for (const platform of ['windows', 'darwin']) {
  test(`Room theme reaches Agent settings after each document load on ${platform}`, async t => {
    for (const initial of ['light', 'dark']) {
      // Each loop represents a fresh Room document after returning from settings.
      const {dom, messages} = page(t, '<html><body><div id="root"></div></body></html>', platform);
      assert.equal(dom.window._wails, undefined);
      dom.window.eval(roomScript());
      dom.window.eval(sharedScript); // macOS injection or a duplicate module load.
      assert.deepEqual(messages, []);
      for (const theme of [initial, initial === 'light' ? 'dark' : 'light']) {
        const before = messages.length;
        dom.window.document.documentElement.dataset.theme = theme;
        await flush();
        assert.equal(messages.length, before + 1, 'one observer per document');
        assert.equal(messages.at(-1), `wails:event:emit:convenewire.local.theme.${theme}`);
        const received = messages.at(-1).split('.').at(-1);
        const settings = page(t, consoleHTML, platform);
        const view = createNativeWorkspace({document: settings.dom.window.document,
          query: new URLSearchParams({workspace: '1', theme: received})});
        view.render({localNodeId: 'node_local001', agents: [], bridgeRunning: true});
        assert.equal(settings.dom.window.document.documentElement.dataset.theme, theme);
        assert.equal(view.initialPage, 'agents');
        assert.equal(view.address, `/?workspace=1&theme=${theme}`);
      }
      const before = messages.length;
      dom.window.document.documentElement.dataset.theme = 'https://foreign.example/?token=private';
      await flush();
      assert.equal(messages.length, before, 'only closed appearance names cross the native port');
    }
  });
}

test('Room script reports an already restored theme and stays inert in an ordinary browser', async t => {
  for (const platform of ['windows', 'darwin', 'browser']) {
    const {dom, messages} = page(t, '<html data-theme="light"><body></body></html>', platform);
    dom.window.eval(roomScript());
    assert.deepEqual(messages, platform === 'browser' ? [] : ['wails:event:emit:convenewire.local.theme.light']);
    dom.window.document.documentElement.dataset.theme = 'dark';
    await flush();
    assert.equal(messages.length, platform === 'browser' ? 0 : 2);
  }
});
