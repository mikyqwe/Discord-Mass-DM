const { ipcRenderer } = require('electron');

// Keep track if we've run check tokens yet
let hasRunChecker = false;

window.addEventListener('DOMContentLoaded', async () => {
  // read standard fields
  const map = {
    messagesTxt: 'input/messages.txt',
    tokensTxt:   'input/tokens.txt',
    proxiesTxt:  'input/proxies.txt',
    configTxt:   'config.json'
  };
  for (const [id, file] of Object.entries(map)) {
    const data = await ipcRenderer.invoke('read-file', file);
    document.getElementById(id).value = data || '';
  }

  // read existing invite => show "discord.gg/..."
  const existingInvite = await ipcRenderer.invoke('read-file','input/invite.txt');
  if(existingInvite.trim()){
    document.getElementById('currentInvite').textContent=`discord.gg/${existingInvite.trim()}`;
    document.getElementById('inviteInput').value=`https://discord.gg/${existingInvite.trim()}`;
  }

  // file input for tokens
  document.getElementById('tokensFileInput').addEventListener('change', uploadTokens);

  // Recalc total tokens
  recalcTokensTotal();

  updateButtons();
});

/* Copy field => smaller button */
window.copyField = (fieldId) => {
  const el = document.getElementById(fieldId);
  let val = el.value || '';
  if(!val){
    showToast('Nothing to copy');
    return;
  }
  navigator.clipboard.writeText(val)
    .then(()=> showToast('Copied!'))
    .catch(()=> showToast('Failed to copy'));
};

/* Import tokens from file => recalc total */
function uploadTokens(){
  const inp = document.getElementById('tokensFileInput');
  if(!inp.files || inp.files.length===0){
    showToast('No file selected');
    return;
  }
  const file=inp.files[0];
  const rdr=new FileReader();
  rdr.onload=e=>{
    document.getElementById('tokensTxt').value = e.target.result;
    showToast(`Imported tokens from ${file.name}`);
    recalcTokensTotal();
    updateButtons();
  };
  rdr.readAsText(file);
}

/* Recalc total tokens => parse lines in tokensTxt */
function recalcTokensTotal(){
  const tokens = document.getElementById('tokensTxt').value
    .split('\n')
    .map(x=>x.trim())
    .filter(Boolean);
  document.getElementById('statTotal').innerText = tokens.length;
}

/* Save invite => parse code => fetch => store */
window.saveInvite = async()=>{
  const str = document.getElementById('inviteInput').value.trim();
  if(!str){
    showToast('Invite link empty');
    return;
  }
  const m=str.match(/discord(\.gg|\.com\/invite)\/(\w+)/i);
  if(!m){
    showToast('Could not parse invite code');
    return;
  }
  const code=m[2];
  try{
    const resp=await fetch(`https://discord.com/api/v10/invites/${code}`);
    if(!resp.ok){
      showToast(`HTTP ${resp.status}`);
      return;
    }
    const data=await resp.json();
    if(!data.guild||!data.guild.id){
      showToast('No guild id');
      return;
    }
    await ipcRenderer.invoke('save-file',{
      fileRelativePath:'input/invite.txt',
      content:code
    });
    await ipcRenderer.invoke('save-file',{
      fileRelativePath:'input/serverId.txt',
      content:data.guild.id
    });
    document.getElementById('currentInvite').textContent=`discord.gg/${code}`;
    showToast(`Saved invite code=${code}, guildId=${data.guild.id}`);
    // document.getElementById('inviteShake').classList.remove('inviteShake');
  }catch(err){
    showToast(err.message);
  }
};

/* Save text area => slashy/ file => recalc tokens if it's tokens.txt */
window.saveFile= async(fileRelativePath,textId)=>{
  const val = document.getElementById(textId).value.trim();
  await ipcRenderer.invoke('save-file',{ fileRelativePath, content: val });
  if(fileRelativePath==='input/tokens.txt'){
    recalcTokensTotal();
  }
  showToast(`Saved to ${fileRelativePath}`);
  updateButtons();
};

/* run token-checker => remove highlight, set hasRunChecker */
window.runTokenChecker=()=>{
  hasRunChecker=true;
  document.getElementById('btnCheckTokens').classList.remove('highlightCheck');
  ipcRenderer.send('run-token-checker');
};

/* Move to valid => read valid-tokens => override tokens */
window.moveToValid= async()=>{
  if(!hasRunChecker){
    showToast('Please run check tokens first');
    return;
  }
  const raw=await ipcRenderer.invoke('read-file','output/valid-tokens.txt');
  await ipcRenderer.invoke('save-file',{ fileRelativePath:'input/tokens.txt', content:raw });
  document.getElementById('tokensTxt').value=raw;
  recalcTokensTotal();
  showToast('Moved valid tokens into tokens.txt');
};

/* run scripts => joiner/scraper/dm => parse lines => stats */
window.runJoiner=()=>{
  if(!validateScripts()){
    showToast('Missing tokens/proxies/config');
    return;
  }
  const folder=document.getElementById('logFolderInput').value.trim();
  ipcRenderer.send('run-script',{ scriptName:'joiner.js', scriptId:'joiner', logFolderName:folder });
};
window.runScraper=()=>{
  if(!validateScripts()){
    showToast('Missing tokens/proxies/config');
    return;
  }
  const folder=document.getElementById('logFolderInput').value.trim();
  ipcRenderer.send('run-script',{ scriptName:'scrape.js', scriptId:'scraper', logFolderName:folder });
};
window.runDM=()=>{
  if(!validateScripts()){
    showToast('Missing tokens/proxies/config');
    return;
  }
  const msg=document.getElementById('messagesTxt').value.trim();
  if(!msg)return showToast('Message is empty');
  const folder=document.getElementById('logFolderInput').value.trim();
  ipcRenderer.send('run-script',{ scriptName:'index.js', scriptId:'dm', logFolderName:folder });
};

