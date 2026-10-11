export function token(){return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
export function readCookie(request:Request,name:string){const values=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));return values.length===1?values[0].slice(name.length+1):null;}
export function cookie(name:string,value:string,maxAge:number){return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;}
