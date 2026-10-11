// Only UI positions; answers live in IndexedDB and are acknowledged separately.
export function readEditorPosition(key:string,now=Date.now()):number|null {
 try {const value=JSON.parse(localStorage.getItem('alkanecompetition-position:'+key)??'null');if(value&&value.expiresAtMs>now&&Number.isSafeInteger(value.position)&&value.position>=0)return value.position;localStorage.removeItem('alkanecompetition-position:'+key);}catch{}return null;
}
export function saveEditorPosition(key:string,position:number,expiresAtMs:number){try{localStorage.setItem('alkanecompetition-position:'+key,JSON.stringify({position,expiresAtMs}));}catch{/* Answer persistence is handled separately. */}}
export function pruneEditorPositions(now=Date.now()){try{for(const key of Object.keys(localStorage))if(key.startsWith('alkanecompetition-position:'))readEditorPosition(key.slice('alkanecompetition-position:'.length),now);}catch{}}
