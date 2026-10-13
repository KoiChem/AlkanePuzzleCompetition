import {beforeEach,afterEach,test,expect,vi} from 'vitest';
let tones:any[],clicks:any[],contexts:number,state:string;
const param=()=>({value:0,setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()});
class AudioFixture {
 currentTime=10;sampleRate=1000;destination={};get state(){return state;}
 constructor(){contexts++;}addEventListener(){}resume(){state='running';return Promise.resolve();}
 createGain(){return {gain:param(),connect(){}};}
 createDynamicsCompressor(){return {threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),connect(){}};}
 createOscillator(){const n={type:'',frequency:param(),connect(){},start:vi.fn(),stop:vi.fn()};tones.push(n);return n;}
 createBuffer(_channels:number,size:number){return {getChannelData:()=>new Float32Array(size)};}
 createBufferSource(){return {buffer:null,connect(){},start(){}};}
 createBiquadFilter(){const n={type:'',frequency:param(),Q:param(),connect(){}};clicks.push(n);return n;}
}
beforeEach(()=>{vi.resetModules();tones=[];clicks=[];contexts=0;state='running';vi.stubGlobal('window',{AudioContext:AudioFixture});vi.stubGlobal('localStorage',{getItem:()=>null});});
afterEach(()=>vi.unstubAllGlobals());
test('pickup, move and delete use the original puzzle motifs',async()=>{
 const {playPanelSound}=await import('../game/client/panel-audio');playPanelSound('pickup');
 expect(tones.map(n=>[n.type,n.frequency.setValueAtTime.mock.calls[0][0],n.frequency.linearRampToValueAtTime.mock.calls[0][0]])).toEqual([['sine',480,300],['sine',660,940]]);
 expect(tones[1].start.mock.calls[0][0]-tones[0].start.mock.calls[0][0]).toBeCloseTo(.065);
 expect(clicks.map(n=>[n.frequency.value,n.Q.value])).toEqual([[2100,1.8]]);playPanelSound('move');playPanelSound('delete');
 expect(tones.slice(2).map(n=>[n.type,n.frequency.setValueAtTime.mock.calls[0][0],n.frequency.linearRampToValueAtTime.mock.calls[0][0]])).toEqual([['triangle',330,392],['triangle',250,180]]);
 expect(clicks.slice(1).map(n=>[n.frequency.value,n.Q.value])).toEqual([[1450,1],[720,.85]]);expect(contexts).toBe(1);
});
test('muted audio does not create a context',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=> 'off'});const {playPanelSound,primePanelAudio}=await import('../game/client/panel-audio');primePanelAudio();playPanelSound('pickup');expect(contexts).toBe(0);
});
test('audio API failure cannot break editing',async()=>{
 vi.stubGlobal('window',{AudioContext:class {constructor(){throw Error('Unavailable');}}});const {playPanelSound}=await import('../game/client/panel-audio');expect(()=>playPanelSound('pickup')).not.toThrow();
});

test('Undo reuses the original puzzle short descending motif',async()=>{
 const {playPanelSound}=await import('../game/client/panel-audio');playPanelSound('undo');
 expect(tones.map(n=>[n.type,n.frequency.setValueAtTime.mock.calls[0][0],n.frequency.linearRampToValueAtTime.mock.calls[0][0]])).toEqual([['triangle',520,390]]);
 expect(clicks.map(n=>[n.frequency.value,n.Q.value])).toEqual([[1300,1]]);
});
