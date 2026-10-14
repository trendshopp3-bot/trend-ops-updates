'use strict';
const {nodes,inspect,reset,prime}=require('./imile-ui');
const label=n=>[...new Set([n.text,n['content-desc']].filter(Boolean))].join('\n').trim();
const quote=value=>"'"+value.replace(/'/g,"'\"'\"'")+"'";
function screen(xml){
 const list=nodes(xml),parts=list.flatMap(n=>label(n).split(/\r?\n/).map(t=>t.trim()).filter(Boolean));
 const navTops=list.filter(n=>/navigationBarBackground|navigation_bar_frame|navigation_bar$/.test(n['resource-id']||'')).map(n=>(n.bounds||'').match(/\d+/g)?.map(Number)).filter(b=>b&&b[1]>0);
 const allBottoms=list.map(n=>(n.bounds||'').match(/\d+/g)?.map(Number)).filter(Boolean).map(b=>b[3]);
 const screenBottom=Math.max(0,...allBottoms),navTop=navTops.filter(b=>b[1]>screenBottom*.75).reduce((n,b)=>Math.min(n,b[1]),screenBottom);
 for(const n of list){if(!/imile/i.test(n.package||'')||!n.point||n.point[1]<navTop)continue;const b=n.bounds.match(/\d+/g).map(Number);if(b[1]<navTop)n.point=[n.point[0],Math.round((b[1]+navTop-1)/2)];else n.point=null;}
 const editable=list.filter(n=>(/EditText$/.test(n.class||'')||n.editable==='true')&&n.enabled!=='false'&&n.point);
 const area=n=>{const b=n.bounds.match(/\d+/g).map(Number);return (b[2]-b[0])*(b[3]-b[1]);};
 const find=re=>list.filter(n=>n.point&&n.enabled!=='false'&&label(n).split(/\r?\n/).some(t=>re.test(t.trim()))).sort((a,b)=>area(a)-area(b))[0];
 const password=editable.find(n=>n.password==='true'||/senha|password/i.test(label(n)+' '+(n['resource-id']||'')))||(editable.length===2?editable[1]:null);
 const account=editable.find(n=>n!==password&&(/conta|account|login|^D\d{11}$/i.test(label(n)+' '+(n['resource-id']||''))))||(editable.length===2?editable.find(n=>n!==password):null);
 const rect=n=>{const b=String(n?.bounds||'').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);return b?{x1:+b[1],y1:+b[2],x2:+b[3],y2:+b[4],cx:Math.round((+b[1]+ +b[3])/2),cy:Math.round((+b[2]+ +b[4])/2)}:null;};
 const privacyTop=list.filter(n=>/politica de privacidade|política de privacidade|termos de uso/i.test(label(n))).map(rect).filter(Boolean).reduce((v,b)=>Math.min(v,b.y1),Infinity);
 const passRect=rect(password);
 const loginCandidates=list.filter(n=>n.point&&n.enabled!=='false'&&label(n).split(/\r?\n/).some(t=>/^(?:login|entrar)$/i.test(t.trim()))).filter(n=>{const b=rect(n);return b&&(!passRect||b.cy>passRect.cy+20)&&(!Number.isFinite(privacyTop)||b.cy<privacyTop-20);}).sort((a,b)=>(b.clickable==='true'?1:0)-(a.clickable==='true'?1:0)||area(a)-area(b));
 const loginButton=loginCandidates[0]||null,isLogin=!!(account&&password&&loginButton);
 const profile=parts.some(t=>/imagem da rede|velocidade de leitura|alterar senha|^sobre$/i.test(t));
 const identities=[...new Set(parts.flatMap(t=>t.match(/\bD\d{11}\b/g)||[]))];
 const root=list.map(n=>(n.bounds||'').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)).filter(Boolean);
 const width=Math.max(0,...root.map(b=>Number(b[3]))),height=Math.max(0,...root.map(b=>Number(b[4])));
 const noticeText=parts.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').toLowerCase();
 // Os dois avisos podem aparecer juntos. O Compromisso funciona como uma folha modal
 // sobre a tela; quando existir, ele precisa fechar antes do aviso de proteção.
 const offlineNotice=noticeText.includes('compromisso de operacao offline')||(noticeText.includes('prometo nao assinar por falso')&&noticeText.includes('responsabilidade'));
 const protectionNotice=noticeText.includes('importante para protege')||(noticeText.includes('falha de coleta')&&noticeText.includes('registre corretamente'));
 const offlineConfirm=find(/^compromisso(?:\s+(?:bot[aã]o|button))?$/i);
 const protectionConfirm=find(/^(?:sim|yes)(?:\s+(?:bot[aã]o|button))?$/i);
 // Popup novo visto após o login: "Ordens não recolhidas permanecem".
 // Ele fica por cima dos demais avisos e deve ser fechado no X antes de continuar.
 const pendingOrdersNotice=noticeText.includes('ordens nao recolhidas permanecem')||noticeText.includes('ordens nao recolhidas para vendedores');
 const pendingClose=list.filter(n=>n.point&&n.enabled!=='false'&&(
   /^(?:x|×|fechar|close)$/i.test(label(n).trim())||/close|dismiss|cancel/i.test(String(n['content-desc']||'')+' '+String(n['resource-id']||''))
  )).sort((a,b)=>(b.point[0]-a.point[0])||(a.point[1]-b.point[1]))[0]||null;
 const startupNotice=offlineNotice?'offline':protectionNotice?'protection':null;
 const noticeConfirm=startupNotice==='offline'?offlineConfirm:startupNotice==='protection'?protectionConfirm:null;
 return {list,parts,find,account,password,loginButton,isLogin,profile,identities,width,height,navTop,startupNotice,noticeConfirm,offlineNotice,protectionNotice,offlineConfirm,protectionConfirm,pendingOrdersNotice,pendingClose,awb:inspect(xml)};
}
async function prepare({run,serial,login,password,check,startAtLogin=false,delay=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!/^D\d{11}$/.test(login))throw Error('Login do motorista inválido.');
 if(!password)throw Error('Cadastre a senha dos motoristas no Trend Ops.');
 reset();
 const command=async args=>{check();try{const out=await run(['-s',serial,...args]);check();if(/SecurityException|INJECT_EVENTS|Exception occurred/i.test(out))throw Error('O Android bloqueou o controle da tela.');return out;}catch(e){e.message=String(e.message||'Falha na navegação').split(password).join('[senha protegida]');throw e;}};
 const rawSnapshot=async()=>{const xml=await command(['shell','uiautomator dump /sdcard/trend-imile.xml && cat /sdcard/trend-imile.xml']);if(!xml.includes('<hierarchy'))throw Error('Não foi possível ler a tela do iMile.');const s=screen(xml);if(!s.list.some(n=>/imile/i.test(n.package||''))){const packages=[...new Set(s.list.map(n=>n.package).filter(Boolean))].join(', ')||'nenhum pacote acessível';throw Error('Não reconheci a tela do iMile no celular selecionado. Pacotes detectados: '+packages+'. Confira o aparelho selecionado na aba Celular iMile.');}return s;};
 const tap=async n=>{if(!n?.point)throw Error('Controle não encontrado na tela.');await command(['shell','input','tap',...n.point.map(String)]);};
 const tapStartupNotice=async(s,kind,forceCoordinate=false)=>{
  const node=kind==='offline'?s.offlineConfirm:s.protectionConfirm;
  if(node?.point&&!forceCoordinate){await tap(node);return 'controle';}
  if(!s.width||!s.height)throw Error('Aviso '+kind+' reconhecido, mas não foi possível calcular a posição do botão.');
  // Fallback calibrado pela própria dimensão da tela. É usado somente quando o texto
  // do aviso foi reconhecido e o toque pelo controle não fechou o popup.
  const x=Math.round(s.width*.5);
  const y=kind==='protection'
   ?Math.round(s.height*.65)
   :Math.max(1,Math.round(Math.min(s.height*.93,(s.navTop||s.height)-34)));
  await command(['shell','input','tap',String(x),String(y)]);return 'coordenada';
 };
 const clearStartupNotices=async(initial,{settle=false}={})=>{
  let s=initial||await rawSnapshot(),emptyPasses=0;
  for(let total=0;total<18;total++){
   // Sempre fecha primeiro o popup "Ordens não recolhidas" no X.
   if(s.pendingOrdersNotice){
    if(s.pendingClose?.point)await tap(s.pendingClose);
    else if(s.width&&s.height){
     // Captura 720x1600: X ~ (676,742). Normalizado para qualquer resolução.
     await command(['shell','input','tap',String(Math.round(s.width*.94)),String(Math.round(s.height*.464))]);
    }else throw Error('Popup de ordens pendentes detectado, mas o X não pôde ser localizado.');
    await delay(120);s=await rawSnapshot();emptyPasses=0;continue;
   }
   const kind=s.protectionNotice?'protection':s.offlineNotice?'offline':null;
   if(!kind){
    if(!settle||emptyPasses>=2)return s;
    emptyPasses++;await delay(120);s=await rawSnapshot();continue;
   }
   emptyPasses=0;let closed=false;
   for(let attempt=0;attempt<3;attempt++){
    await tapStartupNotice(s,kind,attempt>0);
    await delay(150+attempt*70);
    s=await rawSnapshot();
    const still=kind==='offline'?s.offlineNotice:s.protectionNotice;
    if(!still){closed=true;break;}
   }
   if(!closed)throw Error('O aviso '+(kind==='offline'?'Compromisso':'Protection / Sim')+' não fechou. A operação foi pausada.');
  }
  if(s.pendingOrdersNotice||s.offlineNotice||s.protectionNotice)throw Error('Os avisos iniciais não fecharam. A operação foi pausada.');
  return s;
 };
 const snapshot=async()=>clearStartupNotices(await rawSnapshot());
 const back=()=>command(['shell','input','keyevent','KEYCODE_BACK']);
 const wait=async predicate=>{for(let i=0;i<6;i++){const s=await snapshot();if(predicate(s))return s;await delay(150);}throw Error('A tela do iMile não mudou como esperado. A operação foi pausada.');};
 const profile=async initial=>{let s=initial;for(let i=0;i<6;i++){if(s.isLogin||s.profile)return s;const more=s.find(/^mais$/i);if(more)await tap(more);else await back();s=await snapshot();}throw Error('Não foi possível abrir Mais para conferir o motorista.');};
 const logout=async initial=>{let s=initial;for(let i=0;i<6;i++){const exit=s.find(/^sair$|^logout$/i);if(exit){await tap(exit);s=await snapshot();if(s.isLogin)return s;const dialog=s.parts.some(t=>/deseja.*sair|certeza|encerrar.*sess|confirm.*sair/i.test(t))||s.list.some(n=>/Dialog/.test(n.class||''));if(dialog){const confirm=s.find(/^confirmar$|^sim$|^ok$|^sair$/i);if(confirm)await tap(confirm);}return wait(t=>t.isLogin);}if(!s.width||!s.height)throw Error('Não foi possível determinar o tamanho da tela.');await command(['shell','input','swipe',String(Math.round(s.width*.5)),String(Math.round(s.height*.78)),String(Math.round(s.width*.5)),String(Math.round(s.height*.3)),'250']);s=await snapshot();}throw Error('Opção Sair não encontrada em Mais.');};
 const fill=async(n,value)=>{await tap(n);await command(['shell','input','keyevent','KEYCODE_MOVE_END']);await command(['shell','input','keyevent',...Array(128).fill('KEYCODE_DEL')]);await command(['shell','input','text',String(value)]);};
 let s=await snapshot();
 if(startAtLogin&&!s.isLogin)throw Error('Primeiro motorista: deixe o iMile na tela de LOGIN antes de iniciar. Nenhum toque foi feito.');
 if(!s.isLogin){s=await profile(s);if(!s.isLogin&&(s.identities.length!==1||s.identities[0]!==login))s=await logout(s);}
 if(s.isLogin){
  await fill(s.account,login);s=await snapshot();if(!s.isLogin)throw Error('A tela de login mudou durante a digitação.');await fill(s.password,password);await back();s=await snapshot();if(!s.isLogin)throw Error('A tela de login não está disponível.');
  // As imagens enviadas já mostram os termos aceitos. Nunca aceitar termos automaticamente.
  const unchecked=s.list.find(n=>/CheckBox/.test(n.class||'')&&n.checked==='false'&&/política|privacidade|termos/i.test(label(n)));
  if(unchecked)throw Error('Aceite os termos do iMile no celular antes de iniciar.');
  await tap(s.loginButton);s=await wait(t=>!t.isLogin);
  // Alguns aparelhos mostram o aviso alguns décimos de segundo depois do login.
  // Mantém uma janela curta de observação para fechar Sim e, quando existir, Compromisso.
  s=await clearStartupNotices(s,{settle:true});
 }
 // Depois do login/popups, segue direto para Coleta. Não abre Mais apenas para validar conta.
 let collection=s.find(/^coleta$/i);
 if(collection){await tap(collection);s=await snapshot();}
 if(!s.find(/^leitura de coleta$/i)){s=await wait(t=>!!t.find(/^leitura de coleta$/i));}
 await tap(s.find(/^leitura de coleta$/i));
 s=await wait(t=>t.awb.screenMatches&&t.parts.some(t=>/leitura de coleta/i.test(t)));
 if(!s.awb.field){
  let pencil=s.find(/^editar$|^edit$|lápis|lapis|digita.*manual|entrada manual/i);
  if(!pencil){
   // Lápis sem descrição: reconhecer o único botão pequeno no canto superior direito,
   // conforme a tela fornecida; adaptar ao tamanho real e verificar o AWB depois.
   const top=[...new Map(s.list.filter(n=>n.point&&n.clickable==='true'&&n.enabled!=='false'&&n.point[0]>s.width*.82&&n.point[1]>s.height*.03&&n.point[1]<s.height*.13&&!label(n)).map(n=>[n.point.join(','),n])).values()];
   if(top.length===1)pencil=top[0];
  }
  if(!pencil)throw Error('O lápis não está acessível na leitura de coleta. Toque nele no celular e retome.');
  await tap(pencil);s=await wait(t=>!!t.awb.field&&t.awb.screenMatches);
 }
 prime(serial,s.awb);
 return {ok:true,login,message:'Motorista pronto • login antigo estável • popups • Leitura de coleta • AWB.'};
}
module.exports={prepare,screen};
