import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
const source=await readFile(new URL('../../bridge/cmd/convenewire-bridge-desktop/local_node_spaces.go',import.meta.url),'utf8');
const script=source.match(/const localSpaceNavigationScript = `([\s\S]*?)`;/)?.[1] ?? source.match(/const localSpaceNavigationScript = `([\s\S]*?)`/)[1];
for(const platform of ['webkit','webview2'])test(`native Space script works without the HTTP runtime on ${platform}`,()=>{
 const dom=new JSDOM('<a href="https://remote.example/?team=team_remote001" data-authority-node="node_remote001" data-authority-team="team_remote001"><span>Remote</span></a>',{url:'http://127.0.0.1:48123',runScripts:'outside-only'});
 const messages=[];const port={postMessage:message=>messages.push(message)};
 if(platform==='webkit')dom.window.webkit={messageHandlers:{external:port}};else dom.window.chrome={webview:port};
 assert.equal(dom.window._wails,undefined);dom.window.eval(script);
 const click=()=>{const event=new dom.window.MouseEvent('click',{bubbles:true,cancelable:true});dom.window.document.querySelector('span').dispatchEvent(event);return event.defaultPrevented};
 assert.equal(click(),true);assert.deepEqual(messages,['wails:event:emit:convenewire.space.open.node_remote001.team_remote001']);
 dom.window.document.querySelector('a').dataset.authorityNode='https://attacker.example?token=secret';
 // Prevent JSDOM's unrelated real navigation while checking the native handler.
 dom.window.document.addEventListener('click',event=>event.preventDefault());click();assert.equal(messages.length,1);
 dom.window.close();
});
for(const platform of ['webkit','webview2'])test(`native settings returns by a fixed event and carries only appearance on ${platform}`,async()=>{
 const dom=new JSDOM('<html data-theme="light"><button data-local-workspace-return data-url="https://foreign.example?token=secret"><span>返回</span></button></html>',{url:'http://wails.localhost/?token=private',runScripts:'outside-only'});
 const messages=[],port={postMessage:message=>messages.push(message)};
 if(platform==='webkit')dom.window.webkit={messageHandlers:{external:port}};else dom.window.chrome={webview:port};
 dom.window.eval(script);
 assert.deepEqual(messages,['wails:event:emit:convenewire.local.theme.light']);
 const event=new dom.window.MouseEvent('click',{bubbles:true,cancelable:true});
 dom.window.document.querySelector('span').dispatchEvent(event);
 assert.equal(event.defaultPrevented,true);
 assert.equal(messages.at(-1),'wails:event:emit:convenewire.local.workspace');
 dom.window.document.documentElement.dataset.theme='https://foreign.example';
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(messages.length,2);
 dom.window.document.documentElement.dataset.theme='dark';
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(messages.at(-1),'wails:event:emit:convenewire.local.theme.dark');
 assert.ok(messages.every(message=>!message.includes('private')&&!message.includes('secret')&&!message.includes('foreign')));
 dom.window.close();
});
