import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';
import {hash} from './store';
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:5000});
export async function verifyGoogleIdToken(encoded:string,clientId:string,nonceHash:string,jwks:JWTVerifyGetKey=keys,now=Date.now()){
 const {payload}=await jwtVerify(encoded,jwks,{issuer:['https://accounts.google.com','accounts.google.com'],audience:clientId,algorithms:['RS256'],currentDate:new Date(now),requiredClaims:['sub','exp','iat','email','email_verified','nonce']});
 if(typeof payload.iat!=='number'||payload.iat>Math.floor(now/1000)+60||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255||typeof payload.email!=='string'||payload.email.length>254||payload.email_verified!==true||typeof payload.nonce!=='string'||await hash(payload.nonce)!==nonceHash)throw new Error('Googleアカウントを確認できません');
 return {id:payload.sub,email:payload.email.trim().toLowerCase()};
}
