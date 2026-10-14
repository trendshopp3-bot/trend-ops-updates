'use strict';

function decode(s){
 return String(s||'').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);return v>=0&&v<=0x10ffff?String.fromCodePoint(v):'';})
  .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
}

function shellQuote(value){
 return "'"+String(value??'').replace(/'/g, "'\\''")+"'";
}
function nodes(xml){
 return [...String(xml||'').matchAll(/<node\b([^>]+)>?/g)].map(m=>{
  const a={};
  for(const x of m[1].matchAll(/([\w-]+)="([^"]*)"/g))a[x[1]]=decode(x[2]);
  const b=String(a.bounds||'').match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if(b&&Number(b[3])>Number(b[1])&&Number(b[4])>Number(b[2])){
   a.rect={x1:+b[1],y1:+b[2],x2:+b[3],y2:+b[4]};
   a.point=[Math.round((+b[1]+ +b[3])/2),Math.round((+b[2]+ +b[4])/2)];
  }
  return a;
 });
}
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const nodeLabel=n=>[...new Set([n?.text,n?.['content-desc']].filter(Boolean))].join('\n').trim();

function inspect(xml){
 const list=nodes(xml),texts=list.flatMap(n=>nodeLabel(n).split(/\r?\n/).map(t=>t.trim()).filter(Boolean));
 const normalized=norm(texts.join(' | '));
 const bounds=list.map(n=>n.rect).filter(Boolean);
 const width=Math.max(0,...bounds.map(b=>b.x2)),height=Math.max(0,...bounds.map(b=>b.y2));
 const candidates=list.filter(n=>(/EditText$/.test(n.class||'')||n.editable==='true')&&n.enabled!=='false'&&n.point);
 const named=candidates.filter(n=>/\bAWB\b|waybill|rastreio|codigo|código/i.test(nodeLabel(n)+' '+(n['resource-id']||'')));
 const focused=candidates.filter(n=>n.focused==='true');
 const field=named.length===1?named[0]:focused.length===1?focused[0]:candidates.length===1?candidates[0]:null;
 const appPackages=[...new Set(list.filter(n=>/imile/i.test(n.package||'')).map(n=>n.package))];
 const imile=appPackages.length>0;
 const screenMatches=texts.some(t=>/\bAWB\b|Leitura de coleta/i.test(t))||(imile&&field);

 // Mensagens já vistas ao longo da operação, com regex mais ampla para não depender
 // de uma frase única do iMile.
 const repeat=texts.find(t=>/waybill has been picked up|already (?:collected|picked up|scanned)|pedido foi coletado|ja (?:foi )?(?:coletad|lido|bipad)|já (?:foi )?(?:coletad|lido|bipad)|duplicad|repetid|coletado anteriormente|重复|已揽收/i.test(t));
 const failure=texts.find(t=>/invalid|not found|failed|inexistente|invalid|inválid|falhou|erro|error|nao permitido|não permitido|失败/i.test(t));

 // A tela AWB normal tem um botão Confirmar no rodapé. Ele NÃO é o botão do popup.
 // O popup real fica no miolo da tela; por isso só aceitamos Confirmar/OK acima de 82%.
 const confirmCandidates=list.filter(n=>/^(?:confirmacao|confirmação|confirmar|confirm|ok|entendi|continuar|fechar)$/i.test(nodeLabel(n).trim())&&n.point&&n.enabled!=='false');
 const popupConfirm=confirmCandidates
  .filter(n=>!height||(n.point[1]>height*.22&&n.point[1]<height*.82))
  .sort((a,b)=>b.point[1]-a.point[1])[0]||null;
 const dialogPresent=list.some(n=>/Dialog|AlertDialog/i.test(String(n.class||''))||/dialog|alert/i.test(String(n['resource-id']||'')));
 const popupActive=!!popupConfirm && (dialogPresent||!!repeat||!!failure||popupConfirm.point[1]<(height||1600)*.82);

 const combined=texts.find(t=>/^lido\s*[:：]?\s*\d+$/i.test(t));
 const read=texts.findIndex(t=>/^lido$/i.test(t));
 let count=combined?Number(combined.match(/\d+$/)?.[0]):null;
 if(read>=0){const nearby=texts.slice(read+1,read+4).find(t=>/^\d+$/.test(t));if(nearby!==undefined)count=+nearby;}

 const offlineNotice=normalized.includes('compromisso de operacao offline')||(normalized.includes('prometo nao assinar por falso')&&normalized.includes('responsabilidade'));
 const protectionNotice=normalized.includes('importante para protege')||(normalized.includes('falha de coleta')&&normalized.includes('registre corretamente'));
 const pendingOrdersNotice=normalized.includes('ordens nao recolhidas permanecem')||normalized.includes('ordens nao recolhidas para vendedores');
 const offlineConfirm=list.find(n=>/^(?:compromisso)(?:\s+(?:bot[aã]o|button))?$/i.test(nodeLabel(n))&&n.point&&n.enabled!=='false');
 const protectionConfirm=list.find(n=>/^(?:sim|yes)(?:\s+(?:bot[aã]o|button))?$/i.test(nodeLabel(n))&&n.point&&n.enabled!=='false');
 const pendingClose=list.filter(n=>n.point&&n.enabled!=='false'&&(/^(?:x|×|fechar|close)$/i.test(nodeLabel(n).trim())||/close|dismiss|cancel/i.test(String(n['content-desc']||'')+' '+String(n['resource-id']||''))))
  .sort((a,b)=>(b.point[0]-a.point[0])||(a.point[1]-b.point[1]))[0]||null;
 const navTops=list.filter(n=>/navigationBarBackground|navigation_bar_frame|navigation_bar$/.test(n['resource-id']||'')).map(n=>n.rect?.y1).filter(Number.isFinite);
 const navTop=navTops.filter(y=>y>height*.7).reduce((a,b)=>Math.min(a,b),height||0);
 return {field,confirm:popupActive?popupConfirm:null,popupConfirm,popupActive,repeat,failure,count,texts,screenMatches,appPackages,offlineNotice,protectionNotice,pendingOrdersNotice,offlineConfirm,protectionConfirm,pendingClose,width,height,navTop};
}

const recentScreens=new Map(),directDumpCapabilities=new Map();
function reset(){recentScreens.clear();}
function prime(serial,state){if(serial&&state?.field&&state.screenMatches)remember(serial,state);}
function remember(serial,state){if(state?.field&&state.screenMatches&&!state.offlineNotice&&!state.protectionNotice&&!state.pendingOrdersNotice&&!state.popupActive)recentScreens.set(serial,{state,at:Date.now()});}

async function transact({run,serial,value,check,forceAudit=false,delay=ms=>new Promise(r=>setTimeout(r,ms))}){
 const started=Date.now(),timing={screenMs:0,inputMs:0,snapshots:0,reusedScreen:false,popupsClosed:0,mode:'awb-1s-optimistic'};
 const result=data=>({...data,timing:{...timing,totalMs:Date.now()-started}});
 const command=async args=>{check();const out=await run(['-s',serial,...args]);check();return out;};
 const rawSnapshot=async()=>{
  const tick=Date.now();timing.snapshots++;let xml='';
  if(directDumpCapabilities.get(serial)!==false){
   try{const direct=await command(['exec-out','uiautomator','dump','--compressed','/dev/tty']);if(String(direct).includes('<hierarchy')){xml=direct;directDumpCapabilities.set(serial,true);}else directDumpCapabilities.set(serial,false);}catch{directDumpCapabilities.set(serial,false);}
  }
  if(!xml)xml=await command(['shell','sh','-c',shellQuote('uiautomator dump --compressed /sdcard/trend-imile.xml >/dev/null 2>&1; cat /sdcard/trend-imile.xml')]);
  if(!String(xml).includes('<hierarchy'))throw Error('Não foi possível ler a tela do iMile. Abra a entrada manual de AWB.');
  timing.screenMs+=Date.now()-tick;return inspect(xml);
 };
 const tapPoint=async point=>{if(!point)return false;await command(['shell','input','tap',String(Math.round(point[0])),String(Math.round(point[1]))]);return true;};
 const closeBlocking=async s=>{
  for(let i=0;i<6;i++){
   if(s.pendingOrdersNotice){await tapPoint(s.pendingClose?.point||(s.width&&s.height?[s.width*.94,s.height*.464]:null));await delay(45);timing.popupsClosed++;s=await rawSnapshot();continue;}
   if(s.protectionNotice){await tapPoint(s.protectionConfirm?.point||(s.width&&s.height?[s.width*.5,s.height*(1038/1600)]:null));await delay(45);timing.popupsClosed++;s=await rawSnapshot();continue;}
   if(s.offlineNotice){await tapPoint(s.offlineConfirm?.point||(s.width&&s.height?[s.width*.5,s.height*(1490/1600)]:null));await delay(45);timing.popupsClosed++;s=await rawSnapshot();continue;}
   return s;
  }
  return s;
 };
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))throw Error('Código inválido.');

 // O prepareDriver já localizou o AWB. No caminho normal NÃO executamos uiautomator.
 let cached=recentScreens.get(serial),before=cached&&Date.now()-cached.at<10*60*1000?cached.state:null;
 if(!before?.field||!before?.screenMatches){before=await closeBlocking(await rawSnapshot());}
 if(!before.field||!before.screenMatches)throw Error('Campo AWB não encontrado. Abra a entrada manual do iMile.');
 const [x,y]=before.field.point;
 const width=Number(before.width)||720,height=Number(before.height)||1600;
 const cx=Math.round(width*.50);

 // Região segura do popup: na tela AWB normal esta faixa fica vazia.
 // Fazemos pulsos em alturas próximas para cobrir variações do AlertDialog sem XML.
 const popupY1=Math.round(height*.585),popupY2=Math.round(height*.615),popupY3=Math.round(height*.645);
 const dels=Array(20).fill('KEYCODE_DEL').join(' ');
 const tick=Date.now();
 const script=[
  `input tap ${Math.round(x)} ${Math.round(y)}`,
  'input keyevent KEYCODE_MOVE_END',
  `input keyevent ${dels}`,
  `input text ${value}`,
  `input tap ${Math.round(x)} ${Math.round(y)}`,
  'sleep 0.025',
  'input keyevent KEYCODE_ENTER',
  // iMile está configurado em ~1000ms. Os pulsos cobrem a janela em que
  // o popup de duplicado/erro costuma aparecer. Se não houver popup,
  // estes pontos são área vazia e não alteram o fluxo.
  'sleep 0.72',
  `input tap ${cx} ${popupY1}`,
  'sleep 0.14',
  `input tap ${cx} ${popupY2}`,
  'sleep 0.14',
  `input tap ${cx} ${popupY3}`,
  'sleep 0.05'
 ].join('; ');
 await command(['shell','sh','-c',shellQuote(script)]);
 timing.inputMs+=Date.now()-tick;

 // Auditoria pesada somente em checkpoints/fim/troca de motorista.
 if(forceAudit){
  let state=await closeBlocking(await rawSnapshot());
  if(state.popupActive&&state.popupConfirm?.point){
   const message=state.repeat||state.failure||'Aviso do iMile';
   await tapPoint(state.popupConfirm.point);timing.popupsClosed++;
   await delay(60);
   state=await closeBlocking(await rawSnapshot());
   if(state.popupActive&&state.popupConfirm?.point){await tapPoint(state.popupConfirm.point);timing.popupsClosed++;}
   const clean={...before,popupActive:false,popupConfirm:null,confirm:null,repeat:null,failure:null};
   recentScreens.set(serial,{state:clean,at:Date.now()});
   return result({ok:true,delivered:true,submitted:true,confirmed:true,processed:true,code:value,outcome:'popup_confirmed',message:String(message)+' • CONFIRMAR resolvido na auditoria.'});
  }
  if(state.field&&state.screenMatches)before=state;
 }

 // Mantém a geometria conhecida para o próximo AWB. O próximo ciclo sempre
 // toca, apaga o anterior e cola o novo antes do Enter.
 recentScreens.set(serial,{state:{...before,popupActive:false,popupConfirm:null,confirm:null,repeat:null,failure:null},at:Date.now()});
 return result({ok:true,delivered:true,submitted:true,confirmed:true,processed:true,code:value,outcome:'success_fast',message:'AWB enviado em modo ~1s • próximo.'});
}

module.exports={inspect,nodes,transact,reset,prime};