/* stop script => kill child */
window.stopScript=(scriptId)=>{
  ipcRenderer.send('kill-script',scriptId);
};

/* Clear tokens that cannot join => logic depends on how you store them
   This is just a dummy action for demonstration. */
window.clearJoinFails=()=>{
  // e.g. read a file join-failed.txt, remove from input/tokens.txt
  showToast('Cleared tokens that cannot join (dummy).');
};

/* Validate => tokens/proxies/config => enable run joiner/scraper/dm */
function validateScripts(){
  const t=document.getElementById('tokensTxt').value.trim();
  const p=document.getElementById('proxiesTxt').value.trim();
  const c=document.getElementById('configTxt').value.trim();
  if(!t||!p||!c)return false;
  return true;
}

/* on stats update => set fields */
ipcRenderer.on('update-stats',(evt,st)=>{
  if(st.total!==undefined) document.getElementById('statTotal').innerText=st.total; // or from local
  if(st.valid!==undefined) document.getElementById('statValid').innerText=st.valid;
  if(st.invalid!==undefined) document.getElementById('statInvalid').innerText=st.invalid;
  if(st.joined!==undefined) document.getElementById('statJoined').innerText=st.joined;
  if(st.joinFails!==undefined) {
    document.getElementById('statJoinFails').innerText=st.joinFails;
    const btnCJF=document.getElementById('btnClearFailJoin');
    if(st.joinFails>0) {
      btnCJF.classList.remove('disabled');
      btnCJF.removeAttribute('title');
    } else {
      btnCJF.classList.add('disabled');
      btnCJF.setAttribute('title','No fails yet');
    }
  }
  if(st.members!==undefined) document.getElementById('statMembers').innerText=st.members;
  if(st.messages!==undefined) document.getElementById('statDmSent').innerText=st.messages;
  if(st.dmFails!==undefined){
    document.getElementById('statDmFails').innerText=st.dmFails;
  }
});

/* after checker done => read valid/invalid, show "Move to valid" if >0 */
ipcRenderer.on('checker-done',async()=>{
  showToast('Token Checker done!');
  let vr=await ipcRenderer.invoke('read-file','output/valid-tokens.txt');
  let ir=await ipcRenderer.invoke('read-file','output/invalid-tokens.txt');
  const va=vr.split('\n').filter(x=>x.trim());
  const ia=ir.split('\n').filter(x=>x.trim());
  document.getElementById('statValid').innerText=va.length;
  document.getElementById('statInvalid').innerText=ia.length;
  // also enable "move to valid" if not empty
  const btnMV=document.getElementById('btnMoveValid');
  if(va.length>0){
    btnMV.classList.remove('disabled');
    btnMV.removeAttribute('title');
  }
});

/* console-line => color-coded */
ipcRenderer.on('console-line',(evt,{line,colorClass})=>{
  const c=document.getElementById('logsConsole');
  const div=document.createElement('div');
  div.className=colorClass;
  div.textContent=line;
  c.appendChild(div);
  c.scrollTop=c.scrollHeight;
});

/* notify-user => toast message */
ipcRenderer.on('notify-user',(evt,msg)=>{
  showToast(msg);
});

/* run login-with-token => spawns "login-with-token.js" */
window.runLoginWithToken=()=>{
  const tk=document.getElementById('loginTokenInput').value.trim();
  if(!tk)return showToast('No token provided');
  ipcRenderer.send('run-login-token',tk);
};

/* expand/collapse advanced */
window.toggleAdvanced=()=>{
  const adv=document.getElementById('advCollapsible');
  adv.classList.toggle('advOpen');
  adv.classList.toggle('advCollapsed');
};

/* message preview */
window.previewMessage=()=>{
  const msg=document.getElementById('messagesTxt').value||'';
  document.getElementById('previewContent').innerHTML=parseDiscordMarkdown(msg);
  document.getElementById('modalOverlay').style.display='flex';
};
window.closePreview=()=>{
  document.getElementById('modalOverlay').style.display='none';
};

function parseDiscordMarkdown(txt){
  let out=txt;
  out=out.replace(/\*\*\*(.*?)\*\*\*/g,'<strong><em>$1</em></strong>');
  out=out.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  out=out.replace(/\*(.*?)\*/g,'<em>$1</em>');
  out=out.replace(/__(.*?)__/g,'<u>$1</u>');
  out=out.replace(/~~(.*?)~~/g,'<s>$1</s>');
  return out;
}

/* enable/disable run joiner/scraper/dm */
function updateButtons(){
  const can=validateScripts();
  const j=document.getElementById('btnJoiner');
  const s=document.getElementById('btnScraper');
  const d=document.getElementById('btnDM');
  j.disabled=!can; s.disabled=!can; d.disabled=!can;
  if(can){
    j.classList.remove('disabled');
    s.classList.remove('disabled');
    d.classList.remove('disabled');
  } else {
    j.classList.add('disabled');
    s.classList.add('disabled');
    d.classList.add('disabled');
  }
  // Also recalc tokens total
  recalcTokensTotal();
  // If user hasn't run checker, disable move to valid
  const btnMV=document.getElementById('btnMoveValid');
  if(!hasRunChecker){
    btnMV.classList.add('disabled');
    btnMV.setAttribute('title','Run check tokens first');
  }
}

/* toast */
function showToast(msg){
  const n=document.getElementById('toastNotify');
  n.innerText=msg;
  n.style.display='block';
  setTimeout(()=>{n.style.display='none';},3000);
}
