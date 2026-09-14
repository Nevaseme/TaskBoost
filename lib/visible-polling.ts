export const SNAPSHOT_INTERVAL=30000;
export const FILES_INTERVAL=60000;

export function startVisiblePolling(update:()=>Promise<boolean|void>,interval:number){
  let stopped=false,running=false,lastStarted=-Infinity,delay=interval;
  let timer:ReturnType<typeof setTimeout>|undefined;
  function schedule(){
    clearTimeout(timer);
    if(!stopped&&document.visibilityState==='visible')timer=setTimeout(()=>void run(),delay);
  }
  async function run(){
    if(stopped||running||document.visibilityState!=='visible')return;
    running=true;lastStarted=Date.now();clearTimeout(timer);
    try{delay=await update()===false?Math.min(delay*2,120000):interval;}
    catch{delay=Math.min(delay*2,120000);}
    finally{running=false;schedule();}
  }
  function wake(){
    if(document.visibilityState!=='visible'){clearTimeout(timer);return;}
    if(Date.now()-lastStarted>=1000)void run();else if(!running)schedule();
  }
  document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);window.addEventListener('pageshow',wake);
  void Promise.resolve().then(run);
  return ()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);window.removeEventListener('pageshow',wake);};
}
