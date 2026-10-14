'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const invoke=(channel,payload)=>ipcRenderer.invoke(channel,payload).catch(error=>({ok:false,message:error.message}));
const phone={};for(const method of ['status','pair','connect','autoUsbWifi','select','send','cancel','locate','install','guide','driverSettings','driverPassword','prepareDriver','doNotDisturb','conferenceStep'])phone[method]=payload=>invoke('trend-phone-'+method,payload);
contextBridge.exposeInMainWorld('trendOps',{
 appName:'Trend Ops',version:'1.1.6',revision:'DRIVERS-20261009-1',author:'Taka',platform:process.platform,offline:true,phone,
 getVersion:()=>invoke('trend-app-version'),checkForUpdates:()=>invoke('trend-update-check'),downloadUpdate:()=>invoke('trend-update-download'),installUpdate:()=>invoke('trend-update-install'),
 requestMicrophonePermission:()=>invoke('trend-microphone-permission'),getMicrophoneStatus:()=>invoke('trend-microphone-status'),
 onUpdateStatus(callback){if(typeof callback!=='function')return ()=>{};const listener=(_event,data)=>callback(data);ipcRenderer.on('update-status',listener);return ()=>ipcRenderer.removeListener('update-status',listener);}
});
