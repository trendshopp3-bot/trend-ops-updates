'use strict';
const fs=require('fs'),path=require('path'),https=require('https'),crypto=require('crypto');
const {execFile}=require('child_process');
function endpoint(value){
 if(typeof value!=='string')throw Error('Informe IP:porta.');const m=value.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);if(!m)throw Error('Use IP:porta, por exemplo 192.168.15.26:41557.');
 const oct=m[1].split('.').map(Number),port=Number(m[2]);if(oct.some(x=>x>255)||port<1||port>65535||!(oct[0]===10||(oct[0]===192&&oct[1]===168)||(oct[0]===172&&oct[1]>=16&&oct[1]<=31)))throw Error('Informe o endereço da rede local mostrado no celular.');return m[1]+':'+port;
}
function code(value){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))throw Error('Código inválido. Use até 128 letras, números, pontos, traços ou sublinhados.');return value;}
function execute(file,args,timeout=15000){return new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout,maxBuffer:1024*1024},(error,stdout,stderr)=>{if(error){const e=Error((stderr||stdout||error.message).trim().slice(0,1000));e.timedOut=!!error.killed;reject(e);}else resolve((stdout+'\n'+stderr).trim());}));}
function createPhoneBridge({app,dialog,shell,getWindow,safeStorage,exec=execute}){
 const root=path.join(app.getPath('userData'),'phone-tools'),settings=path.join(app.getPath('userData'),'phone-connection.json');
 const {DRIVERS,createVault}=require('./imile-drivers');const vault=createVault({directory:app.getPath('userData'),safeStorage});let activeDriver=null;
 let selected='',generation=0,queue=Promise.resolve(),installing=null;const operations=new Map();
 let jetDriverCache={serial:'',field:null,size:null};
 let jetJmsLastLength=0,jetEntradaLastLength=0,jetDriverLastLength=0;
 let jetEntradaConfirmPoint=null;
 let custom='';try{const data=JSON.parse(fs.readFileSync(settings,'utf8'));custom=data.adbPath||'';selected=data.serial||'';}catch{}
 let usbWifiBusy=false,lastUsbWifiAttempt=0,lastUsbWifiSerial='';
 function save(){fs.mkdirSync(path.dirname(settings),{recursive:true});fs.writeFileSync(settings,JSON.stringify({adbPath:custom,serial:selected}));}
 function adb(){const candidates=[custom,path.join(__dirname,'platform-tools','adb.exe'),path.join(process.resourcesPath||__dirname,'platform-tools','adb.exe'),path.join(root,'platform-tools','adb.exe')];const file=candidates.find(f=>f&&fs.existsSync(f));if(!file)throw Error('Prepare a conexão: clique em Instalar ferramenta ou Localizar pasta.');return file;}
 function shellQuote(value){
  const text=String(value??'');
  return "'"+text.replace(/'/g, "'\\''")+"'";
 }
 async function run(args,timeout){
  const out=await exec(adb(),args,timeout);
  if(/SecurityException|INJECT_EVENTS|Exception occurred|error: device/i.test(out))throw Error(out.slice(0,1000));
  return out;
 }
 async function status(){
  let file;try{file=adb();}catch(e){return {ok:true,installed:false,devices:[],selected:'',message:e.message};}
  const output=await run(['devices','-l']);const devices=output.split(/\r?\n/).map(line=>line.match(/^([A-Za-z0-9_.:-]+)\s+(device|offline|unauthorized)\b(.*)$/)).filter(Boolean).map(m=>({serial:m[1],state:m[2],model:m[3].match(/model:(\S+)/)?.[1]||m[1]}));
  const online=devices.filter(d=>d.state==='device');if((!selected||!online.some(d=>d.serial===selected))&&online.length===1){selected=online[0].serial;save();}
  return {ok:true,installed:true,adbPath:file,devices,selected,connected:online.some(d=>d.serial===selected)};
 }
 async function pair({address,pairingCode}){const target=endpoint(address);if(!/^\d{6}$/.test(String(pairingCode)))throw Error('Digite os 6 números da janela de pareamento.');const output=await run(['pair',target,String(pairingCode)],20000);if(!/Successfully paired/i.test(output))throw Error('Pareamento não confirmado. Abra uma nova janela de código no celular e use IP, porta e código novos.');return {ok:true,message:'Pareado. Agora verifique a conexão ou use a porta da tela principal.'};}
 async function connect({address}){const target=endpoint(address),output=await run(['connect',target],15000);if(!/connected to/i.test(output))throw Error(output||'Conexão não confirmada. Use a porta da tela principal de Depuração sem fio.');return status();}
 async function usbWifiIp(serial){
  const outputs=[];
  for(const args of [
   ['-s',serial,'shell','ip','-f','inet','addr','show','wlan0'],
   ['-s',serial,'shell','ip','addr','show','wlan0'],
   ['-s',serial,'shell','ip','route']
  ]){
   try{outputs.push(await run(args,6000));}catch{}
  }
  for(const out of outputs){
   const matches=[...String(out||'').matchAll(/\b(?:src\s+|inet\s+)(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)/g)];
   if(matches.length)return matches[matches.length-1][1];
  }
  throw Error('Não consegui descobrir o IP Wi-Fi do celular. Confirme que PC e celular estão na mesma rede Wi-Fi.');
 }
 async function autoUsbWifi({force=false}={}){
  if(usbWifiBusy)return {ok:true,busy:true,message:'Conexão USB → Wi-Fi já está sendo preparada.'};
  const now=Date.now();
  if(!force&&now-lastUsbWifiAttempt<1800)return status();
  lastUsbWifiAttempt=now;
  let s=await status();
  if(!s.installed)return s;
  const online=s.devices.filter(d=>d.state==='device');
  const network=online.find(d=>/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(d.serial));
  if(network){
   if(selected!==network.serial){selected=network.serial;save();s=await status();}
   return {...s,autoUsbWifi:true,message:'Celular conectado automaticamente por Wi-Fi • '+network.serial};
  }
  const usb=online.find(d=>!d.serial.includes(':')&&!/^emulator-/i.test(d.serial));
  if(!usb)return {...s,autoUsbWifi:false,message:'Conecte o celular pelo USB e aceite “Permitir depuração USB”.'};
  usbWifiBusy=true;
  try{
   const ip=await usbWifiIp(usb.serial);
   const target=ip+':5555';
   // Primeiro colocamos o daemon ADB em TCP/IP. O IP é lido ANTES porque o daemon reinicia.
   const tcp=await run(['-s',usb.serial,'tcpip','5555'],12000).catch(e=>{throw Error('Não foi possível ativar ADB por Wi-Fi pelo USB. '+e.message);});
   if(!/restarting in TCP mode|tcpip|5555/i.test(tcp||'')){
    // Alguns ADBs retornam pouco texto; ainda tentamos conectar normalmente.
   }
   await new Promise(r=>setTimeout(r,750));
   let connected=false,last='';
   for(let attempt=0;attempt<4&&!connected;attempt++){
    try{
     last=await run(['connect',target],7000);
     connected=/connected to|already connected to/i.test(last);
    }catch(error){last=error.message||String(error);}
    if(!connected)await new Promise(r=>setTimeout(r,450));
   }
   if(!connected)throw Error('O USB foi detectado, mas não consegui concluir a conexão Wi-Fi em '+target+'. '+String(last).slice(0,240));
   selected=target;lastUsbWifiSerial=usb.serial;save();
   await new Promise(r=>setTimeout(r,250));
   s=await status();
   return {...s,autoUsbWifi:true,usbSerial:usb.serial,wifiTarget:target,message:'✓ Wi-Fi ativado automaticamente pelo USB • '+target+' • o cabo pode ser removido.'};
  }finally{usbWifiBusy=false;}
 }
 async function select({serial}){const s=await status();if(!s.devices.some(d=>d.serial===serial&&d.state==='device'))throw Error('Selecione um celular conectado.');activeDriver=null;jetDriverCache={serial:'',field:null,size:null};jetJmsLastLength=0;jetEntradaLastLength=0;jetDriverLastLength=0;jetEntradaConfirmPoint=null;require('./imile-ui').reset();selected=serial;save();return status();}
 function cancel(){generation++;activeDriver=null;jetDriverCache={serial:'',field:null,size:null};jetJmsLastLength=0;jetEntradaLastLength=0;jetDriverLastLength=0;jetEntradaConfirmPoint=null;require('./imile-ui').reset();return {ok:true};}
 const normalizeText=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
 async function readUiXml(serial,remote,check){
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
   try{
    // Não mistura redirecionamento/; no mesmo argumento do `adb shell`.
    // Em alguns aparelhos/versões do ADB isso falhava no Windows.
    await run(['-s',serial,'shell','uiautomator','dump',remote],7000);check();
    const xml=await run(['-s',serial,'shell','cat',remote],4500);check();
    if(xml.includes('<hierarchy'))return xml;
    lastError=Error('A árvore da tela ainda não ficou pronta.');
   }catch(error){lastError=error;}
   if(attempt<2){await new Promise(r=>setTimeout(r,120));check();}
  }
  throw Error('Não foi possível ler a tela do celular. '+(lastError?.message||'Tente novamente.'));
 }
 const nodeLabel=node=>[node?.text,node?.['content-desc']].filter(Boolean).join(' ').trim();
 const nodeBounds=node=>{const b=String(node?.bounds||'').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);return b?{x1:+b[1],y1:+b[2],x2:+b[3],y2:+b[4],cx:Math.round((+b[1]+ +b[3])/2),cy:Math.round((+b[2]+ +b[4])/2)}:null;};
 async function jetJmsField(serial,check){
  const xml=await readUiXml(serial,'/sdcard/trend-jet-jms.xml',check);
  if(!xml.includes('<hierarchy'))throw Error('Não foi possível ler a tela. Abra a tela “FM bipagem de coleta” da JeT.');
  const list=require('./imile-ui').nodes(xml);
  const labels=list.filter(n=>normalizeText(nodeLabel(n)).includes('numero de pedido jms')&&n.point);
  if(!labels.length)throw Error('Campo “Número de pedido JMS” não encontrado. Abra a tela de saída para caminhoneiro no celular.');
  const labelNode=labels.sort((a,b)=>(nodeBounds(a)?.y1||0)-(nodeBounds(b)?.y1||0))[0],lb=nodeBounds(labelNode);
  const editables=list.filter(n=>(/EditText$/.test(n.class||'')||n.editable==='true')&&n.enabled!=='false'&&n.point);
  let field=null;
  if(editables.length&&lb){
   field=editables.map(n=>({n,b:nodeBounds(n)})).filter(x=>x.b).sort((a,b)=>{
    const ay=Math.abs(a.b.cy-lb.cy),by=Math.abs(b.b.cy-lb.cy);
    const ax=Math.abs(a.b.cx-lb.cx),bx=Math.abs(b.b.cx-lb.cx);return ay-by||ax-bx;
   })[0]?.n||null;
  }
  // Algumas versões da JeT desenham a linha como controle customizado, sem EditText.
  // Nesse caso, tocar no próprio texto “Número de pedido JMS” abre/foca a entrada.
  const point=field?.point||labelNode.point;
  if(!point)throw Error('O campo JMS foi reconhecido, mas não está acessível para toque.');
  return {point,label:nodeLabel(labelNode)};
 }
 async function jetEntradaWaitConfirm(serial,check,size){
  // Depois de digitar o código, a JeT troca o cabeçalho e exibe "Confirmar".
  // Só clicamos quando esse texto realmente existir, evitando tocar em
  // "Excluir registro de bipagem" antes da hora.
  let lastText='';
  for(let attempt=0;attempt<10;attempt++){
   await new Promise(r=>setTimeout(r,attempt===0?180:120));check();
   try{
    const xml=await readUiXml(serial,'/sdcard/trend-jet-entrada-confirm.xml',check);
    const list=require('./imile-ui').nodes(xml);
    const confirm=list.find(n=>{
     const label=normalizeText(nodeLabel(n));
     return n.point && (label==='confirmar'||label.startsWith('confirmar '));
    });
    lastText=list.map(n=>normalizeText(nodeLabel(n))).filter(Boolean).join(' | ').slice(0,1200);
    if(confirm){
     await jetDriverTap(serial,confirm.point[0],confirm.point[1],check);
     await new Promise(r=>setTimeout(r,110));check();
     return {ok:true,point:confirm.point,label:nodeLabel(confirm)};
    }
   }catch(error){
    lastText=error?.message||String(error);
   }
  }
  throw Error('O código foi digitado, mas o botão “Confirmar” ainda não apareceu na JeT Entrada Galpão. Aguarde a tela reagir e tente novamente. '+lastText.slice(0,220));
 }

 async function jetEntradaConfirmSafe(serial,check,size){
  /*
   * A JeT pode "panear" a janela para cima quando o JMS recebe foco.
   * Nesse estado o Confirmar pode encostar na faixa escura/câmera.
   * Localizamos o botão DEPOIS da digitação e escolhemos um ponto dentro
   * do próprio botão, mas abaixo da área superior reservada do Android.
   */
  const safeTop=Math.max(54,Math.round(size.height*.045));
  const fallbackX=Math.round(size.width*.86);
  let last='';

  for(let attempt=0;attempt<4;attempt++){
   await new Promise(r=>setTimeout(r,attempt===0?90:75));check();
   try{
    const xml=await readUiXml(serial,'/sdcard/trend-jet-entrada-safe.xml',check);
    const list=require('./imile-ui').nodes(xml);
    const candidates=list.filter(n=>{
      const label=normalizeText(nodeLabel(n));
      const b=nodeBounds(n);
      return b && n.enabled!=='false' && (label==='confirmar'||label.startsWith('confirmar ')) && b.cy<size.height*.24;
    }).sort((a,b)=>(nodeBounds(a)?.cy||99999)-(nodeBounds(b)?.cy||99999));
    const confirm=candidates[0];
    last=list.map(n=>normalizeText(nodeLabel(n))).filter(Boolean).join(' | ').slice(0,900);
    if(confirm){
      const b=nodeBounds(confirm);
      // Preferimos a parte inferior do botão, longe do recorte/câmera.
      const minY=Math.max(b.y1+4,safeTop+6);
      const maxY=b.y2-5;
      if(maxY>=minY){
        const point=[Math.round((b.x1+b.x2)/2),Math.round(Math.min(maxY,Math.max(minY,b.cy)))];
        jetEntradaConfirmPoint=point;
        await jetDriverTap(serial,point[0],point[1],check);
        await new Promise(r=>setTimeout(r,85));check();
        return {ok:true,point,label:nodeLabel(confirm),safeTop,mode:'detected-safe'};
      }
      // Se o botão inteiro ficou por trás da faixa superior, ESC tenta
      // recolher o IME/pan sem navegar para a tela anterior (não usamos BACK).
      await run(['-s',serial,'shell','input','keyevent','KEYCODE_ESCAPE'],2500).catch(()=>{});check();
      await new Promise(r=>setTimeout(r,95));check();
      continue;
    }
   }catch(error){last=error?.message||String(error);}
  }

  // Se já calibramos um ponto seguro anteriormente, ele é preferível a
  // voltar para a coordenada antiga que podia cair na área da câmera.
  if(jetEntradaConfirmPoint){
    const [x,y]=jetEntradaConfirmPoint;
    await jetDriverTap(serial,x,Math.max(y,safeTop+6),check);
    await new Promise(r=>setTimeout(r,85));check();
    return {ok:true,point:[x,Math.max(y,safeTop+6)],safeTop,mode:'cached-safe'};
  }

  // Fallback final sempre abaixo da área escura superior.
  const y=Math.max(safeTop+12,Math.round(size.height*.075));
  await jetDriverTap(serial,fallbackX,y,check);
  await new Promise(r=>setTimeout(r,85));check();
  return {ok:true,point:[fallbackX,y],safeTop,mode:'safe-fallback',debug:last.slice(0,180)};
 }

 async function sendJetJms(serial,value,check,screen='saida'){
  const size=await jetDriverScreenSize(serial,check);
  const entrada=screen==='entrada-galpao';
  const previous=entrada?jetEntradaLastLength:jetJmsLastLength;
  const dels=jetDeleteKeys(previous,value.length);

  if(entrada){
   /*
    * JeT Entrada Galpão — modo ULTRA depois da primeira calibração.
    * A primeira etiqueta localiza o Confirmar com segurança. A partir daí,
    * reutilizamos o ponto já aprovado e fazemos TODO o ciclo em um único
    * adb shell: foco -> limpar -> código inteiro -> Confirmar -> próximo.
    * Não há uiautomator por etiqueta depois da calibração.
    */
   const x=Math.round(size.width*.50);
   const y=Math.round(size.height*.676);

   if(jetEntradaConfirmPoint){
    const sx=Math.round(jetEntradaConfirmPoint[0]);
    const sy=Math.round(jetEntradaConfirmPoint[1]);
    await jetFastBatch(serial,[
     `input tap ${x} ${y}`,
     'sleep 0.015',
     'input keyevent KEYCODE_MOVE_END',
     `input keyevent ${dels}`,
     `input text ${value}`,
     'sleep 0.045',
     `input tap ${sx} ${sy}`,
     'sleep 0.035'
    ],check,3500);

    jetEntradaLastLength=value.length;
    return {ok:true,delivered:true,submitted:true,confirmed:true,processed:true,outcome:'sent',code:value,
     field:'JeT Entrada Galpão • Número do pedido JMS / lote',
     confirmPoint:[sx,sy],
     confirmMode:'cached-ultra',
     message:'✓ Código inserido e Confirmar acionado em modo ultra-rápido.'};
   }

   // Primeira etiqueta da sessão: calibra uma única vez a posição segura
   // do Confirmar depois que a tela sobe. As próximas não repetem essa leitura.
   await jetFastBatch(serial,[
    `input tap ${x} ${y}`,
    'sleep 0.025',
    'input keyevent KEYCODE_MOVE_END',
    `input keyevent ${dels}`,
    `input text ${value}`,
    'sleep 0.080'
   ],check,4000);

   const confirmed=await jetEntradaConfirmSafe(serial,check,size);
   jetEntradaConfirmPoint=confirmed.point;
   jetEntradaLastLength=value.length;
   return {ok:true,delivered:true,submitted:true,confirmed:true,processed:true,outcome:'sent',code:value,
    field:'JeT Entrada Galpão • Número do pedido JMS / lote',
    confirmPoint:confirmed.point,
    confirmMode:'first-calibration',
    message:'✓ Confirmar calibrado. Próximos códigos usarão modo ultra-rápido.'};
  }

  // JeT Saída permanece exatamente no fluxo já testado e funcionando.
  const x=Math.round(size.width*.50);
  const y=Math.round(size.height*.445);
  const sx=Math.round(size.width*.865);
  const sy=Math.round(size.height*.073);
  await jetFastBatch(serial,[
   `input tap ${x} ${y}`,
   'sleep 0.015',
   'input keyevent KEYCODE_MOVE_END',
   `input keyevent ${dels}`,
   `input text ${value}`,
   'sleep 0.015',
   `input tap ${sx} ${sy}`,
   'sleep 0.040'
  ],check,5000);
  jetJmsLastLength=value.length;
  return {ok:true,delivered:true,submitted:true,confirmed:true,processed:true,outcome:'sent',code:value,
   field:'JeT Saída • Número do pedido JMS / lote',
   message:'✓ Código digitado e Confirmar do topo acionado. Seguindo para o próximo.'};
 }
 async function jetDriverField(serial,check){
  /*
   * JeT Motorista — campo fixo por coordenada.
   * Nesta tela (Bipagem de recebimento), o campo Nº da guia/pacote
   * permanece sempre na faixa superior. Não usamos uiautomator aqui:
   * evita falha de reconhecimento e elimina o gargalo do XML.
   */
  if(jetDriverCache.serial===serial&&jetDriverCache.field)return jetDriverCache.field;
  const size=await jetDriverScreenSize(serial,check);
  const point=[Math.round(size.width*.55),Math.round(size.height*.152)];
  const result={point,label:'Nº da guia/pacote • posição fixa'};
  jetDriverCache={...jetDriverCache,serial,field:result};
  return result;
 }
 async function jetDriverScreenSize(serial,check){
  if(jetDriverCache.serial===serial&&jetDriverCache.size)return jetDriverCache.size;
  const out=await run(['-s',serial,'shell','wm','size'],5000);check();
  const matches=[...String(out||'').matchAll(/(?:Physical|Override)?\s*size:\s*(\d+)x(\d+)/gi)];
  const m=matches[matches.length-1]||String(out||'').match(/(\d+)x(\d+)/);
  const result=m?{width:Number(m[1]),height:Number(m[2])}:{width:720,height:1600};jetDriverCache={...jetDriverCache,serial,size:result};return result;
 }
 async function jetDriverTap(serial,x,y,check){
  x=Number(x);y=Number(y);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0)throw Error('Coordenada de toque inválida bloqueada.');
  await run(['-s',serial,'shell','input','tap',String(Math.round(x)),String(Math.round(y))]);check();
 }
 async function jetFastBatch(serial,commands,check,timeout=5000){
  // Um único `adb shell` por pacote reduz drasticamente o custo de criar vários processos adb.exe.
  const script=commands.map(v=>String(v||'').trim()).filter(Boolean).join('; ');
  await run(['-s',serial,'shell','sh','-c',shellQuote(script)],timeout);check();
 }
 function jetDeleteKeys(previousLength,nextLength){
  // Apaga somente o necessário. 128 DEL por código era um dos maiores gargalos em filas grandes.
  const count=Math.min(128,Math.max(18,Number(previousLength||0)+4,Number(nextLength||0)+4));
  return Array(count).fill('KEYCODE_DEL').join(' ');
 }
 async function jetDriverSubmit(serial,check){
  const size=await jetDriverScreenSize(serial,check);
  // Modo turbo: o botão Confirmar do cabeçalho é fixo nesta tela.
  await jetDriverTap(serial,size.width*.865,size.height*.073,check);
  await new Promise(r=>setTimeout(r,30));check();
  return size;
 }
 async function jetDriverConfirm(serial,check,sizeHint){
  const size=sizeHint||await jetDriverScreenSize(serial,check);
  /*
   * JET MOTORISTA ULTRA-RÁPIDO
   *
   * O gargalo anterior era o `uiautomator dump` após CADA pacote. Em muitos
   * aparelhos ele leva centenas de ms (ou segundos), apesar de o popup usar
   * sempre o mesmo botão CONFIRMAR na mesma região da tela.
   *
   * Agora o fluxo operacional não espera a árvore de acessibilidade:
   *   Confirmar do topo -> pequenos pulsos no CONFIRMAR do popup -> próximo.
   * Os toques antecipados caem em uma área vazia quando o popup ainda não
   * apareceu e são repetidos por uma janela curta para pegar respostas tardias.
   */
  const x=size.width*.50, y=size.height*.55;
  const pulses=[70,70,80,95];
  for(const wait of pulses){
    await new Promise(r=>setTimeout(r,wait));check();
    await jetDriverTap(serial,x,y,check).catch(()=>{});
  }
  await new Promise(r=>setTimeout(r,25));check();
  return {confirmed:true,outcome:'confirmed',message:'Resultado confirmado em modo ultra-rápido. Seguindo.'};
 }
 async function sendJetDriver(serial,value,check){
  const target=await jetDriverField(serial,check);
  const size=await jetDriverScreenSize(serial,check);
  const fx=Math.round(target.point[0]),fy=Math.round(target.point[1]);
  const sx=Math.round(size.width*.865),sy=Math.round(size.height*.073);
  const px=Math.round(size.width*.50),py=Math.round(size.height*.55);
  const dels=jetDeleteKeys(jetDriverLastLength,value.length);
  // 4K FAST: digitação + Confirmar do topo + pulsos do popup em UM processo ADB.
  await jetFastBatch(serial,[
   `input tap ${fx} ${fy}`,
   'sleep 0.012',
   'input keyevent KEYCODE_MOVE_END',
   `input keyevent ${dels}`,
   `input text ${value}`,
   'sleep 0.012',
   `input tap ${sx} ${sy}`,
   'sleep 0.055',
   `input tap ${px} ${py}`,
   'sleep 0.060',
   `input tap ${px} ${py}`,
   'sleep 0.075',
   `input tap ${px} ${py}`,
   'sleep 0.015'
  ],check,5000);
  jetDriverLastLength=value.length;
  return {ok:true,delivered:true,submitted:true,confirmed:true,processed:true,outcome:'confirmed',code:value,field:target.label,message:'Resultado confirmado em modo 4K rápido. Seguindo.',detail:''};
 }
 function send(request){
  const value=code(request.code),id=String(request.id||crypto.randomUUID());if(!/^[A-Za-z0-9_:.-]{1,220}$/.test(id))throw Error('Identificador de envio inválido.');
  if(operations.has(id))return operations.get(id);
  const expected=generation;const job=queue.catch(()=>{}).then(async()=>{
   const check=()=>{if(expected!==generation)throw Error('Envio cancelado por pausa ou parada.');};check();
   // FAST PATH: a fila já valida a conexão uma vez ao iniciar. Durante a sequência
   // reutilizamos o serial selecionado e evitamos `adb devices -l` em CADA etiqueta.
   // Se o aparelho cair, o próprio comando ADB falha e a fila pausa.
   if(request.workflow==='imile'&&activeDriver&&(!request.driverLogin||activeDriver.login===request.driverLogin)){
    return require('./imile-ui').transact({run,serial:activeDriver.serial,value,check,expectedDriver:request.driverLogin,forceAudit:request.forceAudit===true});
   }
   if(request.workflow==='jet-jms'&&selected){
    return sendJetJms(selected,value,check,request.screen||'saida');
   }
   if(request.workflow==='jet-driver'&&selected){
    return sendJetDriver(selected,value,check);
   }
   const s=await status();check();if(!s.connected)throw Error('Celular desconectado. Reconecte antes de continuar.');
   const serial=s.selected;if(request.workflow==='imile'){if(request.driverLogin&&(!activeDriver||activeDriver.serial!==serial||activeDriver.login!==request.driverLogin))throw Error('Confirme o motorista antes de enviar esta etiqueta.');return require('./imile-ui').transact({run,serial,value,check,expectedDriver:request.driverLogin,forceAudit:request.forceAudit===true});}
   if(request.workflow==='jet-jms')return sendJetJms(serial,value,check,request.screen||'saida');
   if(request.workflow==='jet-driver')return sendJetDriver(serial,value,check);
   let entered=false,typed=false;
   try{
    if(request.clearField!==false){await run(['-s',serial,'shell','input','keyevent','KEYCODE_MOVE_END']);check();await run(['-s',serial,'shell','input','keyevent',...Array(128).fill('KEYCODE_DEL')]);check();}
    await run(['-s',serial,'shell','input','text',value]);typed=true;check();
    if(request.enter){entered=true;await run(['-s',serial,'shell','input','keyevent','KEYCODE_ENTER']);check();}
    return {ok:true,delivered:true,submitted:!!request.enter,confirmed:false,code:value,id,message:request.enter?'Código e Enter enviados. Aguardando retorno da iMile.':'Código digitado no celular.'};
   }catch(error){error.message=(entered?'O Enter pode ter sido enviado. Confira o celular antes de repetir. ':typed?'O código foi digitado, mas o Enter não foi confirmado. ':'')+error.message;error.uncertain=entered;throw error;}
  });queue=job;const safe=job.catch(e=>({ok:false,message:e.message,uncertain:!!e.uncertain,id}));operations.set(id,safe);if(operations.size>1000)operations.delete(operations.keys().next().value);return safe;
 }

 async function conferenceDump(serial,check){
  let xml='';
  try{
   xml=await run(['-s',serial,'exec-out','uiautomator','dump','--compressed','/dev/tty'],6500);check();
  }catch{}
  if(!String(xml).includes('<hierarchy'))xml=await readUiXml(serial,'/sdcard/trend-conferencia.xml',check);
  if(!String(xml).includes('<hierarchy'))throw Error('Não foi possível analisar a tela do celular.');
  return String(xml);
 }
 function conferenceExtract(xml){
  const list=require('./imile-ui').nodes(xml),codes=new Set(),parts=[];
  for(const n of list){
   const label=[n.text,n['content-desc']].filter(Boolean).join(' ').trim();
   if(!label)continue;
   parts.push(label+'@'+String(n.bounds||''));
   // Códigos operacionais usados nos PDFs são numéricos. Aceita 8–20 dígitos
   // e tolera espaços/pontos/traços visuais dentro do texto.
   for(const m of label.matchAll(/(?:^|\D)(\d[\d .-]{6,26}\d)(?=\D|$)/g)){
    const value=String(m[1]||'').replace(/\D/g,'');
    if(value.length>=8&&value.length<=20)codes.add(value);
   }
  }
  const bounds=list.map(n=>n.rect).filter(Boolean);
  const width=Math.max(0,...bounds.map(b=>b.x2))||720,height=Math.max(0,...bounds.map(b=>b.y2))||1600;
  const fingerprint=crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0,20);
  return {codes:[...codes],fingerprint,width,height,visibleNodes:list.length};
 }
 async function conferenceStableSnapshot(serial,check,reads=2){
  const codes=new Set(),fingerprints=[];let last=null;
  const total=Math.max(2,Math.min(3,Number(reads)||2));
  for(let i=0;i<total;i++){
   const xml=await conferenceDump(serial,check),snap=conferenceExtract(xml);check();last=snap;
   for(const c of snap.codes||[])codes.add(c);
   fingerprints.push(snap.fingerprint||'');
   if(i<total-1){await new Promise(r=>setTimeout(r,120));check();}
  }
  const fingerprint=crypto.createHash('sha1').update(fingerprints.join('|')+'|'+[...codes].sort().join(',')).digest('hex').slice(0,20);
  return {...last,codes:[...codes],fingerprint};
 }
 async function conferenceStep({direction='none',duration=300}={}){
  const s=await status();if(!s.connected)throw Error('Celular desconectado. Conecte antes de iniciar a conferência.');
  const serial=s.selected,expected=generation;
  const check=()=>{if(expected!==generation)throw Error('Conferência interrompida.');};check();

  // MODO COMPLETO: a lista precisa estar parada antes de ser lida.
  await new Promise(r=>setTimeout(r,220));check();
  const before=await conferenceStableSnapshot(serial,check,2);check();
  if(direction!=='down'&&direction!=='up')return {ok:true,...before,direction};

  const x=Math.round(before.width*.50);
  // Rolagem curta (~14–15% da altura), deixando ampla sobreposição entre telas.
  const fromY=direction==='down'?Math.round(before.height*.70):Math.round(before.height*.44);
  const toY=direction==='down'?Math.round(before.height*.555):Math.round(before.height*.585);
  const ms=Math.max(260,Math.min(560,Number(duration)||300));
  await run(['-s',serial,'shell','input','swipe',String(x),String(fromY),String(x),String(toY),String(ms)],5000);check();

  // Espera a lista terminar a animação/renderização antes de capturar novamente.
  await new Promise(r=>setTimeout(r,direction==='down'?520:420));check();
  const after=await conferenceStableSnapshot(serial,check,2);check();

  // Une leitura anterior + posterior. Um código na borda entra em pelo menos uma delas.
  const codes=[...new Set([...(before.codes||[]),...(after.codes||[])])];
  return {ok:true,...after,codes,direction,visibleBefore:before.visibleNodes,visibleAfter:after.visibleNodes};
 }
 async function doNotDisturb({enabled=true}={}){
  const s=await status();
  if(!s.connected)throw Error('Celular desconectado. Conecte antes de iniciar a bipagem.');
  const serial=s.selected;
  const target=enabled?'priority':'all';
  let commandOk=false,lastError='';
  try{await run(['-s',serial,'shell','cmd','notification','set_dnd',target],5000);commandOk=true;}catch(error){lastError=error?.message||String(error);}
  if(enabled&&!commandOk){
   try{await run(['-s',serial,'shell','settings','put','global','zen_mode','1'],5000);commandOk=true;}catch(error){lastError=error?.message||String(error);}
  }else if(!enabled&&!commandOk){
   try{await run(['-s',serial,'shell','settings','put','global','zen_mode','0'],5000);commandOk=true;}catch(error){lastError=error?.message||String(error);}
  }
  let mode='';
  try{mode=String(await run(['-s',serial,'shell','settings','get','global','zen_mode'],4000)).trim();}catch{}
  const n=Number.parseInt(mode,10);
  const active=Number.isFinite(n)?n>0:commandOk&&enabled;
  if(enabled&&active)return {ok:true,enabled:true,mode:Number.isFinite(n)?n:null,message:'Não Perturbe ativado automaticamente no celular.'};
  if(!enabled&&!active)return {ok:true,enabled:false,mode:Number.isFinite(n)?n:null,message:'Não Perturbe desativado.'};
  return {ok:false,enabled:active,needsUser:true,message:'Não foi possível alterar o Não Perturbe automaticamente neste Android.'+(lastError?' '+lastError.slice(0,180):'')};
 }
 function driverSettings(){return vault.settings();}
 function driverPassword(payload){return vault.save(payload);}
 function prepareDriver({login,startAtLogin=false}){
  if(!DRIVERS.some(d=>d.login===login))throw Error('Selecione um motorista cadastrado.');
  const expected=generation;
  const job=queue.catch(()=>{}).then(async()=>{
   activeDriver=null;const check=()=>{if(expected!==generation)throw Error('Troca de motorista pausada.');};check();
   const s=await status();check();if(!s.connected)throw Error('Conecte o celular antes de entrar no motorista.');
   const result=await require('./imile-navigation').prepare({run,serial:s.selected,login,password:vault.password(),check,startAtLogin:!!startAtLogin});check();
   activeDriver={serial:s.selected,login};return result;
  });queue=job;return job.catch(e=>({ok:false,message:e.message}));
 }
 async function locate(){const choice=await dialog.showOpenDialog(getWindow(),{title:'Selecione a pasta platform-tools',properties:['openDirectory']});if(choice.canceled)return {ok:false,message:'Seleção cancelada.'};const file=path.join(choice.filePaths[0],'adb.exe');if(!fs.existsSync(file))throw Error('Essa pasta não contém adb.exe. Selecione a pasta extraída platform-tools.');custom=file;save();return status();}
 function download(url,dest,redirects=0){return new Promise((resolve,reject)=>{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='dl.google.com'||redirects>3)return reject(Error('Endereço de download não autorizado.'));const request=https.get(url,response=>{if(response.statusCode>=300&&response.statusCode<400){response.resume();return download(new URL(response.headers.location,url).href,dest,redirects+1).then(resolve,reject);}if(response.statusCode!==200){response.resume();return reject(Error('Download indisponível. Use Localizar pasta após baixar pelo site do Google.'));}let total=0;const file=fs.createWriteStream(dest);response.on('data',chunk=>{total+=chunk.length;if(total>100*1024*1024){response.destroy(Error('Download excedeu o limite.'));}});response.on('error',e=>{file.destroy();reject(e);});file.on('error',reject);file.on('finish',()=>file.close(resolve));response.pipe(file);});request.setTimeout(30000,()=>request.destroy(Error('Download demorou demais. Tente novamente.')));request.on('error',reject);});}
 async function install({acceptedLicense}){
  if(process.platform!=='win32')throw Error('A instalação automática desta revisão é para Windows.');if(acceptedLicense!==true)throw Error('Leia e aceite os termos do Google antes de instalar.');if(installing)return installing;
  installing=(async()=>{fs.mkdirSync(root,{recursive:true});const zip=path.join(root,'platform-tools.zip');await download('https://dl.google.com/android/repository/platform-tools-latest-windows.zip',zip);const quote=v=>"'"+v.replace(/'/g,"''")+"'";const script='Expand-Archive -LiteralPath '+quote(zip)+' -DestinationPath '+quote(root)+' -Force';await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],45000);custom=path.join(root,'platform-tools','adb.exe');if(!fs.existsSync(custom))throw Error('Extração não encontrou adb.exe.');save();return status();})().finally(()=>{installing=null;});return installing;
 }
 async function guide(){await shell.openExternal('https://developer.android.com/tools/releases/platform-tools');return {ok:true};}
 return {status,pair,connect,autoUsbWifi,select,send,cancel,locate,install,guide,driverSettings,driverPassword,prepareDriver,doNotDisturb,conferenceStep};
}
function registerPhoneIPC({ipcMain,authorize,...options}){const bridge=createPhoneBridge(options);for(const method of ['status','pair','connect','autoUsbWifi','select','send','cancel','locate','install','guide','driverSettings','driverPassword','prepareDriver','doNotDisturb','conferenceStep'])ipcMain.handle('trend-phone-'+method,async(event,payload)=>{if(!authorize(event))return {ok:false,message:'Origem não autorizada.'};try{return await bridge[method](payload||{});}catch(e){return {ok:false,message:e.message,uncertain:!!e.uncertain};}});return bridge;}
module.exports={createPhoneBridge,registerPhoneIPC,endpoint,code};
