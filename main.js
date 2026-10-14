const {
  app,
  BrowserWindow,
  Menu,
  session,
  systemPreferences,
  ipcMain,
  dialog,
  shell,
  safeStorage
} = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const { autoUpdater } = require('electron-updater');
// ============================================================
// TREND OPS
// Versão 1.0
// Feito por Taka
// ============================================================
const {registerPhoneIPC}=require('./phone-adb');
const APP_NAME = 'Trend Ops';
const APP_VERSION = app.getVersion();
app.setName(APP_NAME);
let mainWindow = null;
let updaterConfigured = false;
let updateDownloaded = false;
let checkInProgress = null;
async function checkForUpdatesSafely() {
  if (!app.isPackaged) return null;
  if (checkInProgress) return checkInProgress;
  checkInProgress = autoUpdater.checkForUpdates();
  try { return await checkInProgress; }
  finally { checkInProgress = null; }
}
// ============================================================
// ENVIA EVENTO PARA O INDEX.HTML
// ============================================================
function sendToRenderer(channel, data = {}) {
  if (
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {
    mainWindow.webContents.send(
      channel,
      data
    );
  }
}
// ============================================================
// PERMISSÕES DO MICROFONE
// ============================================================
// Permissão válida apenas para a página local do aplicativo e esta janela.
let microphoneAllowed=false;
let microphonePrompt=null;
let microphonePermissionEpoch=0;
function isAppMicrophoneRequest(webContents,details={}) {
  if(!mainWindow || mainWindow.isDestroyed() || !webContents ||
     webContents.isDestroyed() || webContents!==mainWindow.webContents) return false;
  const isIndex=url=>{
    try {
      const parsed=new URL(url);
      return parsed.protocol==='file:' &&
        path.resolve(fileURLToPath(parsed))===path.resolve(__dirname,'index.html');
    } catch(error) { return false; }
  };
  if(!isIndex(webContents.getURL())) return false;
  // Nunca concede a frames remotos embutidos na página local.
  if(details.isMainFrame===false) return false;
  if(details.requestingUrl && !isIndex(details.requestingUrl)) return false;
  if(details.securityOrigin && details.securityOrigin!=='file://' &&
     details.securityOrigin!=='file:///' && !isIndex(details.securityOrigin)) return false;
  return true;
}
function microphoneSystemStatus() {
  if(process.platform!=='win32' && process.platform!=='darwin') return 'unknown';
  try { return systemPreferences.getMediaAccessStatus('microphone'); }
  catch(error) { return 'unknown'; }
}
async function showSystemMicrophoneBlocked(owner) {
  const windows=process.platform==='win32';
  const answer=await dialog.showMessageBox(owner,{
    type:'warning',title:'Trend Ops — Microfone bloqueado',
    message:'O sistema bloqueou o acesso ao microfone.',
    detail:windows
      ? 'Ative Acesso ao microfone e Permitir que aplicativos da área de trabalho acessem o microfone. Depois volte ao Trend Ops e clique em TESTAR MICROFONE.'
      : 'Abra Privacidade e Segurança > Microfone, permita o Trend Ops e reinicie o aplicativo se o sistema solicitar.',
    buttons:['Abrir configurações','Cancelar'],defaultId:0,cancelId:1,noLink:true
  });
  if(answer.response===0){
    const target=windows?'ms-settings:privacy-microphone'
      :'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
    await shell.openExternal(target).catch(error=>console.error('[Trend Ops] Configurações:',error));
  }
}
async function askAppMicrophonePermission(webContents,details) {
  if(!isAppMicrophoneRequest(webContents,details)) return false;
  const owner=mainWindow;
  const epoch=microphonePermissionEpoch;
  const answer=await dialog.showMessageBox(owner,{
    type:'question',title:'Trend Ops — Acesso ao microfone',
    message:'🎤 Permitir acesso ao microfone?',
    detail:'O Trend Ops usará o microfone selecionado para detectar o bipe do leitor. Você pode parar a captura em DESATIVAR MICROFONE. A autorização vale até fechar esta janela.',
    buttons:['Permitir','Cancelar'],defaultId:0,cancelId:1,noLink:true
  });
  if(answer.response!==0 || epoch!==microphonePermissionEpoch ||
     !isAppMicrophoneRequest(webContents,details)) return false;
  let status=microphoneSystemStatus();
  if(process.platform==='darwin' && status==='not-determined'){
    const granted=await systemPreferences.askForMediaAccess('microphone');
    status=granted?'granted':'denied';
  }
  if(status==='denied' || status==='restricted'){
    await showSystemMicrophoneBlocked(owner);
    return false;
  }
  if(epoch!==microphonePermissionEpoch || !isAppMicrophoneRequest(webContents,details)) return false;
  microphoneAllowed=true;
  return true;
}
function configurePermissions() {
  const ses=session.defaultSession;
  ses.setPermissionCheckHandler((webContents,permission,origin,details={})=>{
    // false antes do consentimento provoca a solicitação real do Chromium.
    if(permission!=='media' || details.mediaType!=='audio') return false;
    return microphoneAllowed && isAppMicrophoneRequest(webContents,details) &&
      !['denied','restricted'].includes(microphoneSystemStatus());
  });
  ses.setPermissionRequestHandler((webContents,permission,callback,details={})=>{
    const types=details.mediaTypes;
    const audioOnly=Array.isArray(types) && types.length>0 && types.every(type=>type==='audio');
    if(permission!=='media' || !audioOnly || !isAppMicrophoneRequest(webContents,details)){
      callback(false);return;
    }
    if(microphoneAllowed && !['denied','restricted'].includes(microphoneSystemStatus())){
      callback(true);return;
    }
    // Pedidos simultâneos compartilham uma única janela de consentimento.
    if(!microphonePrompt){
      microphonePrompt=askAppMicrophonePermission(webContents,details)
        .catch(error=>{console.error('[Trend Ops] Permissão:',error);return false;})
        .finally(()=>{microphonePrompt=null;});
    }
    microphonePrompt.then(granted=>{
      callback(Boolean(granted && isAppMicrophoneRequest(webContents,details)));
    }).catch(()=>callback(false));
  });
}

// ============================================================
// AUTO UPDATE
// ============================================================
// Atualização obrigatória antes de abrir a operação.
const UPDATE_SCREEN = `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<title>Trend Ops — Atualização</title><style>
body{margin:0;background:#0B0F14;color:white;font:20px "Segoe UI",sans-serif;
display:grid;place-items:center;height:100vh}main{width:min(620px,85vw)}
h1{color:#FF6A00;font-size:30px}progress{width:100%;height:24px;accent-color:#FF6A00}
p{line-height:1.5;color:#E5E5E5}</style><main>
<h1 id="title">Verificando atualizações…</h1>
<p id="message">Aguarde antes de iniciar a operação.</p>
<progress id="progress"></progress><p id="detail"></p></main></html>`;
async function updateScreen(title, message, percent) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state = JSON.stringify({ title, message, percent });
  await mainWindow.webContents.executeJavaScript(`(() => {
    const state = ${state};
    document.getElementById('title').textContent = state.title;
    document.getElementById('message').textContent = state.message;
    const bar = document.getElementById('progress');
    if (typeof state.percent === 'number') {
      bar.max = 100; bar.value = state.percent;
      document.getElementById('detail').textContent = Math.round(state.percent) + '%';
    } else { bar.removeAttribute('value'); }
  })()`).catch(() => {});
}
async function configureAutoUpdater() {
  if (updaterConfigured) return;
  updaterConfigured = true;
  const openOperation = () => mainWindow.loadFile(path.join(__dirname, 'index.html'));
  if (!app.isPackaged) { await openOperation(); return; }
  // Decide primeiro; depois baixa mantendo a tela de operação fechada.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', error => {
    console.error('[Trend Ops] Atualização:', error);
  });
  autoUpdater.on('download-progress', progress => {
    void updateScreen('Nova atualização disponível',
      'Atualização obrigatória. Baixando a nova versão…', progress.percent);
  });
  autoUpdater.on('update-downloaded', () => { updateDownloaded = true; });
  let result;
  try {
    result = await checkForUpdatesSafely();
  } catch (error) {
    console.error('[Trend Ops] Verificação indisponível:', error);
    // Sem confirmação de nova versão, mantém a operação offline.
    await openOperation();
    return;
  }
  const nextVersion = result?.updateInfo?.version;
  const currentParts = app.getVersion().split('.').map(Number);
  const nextParts = String(nextVersion || '').split('.').map(Number);
  let newer = false;
  for (let i = 0; i < 3; i++) {
    if (nextParts[i] > currentParts[i]) { newer = true; break; }
    if (nextParts[i] < currentParts[i]) break;
  }
  if (!nextVersion || !newer) {
    await openOperation();
    return;
  }
  await updateScreen('Nova atualização disponível',
    'Versão ' + nextVersion + '. Atualização obrigatória. O aplicativo reiniciará após o download.');
  while (!updateDownloaded) {
    try {
      await autoUpdater.downloadUpdate();
      if (!updateDownloaded) throw new Error('O download não foi concluído.');
    } catch (error) {
      await updateScreen('Não foi possível atualizar',
        'A atualização precisa ser concluída antes de usar o aplicativo.');
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Trend Ops — Atualização obrigatória',
        message: 'Não foi possível baixar a atualização.',
        detail: error?.message || String(error),
        buttons: ['Tentar novamente', 'Fechar aplicativo'],
        defaultId: 0, cancelId: 1, noLink: true
      });
      if (answer.response === 1) { app.quit(); return; }
      await updateScreen('Nova atualização disponível', 'Tentando baixar novamente…');
    }
  }
  await updateScreen('Instalando atualização',
    'O Trend Ops será fechado e reiniciado automaticamente.', 100);
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
}
function configureUpdateIPC() {
  // ----------------------------------------------------------
  // VERIFICAR ATUALIZAÇÃO
  // ----------------------------------------------------------
  ipcMain.handle(
    'trend-update-check',
    async () => {
      if (!app.isPackaged) {
        return {
          ok: false,
          development: true,
          message:
            'Atualizações ficam disponíveis no aplicativo instalado.'
        };
      }
      try {
        await checkForUpdatesSafely();
        return {
          ok: true
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error?.message ||
            String(error)
        };
      }
    }
  );
  // ----------------------------------------------------------
  // BAIXAR ATUALIZAÇÃO
  // ----------------------------------------------------------
  ipcMain.handle(
    'trend-update-download',
    async () => {
      if (!app.isPackaged) {
        return {
          ok: false,
          development: true
        };
      }
      try {
        await autoUpdater.downloadUpdate();
        return {
          ok: true
        };
      } catch (error) {
        console.error(
          '[Trend Ops] Erro download:',
          error
        );
        return {
          ok: false,
          message:
            error?.message ||
            String(error)
        };
      }
    }
  );
  // ----------------------------------------------------------
  // INSTALAR E REINICIAR
  // ----------------------------------------------------------
  ipcMain.handle(
    'trend-update-install',
    async () => {
      if (!app.isPackaged) {
        return {
          ok: false
        };
      }
      if (!updateDownloaded) {
        return { ok: false, message: 'Aguarde o download da atualização terminar.' };
      }
      setImmediate(
        () => {
          autoUpdater.quitAndInstall(
            false,
            true
          );
        }
      );
      return {
        ok: true
      };
    }
  );
  // ----------------------------------------------------------
  // VERSÃO ATUAL
  // ----------------------------------------------------------
  ipcMain.handle(
    'trend-app-version',
    () => {
      return app.getVersion();
    }
  );
}
// ============================================================
// CRIAR JANELA
// ============================================================
function createWindow() {
  microphoneAllowed=false;
  ++microphonePermissionEpoch;
  Menu.setApplicationMenu(null);
  mainWindow =
    new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title:
        `${APP_NAME} • v${APP_VERSION}`,
      backgroundColor:
        '#FFFFFF',
      show: false,
      frame: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload:
          path.join(
            __dirname,
            'preload.js'
          ),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        autoplayPolicy:
          'no-user-gesture-required'
      }
    });
  // ==========================================================
  // INDEX
  // ==========================================================
  const indexPath =
    path.join(
      __dirname,
      'index.html'
    );
  console.log(
    '[Trend Ops] Abrindo:',
    indexPath
  );
  const loading=app.isPackaged?mainWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(UPDATE_SCREEN)):mainWindow.loadFile(indexPath);
  loading.then(()=>{if(app.isPackaged)return configureAutoUpdater();}).catch(error=>{console.error('[Trend Ops] Inicialização:',error);dialog.showErrorBox('Trend Ops',error.message);});
  // ==========================================================
  // PRONTO
  // ==========================================================
  mainWindow.once(
    'ready-to-show',
    () => {
      mainWindow.maximize();
      mainWindow.show();
      mainWindow.focus();

    }
  );
  // ==========================================================
  // CONSOLE DO RENDERER
  // ==========================================================
  mainWindow.webContents.on('console-message',event=>{if(/micro|audio|update/i.test(event.message||''))console.log('[Trend Ops Renderer]',event.message);});
  // ==========================================================
  // BLOQUEAR POPUPS
  // ==========================================================
  mainWindow
    .webContents
    .setWindowOpenHandler(
      () => {
        return {
          action: 'deny'
        };
      }
    );
  // ==========================================================
  // BLOQUEAR ZOOM ACIDENTAL
  // ==========================================================
  mainWindow.webContents.on(
    'before-input-event',
    (
      event,
      input
    ) => {
      if (
        input.control &&
        (
          input.key === '+' ||
          input.key === '-' ||
          input.key === '=' ||
          input.key === '0'
        )
      ) {
        event.preventDefault();
      }
    }
  );
  mainWindow
    .webContents
    .setZoomFactor(1);
  // ==========================================================
  // FECHOU
  // ==========================================================
  mainWindow.on(
    'closed',
    () => {
      microphoneAllowed=false;
      ++microphonePermissionEpoch;
      mainWindow = null;
    }
  );
}
// ============================================================
// ELECTRON PRONTO
// ============================================================
app
  .whenReady()
  .then(
    async () => {
      console.log(
        `[Trend Ops] ${APP_NAME} v${APP_VERSION}`
      );
      console.log(
        '[Trend Ops] Plataforma:',
        process.platform
      );
      // Microfone
      configurePermissions();
      // Comunicação do atualizador
      configureUpdateIPC();
      const authorized=e=>isAppMicrophoneRequest(e.sender,{isMainFrame:e.senderFrame===e.sender.mainFrame,requestingUrl:e.senderFrame?.url});
      ipcMain.handle('trend-microphone-status',e=>authorized(e)?{ok:true,allowed:microphoneAllowed,status:microphoneSystemStatus(),version:APP_VERSION,packaged:app.isPackaged,revision:'PHONE30',platform:process.platform}:{ok:false});
      ipcMain.handle('trend-microphone-permission',async e=>{if(!authorized(e))return {ok:false,message:'Origem não autorizada.'};const granted=microphoneAllowed||await askAppMicrophonePermission(e.sender,{isMainFrame:true});return {ok:granted,allowed:granted,status:microphoneSystemStatus()};});
      registerPhoneIPC({app,dialog,shell,safeStorage,ipcMain,getWindow:()=>mainWindow,authorize:authorized});
      // Janela
      createWindow();
      app.on(
        'activate',
        () => {
          if (
            BrowserWindow
              .getAllWindows()
              .length === 0
          ) {
            createWindow();
          }
        }
      );
    }
  );
// ============================================================
// FECHAR APLICATIVO
// ============================================================
app.on(
  'window-all-closed',
  () => {
    if (
      process.platform !==
      'darwin'
    ) {
      app.quit();
    }
  }
);
