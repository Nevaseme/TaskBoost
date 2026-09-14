self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function localPath(value){try{const u=new URL(value||'/',self.location.origin);return u.origin===self.location.origin?u.pathname+u.search:'/';}catch{return '/';}}
self.addEventListener('push',event=>{
 let message={title:'TaskBoost',body:'クラスからのお知らせです。',testId:'notice',url:'/'};
 try{if(event.data)message={...message,...event.data.json()};}catch{}
 event.waitUntil(self.registration.showNotification(message.title,{body:message.body,icon:'/icon-192.png',tag:message.testId,data:{url:localPath(message.url),testId:message.testId}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{
  const url=localPath(event.notification.data?.url);
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows)if(new URL(client.url).origin===self.location.origin){await client.navigate(url);return client.focus();}
  return self.clients.openWindow(url);
 })());
});
