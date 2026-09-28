(function(){
 if(window.__convenewireSpaceNavigationBound)return;
 window.__convenewireSpaceNavigationBound=true;
 function appearance(){
  const theme=document.documentElement.dataset.theme,port=window.chrome?.webview||window.webkit?.messageHandlers?.external;
  if((theme==='light'||theme==='dark')&&typeof port?.postMessage==='function')port.postMessage('wails:event:emit:convenewire.local.theme.'+theme);
 }
 appearance();new MutationObserver(appearance).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 document.addEventListener('click',function(event){
 const port=window.chrome?.webview||window.webkit?.messageHandlers?.external;
 if(!port||typeof port.postMessage!=='function')return;
 const back=event.target.closest&&event.target.closest('[data-local-workspace-return]');
 if(back){event.preventDefault();port.postMessage('wails:event:emit:convenewire.local.workspace');return;}
 const link=event.target.closest&&event.target.closest('a[data-authority-node][data-authority-team]');
 if(!link)return;
 const node=link.dataset.authorityNode,team=link.dataset.authorityTeam;
 if(!/^node_[A-Za-z0-9_-]{8,128}$/.test(node)||!/^team_[A-Za-z0-9_-]{8,128}$/.test(team))return;
 event.preventDefault();port.postMessage('wails:event:emit:convenewire.space.open.'+node+'.'+team);
 });
})();
