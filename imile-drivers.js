'use strict';
const fs=require('fs'),path=require('path');
const DRIVERS=Object.freeze([
 {login:'D21044730701',name:'JPV - EVERTON RAFAEL DA SILVA'},
 {login:'D21044731201',name:'JPV - MARCOS DANIEL PEREIRA'},
 {login:'D21044731501',name:'JPV - EDNELSON CUSTODIO'},
 {login:'D21044732001',name:'JPV - EDUARDO GABRIEL SILVA CUSTODIO'},
 {login:'D21048046101',name:'JPV - ELVIS'},
 {login:'D21047448901',name:'JPV - MAYCON D FELIX'},
 {login:'D21047614601',name:'JPV - LEANDRO'},
 {login:'D21048168801',name:'JPV - MONALISA'},
 {login:'D21044729901',name:'JPV - TIAGO JONATAN DO NASCIMENTOS'}
]);
function createVault({directory,safeStorage}){
 const file=path.join(directory,'imile-driver-secret.json');let sessionPassword='';
 const protectedStorage=()=>{try{return !!safeStorage?.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text';}catch{return false;}};
 function password(){if(sessionPassword)return sessionPassword;if(!protectedStorage())return '';try{const data=JSON.parse(fs.readFileSync(file,'utf8'));return safeStorage.decryptString(Buffer.from(data.encrypted,'base64'));}catch{return '';}}
 function settings(){return {ok:true,drivers:DRIVERS,hasPassword:!!password(),protectedStorage:protectedStorage()};}
 function save({password:value}){if(typeof value!=='string'||!/^[\x21-\x7e]{1,128}$/.test(value)||value.includes('%s'))throw Error('Informe a senha, sem espaços, com até 128 caracteres.');sessionPassword=value;if(protectedStorage()){fs.mkdirSync(directory,{recursive:true});const data={version:1,encrypted:safeStorage.encryptString(value).toString('base64')};const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,file);}return {...settings(),message:protectedStorage()?'Senha protegida e salva neste PC.':'Senha disponível apenas até fechar o aplicativo.'};}
 return {settings,save,password};
}
function validateAllocation(rows,drivers,missing=0){
 if(missing)throw Error('Existem etiquetas sem AWB. Corrija a extração antes de distribuir.');
 if(!Array.isArray(rows)||!rows.length)throw Error('Separe os códigos iMile primeiro.');
 if(!Array.isArray(drivers)||!drivers.length)throw Error('Selecione pelo menos um motorista.');
 const seen=new Set();let total=0;
 const plan=drivers.map(d=>{const profile=DRIVERS.find(x=>x.login===d.login);if(!profile||seen.has(d.login))throw Error('Motorista inválido ou duplicado.');seen.add(d.login);if(!Number.isSafeInteger(d.count)||d.count<1)throw Error('Informe uma quantidade inteira positiva para cada motorista selecionado.');const start=total;total+=d.count;if(!Number.isSafeInteger(total))throw Error('Quantidade inválida.');return {...profile,count:d.count,start,end:total};});
 if(total!==rows.length)throw Error('Distribuição: '+total+' de '+rows.length+' etiquetas. A soma precisa ser exatamente igual ao total iMile.');
 return plan;
}
module.exports={DRIVERS,createVault,validateAllocation};
