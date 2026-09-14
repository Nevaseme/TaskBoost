export function latestRequest<T>(load:()=>Promise<T>,apply:(value:T)=>void){
  let generation=0;
  return async()=>{
    const current=++generation;
    try{const value=await load();if(current!==generation)return false;apply(value);return true;}
    catch(error){if(current===generation)throw error;return false;}
  };
}
