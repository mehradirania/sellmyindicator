function generateSecureId(minLength=12,maxLength=20){
  const chars='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const length=crypto.getRandomValues(new Uint32Array(1))[0]%(maxLength-minLength+1)+minLength;
  const values=new Uint32Array(length); crypto.getRandomValues(values);
  return Array.from(values,v=>chars[v%chars.length]).join('');
}
function escapeHtml(text){
  const map={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'};
  return String(text ?? '').replace(/[&<>"']/g,m=>map[m]);
}
function getUrlParam(param){return new URLSearchParams(location.search).get(param);}
function formatPrice(price){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(price)||0);}
function shortAddress(address,head=6,tail=4){if(!address)return '';return address.length<=head+tail+3?address:`${address.slice(0,head)}...${address.slice(-tail)}`;}
function isValidTrc20Address(address){return typeof address==='string'&&/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);}
function sortProductsByDate(data){
  const list=Array.isArray(data)?data:Object.entries(data||{}).map(([id,p])=>({id,...p}));
  return list.slice().sort((a,b)=>Number(b.created_at??b.createdAt??0)-Number(a.created_at??a.createdAt??0));
}
function logPayment(data){console.log('Payment:',{timestamp:new Date().toISOString(),...data});}
