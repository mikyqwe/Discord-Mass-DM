const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let mainWindow;

// Stats
const stats = {
  valid: 0,
  invalid: 0,
  total: 0,      // we track total tokens
  joined: 0,
  joinFails: 0,  // new
  members: 0,
  messages: 0,
  dmFails: 0     // new
};

// Running scripts
const runningScripts = {
  tokenChecker: null,
  joiner: null,
  scraper: null,
  dm: null
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: "Discord Tools"
  });
  mainWindow.loadFile(path.join(__dirname,'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{
  Object.values(runningScripts).forEach(ch=>{
    if(ch && !ch.killed) ch.kill('SIGKILL');
  });
  app.quit();
});

/* read-file, save-file */
ipcMain.handle('read-file',async(event,fileRel)=>{
  const full=path.join(__dirname,'slashy',fileRel);
  if(!fs.existsSync(full)) return '';
  return fs.readFileSync(full,'utf8');
});
ipcMain.handle('save-file',async(event,{ fileRelativePath,content })=>{
  const f=path.join(__dirname,'slashy',fileRelativePath);
  const dir=path.dirname(f);
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(f,content,'utf8');
  new Notification({
    title:'File Saved',
    body:`Saved to ${fileRelativePath}`
  }).show();
  return true;
});

/* parse line => color-coded console + stats update */
function parseLine(line) {
  let colorClass='consoleInfo';
  if(line.includes('[ERROR]') || line.includes('[ERR]')) colorClass='consoleErr';
  else if(line.includes('[WARN]')) colorClass='consoleWarn';

  // Send to UI
  if(mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('console-line',{ line, colorClass });
  }

  // Stats logic
  if(line.includes('[TOKEN-CHECKER:VALID]')) stats.valid++;
  if(line.includes('[TOKEN-CHECKER:INVALID]')) stats.invalid++;
  if(line.includes('[JOINER:JOINED]')) stats.joined++;
  if(line.includes('[JOINER:ERROR]')||line.includes('[JOINER:FAIL]')) stats.joinFails++;
  if(line.includes('[DM:SENT]')) stats.messages++;
  if(line.includes('[DM:ERROR]')||line.includes('[ERROR] Token')||line.includes('Failed to open DM')) stats.dmFails++;

  const m=line.match(/\[SCRAPER:TOTALMEMBERS\]=(\d+)/);
  if(m && m[1]) stats.members=parseInt(m[1]);

  // Then update UI
  if(mainWindow && !mainWindow.isDestroyed()){
    mainWindow.webContents.send('update-stats',{...stats});
  }
}

/* We also track the "total" tokens after load or save from renderer. 
   We'll do that in the renderer side for simplicity. */

/* run-token-checker => spawn node token-checker.js */
ipcMain.on('run-token-checker',()=>{
  const scriptPath=path.join(__dirname,'slashy','token-checker.js');
  if(!fs.existsSync(scriptPath)){
    notifyRenderer('[ERROR] token-checker.js not found');
    return;
  }
  resetStats('tokenChecker');
  const ch=spawn('node',[scriptPath],{
    cwd: path.join(__dirname,'slashy'),
    stdio:['ignore','pipe','pipe']
  });
  runningScripts.tokenChecker=ch;

  ch.stdout.on('data',(d)=>{
    const lines=d.toString().split('\n');
    lines.forEach(l=>{
      if(l.trim()) parseLine(l.trim());
    });
  });
  ch.stderr.on('data',(d)=>{
    const lines=d.toString().split('\n');
    lines.forEach(l=>{
      if(l.trim()) parseLine('[ERR] '+l.trim());
    });
  });
  ch.on('close',(code)=>{
    runningScripts.tokenChecker=null;
    notifyRenderer(`Token checker ended. code=${code}`);
    if(mainWindow && !mainWindow.isDestroyed()){
      mainWindow.webContents.send('checker-done');
    }
  });
});

/* run-script => joiner/scraper/dm */
ipcMain.on('run-script',(evt,{scriptName,scriptId,logFolderName})=>{
  if(runningScripts[scriptId]){
    notifyRenderer(`${scriptId} is already running`);
    return;
  }
  const sp=path.join(__dirname,'slashy',scriptName);
  if(!fs.existsSync(sp)){
    notifyRenderer(`[ERROR] ${scriptName} not found`);
    return;
  }
  resetStats(scriptId);
  const ch=spawn('node',[scriptName],{
    cwd:path.join(__dirname,'slashy'),
    stdio:['ignore','pipe','pipe']
  });
  runningScripts[scriptId]=ch;
  ch.stdout.on('data',(d)=>{
    const lines=d.toString().split('\n');
    lines.forEach(l=>{
      if(l.trim()) parseLine(l.trim());
    });
  });
  ch.stderr.on('data',(d)=>{
    const lines=d.toString().split('\n');
    lines.forEach(l=>{
      if(l.trim()) parseLine('[ERR] '+l.trim());
    });
  });
  ch.on('close',(cd)=>{
    runningScripts[scriptId]=null;
    notifyRenderer(`${scriptName} ended. code=${cd}`);
  });
  notifyRenderer(`${scriptName} started in background.`);
});

/* kill-script => kill child if any */
ipcMain.on('kill-script',(evt,scriptId)=>{
  const c=runningScripts[scriptId];
  if(!c){
    notifyRenderer(`No ${scriptId} is running`);
    return;
  }
  c.kill('SIGKILL');
  runningScripts[scriptId]=null;
  notifyRenderer(`Stopped ${scriptId}`);
});

/* run-login-token => spawn node login-with-token.js tokenArg */
ipcMain.on('run-login-token',(evt,token)=>{
  const sc=path.join(__dirname,'slashy','login-with-token.js');
  if(!fs.existsSync(sc)){
    notifyRenderer('[ERROR] login-with-token.js not found');
    return;
  }
  const c=spawn('node',[sc,token],{
    cwd:path.join(__dirname,'slashy'),
    stdio:['ignore','pipe','pipe']
  });
  c.stdout.on('data',(d)=>{
    d.toString().split('\n').forEach(line=>{
      if(line.trim()) parseLine(line.trim());
    });
  });
  c.stderr.on('data',(d)=>{
    d.toString().split('\n').forEach(line=>{
      if(line.trim()) parseLine('[ERR] '+line.trim());
    });
  });
  c.on('close',(cd)=>{
    notifyRenderer(`login-with-token ended. code=${cd}`);
  });
  notifyRenderer('login-with-token script started.');
});

/* helper */
function notifyRenderer(msg){
  if(mainWindow && !mainWindow.isDestroyed()){
    mainWindow.webContents.send('notify-user',msg);
  }
}

/* reset stats */
function resetStats(scriptId){
  if(scriptId==='tokenChecker'){
    stats.valid=0; stats.invalid=0;
  } else if(scriptId==='joiner'){
    stats.joined=0; stats.joinFails=0;
  } else if(scriptId==='scraper'){
    stats.members=0;
  } else if(scriptId==='dm'){
    stats.messages=0; stats.dmFails=0;
  }
  if(mainWindow && !mainWindow.isDestroyed()){
    mainWindow.webContents.send('update-stats',{...stats});
  }
}
