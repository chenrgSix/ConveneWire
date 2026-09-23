import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createNativeWorkspace} from './static/native-workspace.mjs';

const html = readFileSync(new URL('./static/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('./static/app.js', import.meta.url), 'utf8');
const nativeState = {localNodeId: 'node_local001', agents: [], bridgeRunning: true};
function fixture(t, search) {
 const dom = new JSDOM(html, {url: `http://wails.localhost/${search}`, runScripts: 'outside-only'});
 t.after(() => dom.window.close());
 const document = dom.window.document;
 return {dom, document, view: createNativeWorkspace({document, query: new URLSearchParams(search)})};
}

test('native settings opens the real Agent page and keeps editing and all management destinations', t => {
 const {dom, document, view} = fixture(t, '?workspace=1&theme=dark');
 assert.equal(document.body.classList.contains('native-workspace'), true, 'do not flash the legacy enrollment screen');
 assert.equal(document.getElementById('page-title').textContent, '本机 Agent');
 assert.equal(view.address, '/?workspace=1&theme=dark', 'reload retains presentation without the private token');
 assert.equal(view.render(nativeState), true);
 assert.equal(document.getElementById('workspace-agent-empty').classList.contains('hidden'), false);
 dom.window.currentState = nativeState;
 dom.window.pageCopy = {agents: {context: '本机设置', title: '本机 Agent'}};
 dom.window.elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(el => [el.id, el]));
 dom.window.handoffController = dom.window.peerSpacesController = dom.window.peerSharingController = dom.window.peerApprovalsController = {setActive() {}};
 const start = source.indexOf('function setPage('), end = source.indexOf('\nfunction governedInventoryGroup(', start);
 dom.window.eval(source.slice(start, end));
 dom.window.setPage(view.initialPage);
 assert.equal(document.getElementById('agents-page').classList.contains('hidden'), false);
 assert.equal(document.getElementById('overview-page').classList.contains('hidden'), true);
 assert.ok(document.querySelector('#agents-page #add-agent'));
 assert.deepEqual([...document.querySelectorAll('.workspace-settings-tabs [data-page-target]')].map(el => el.dataset.pageTarget), ['agents', 'handoff', 'peers', 'overview', 'governed', 'settings']);
 view.render({...nativeState, agents: [{agentId: 'agent_existing001'}]});
 assert.equal(document.getElementById('workspace-agent-empty').classList.contains('hidden'), true);
 view.render({...nativeState, bridgeRunning: false});
 assert.match(document.getElementById('workspace-runtime-state').textContent, /已停止/);
 assert.equal(document.querySelector('[data-local-workspace-return]').textContent, '← 返回本地空间');
});

test('workspace presentation cannot turn a legacy profile into a local Node', t => {
 const {document, view} = fixture(t, '?workspace=1');
 assert.equal(view.render({agents: [], bridgeRunning: false}), false);
 assert.equal(document.body.classList.contains('native-workspace'), false);
 assert.equal(document.getElementById('workspace-settings-header').classList.contains('hidden'), true);
 assert.equal(document.getElementById('workspace-agent-empty').classList.contains('hidden'), true);
 const ordinary = fixture(t, '');
 assert.equal(ordinary.view.initialPage, 'overview');
 assert.equal(ordinary.view.render(nativeState), false, 'standalone compatibility Console remains separate');
});

test('native settings inherits only a closed appearance value', t => {
 for (const [theme, expected] of [['light', 'light'], ['dark', 'dark'], ['https://foreign.example', 'dark']]) {
  const {document, view} = fixture(t, '?workspace=1&theme=' + encodeURIComponent(theme));
  view.render(nativeState);
  assert.equal(document.documentElement.dataset.theme, expected);
  assert.equal(document.querySelector('[data-local-workspace-return]').hasAttribute('href'), false, 'no page-supplied return URL');
 }
});

test('native collaboration and Codex links land directly on the selected page', t => {
 for (const page of ['peers', 'handoff']) {
  const {view} = fixture(t, '?workspace=1&theme=light&page=' + page);
  assert.equal(view.initialPage, page);
  assert.equal(view.address, '/?workspace=1&theme=light&page=' + page);
 }
 for (const page of ['settings', 'https://evil.test', '../peers']) {
  const {view} = fixture(t, '?workspace=1&page=' + encodeURIComponent(page));
  assert.equal(view.initialPage, 'agents');
 }
});
