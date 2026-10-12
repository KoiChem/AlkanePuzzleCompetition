import {useEffect,useState} from 'react';

export async function readMateAvailability():Promise<boolean>{
  const response=await fetch('/api/public-config',{cache:'no-store'});
  const data=await response.json();
  if(!response.ok||typeof data.mateEnabled!=='boolean')throw new Error('メイトマッチの設定を確認できません。再試行してください');
  return data.mateEnabled;
}

// Recheck when returning to the app; stale pages still cannot bypass the server gate.
export function useMateAvailability(){
  const [enabled,setEnabled]=useState<boolean|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let live=true,version=0;
    async function load(){const current=++version;setEnabled(null);setError('');try{const next=await readMateAvailability();if(live&&current===version)setEnabled(next);}catch(e){if(live&&current===version)setError((e as Error).message);}}
    const visible=()=>{if(document.visibilityState==='visible')void load();};
    void load();window.addEventListener('focus',load);window.addEventListener('pageshow',load);document.addEventListener('visibilitychange',visible);
    return()=>{live=false;window.removeEventListener('focus',load);window.removeEventListener('pageshow',load);document.removeEventListener('visibilitychange',visible);};
  },[retry]);
  return {enabled,error,reload:()=>setRetry(v=>v+1)};
}
