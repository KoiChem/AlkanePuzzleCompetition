import {savedSoundLevel} from '../../../src/features/play/audio-feedback';
// AlkanePuzzle index.html: playPanelPickupSound / playMoveSound / playDeleteSound.
let context:AudioContext|null=null,output:GainNode|null=null,warmUntil=0;
const pending:{kind:PanelSound;at:number}[]=[];
type PanelSound='pickup'|'move'|'delete';
export function primePanelAudio(){
 if(savedSoundLevel()==='off'||typeof window==='undefined')return;
 try{
  if(!context||context.state==='closed'){
   const AC=window.AudioContext ?? (window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
   if(!AC)return;context=new AC({latencyHint:'interactive'});warmUntil=context.currentTime+.07;
   output=context.createGain();output.gain.value=.88;
   const compressor=context.createDynamicsCompressor();compressor.threshold.value=-8;compressor.knee.value=8;compressor.ratio.value=6;compressor.attack.value=.003;compressor.release.value=.12;
   output.connect(compressor);compressor.connect(context.destination);
   context.addEventListener('statechange',flush);
  }
  if(context.state!=='running')void context.resume().then(flush).catch(()=>{});
  flush();
 }catch{/* Audio must never interrupt editing. */}
}
function flush(){
 if(!context||context.state!=='running')return;
 const queued=pending.splice(0);if(savedSoundLevel()==='off')return;
 const span=queued.length?queued[queued.length-1].at-queued[0].at:0;
 for(const event of queued)try{render(event.kind,Math.max(0,event.at-queued[0].at)/1000*(span>320?320/span:1));}catch{/* Continue remaining effects. */}
}
export function playPanelSound(kind:PanelSound){
 if(savedSoundLevel()==='off')return;
 primePanelAudio();if(!context)return;
 if(context.state==='running'){try{render(kind,0);}catch{}return;}
 if(pending.length>=24)pending.shift();pending.push({kind,at:performance.now()});
}
function render(kind:PanelSound,queuedDelay:number){
 const ctx=context!,destination=output??ctx.destination,base=Math.max(ctx.currentTime,warmUntil)+queuedDelay;
 const tone=(from:number,to:number,duration:number,type:OscillatorType,volume:number,delay=0)=>{
  const osc=ctx.createOscillator(),gain=ctx.createGain(),at=base+delay;osc.type=type;
  osc.frequency.setValueAtTime(from,at);osc.frequency.linearRampToValueAtTime(to,at+duration);
  gain.gain.setValueAtTime(.001,at);gain.gain.linearRampToValueAtTime(volume,at+Math.min(.004,duration*.2));gain.gain.exponentialRampToValueAtTime(.001,at+duration);
  osc.connect(gain);gain.connect(destination);osc.start(at);osc.stop(at+duration);
 };
 const click=(freq:number,duration:number,volume:number,q:number,delay=0)=>{
  const size=Math.max(1,Math.floor(ctx.sampleRate*duration)),buffer=ctx.createBuffer(1,size,ctx.sampleRate),samples=buffer.getChannelData(0);
  for(let i=0;i<size;i++)samples[i]=(Math.random()*2-1)*Math.pow(1-i/size,2);
  const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain(),at=base+delay;
  noise.buffer=buffer;filter.type='bandpass';filter.frequency.value=freq;filter.Q.value=q;
  gain.gain.setValueAtTime(volume,at);gain.gain.exponentialRampToValueAtTime(.001,at+duration);
  noise.connect(filter);filter.connect(gain);gain.connect(destination);noise.start(at);
 };
 if(kind==='pickup'){tone(480,300,.075,'sine',.09);tone(660,940,.095,'sine',.072,.065);click(2100,.025,.12,1.8,.065);}
 else if(kind==='move'){click(1450,.035,.14,1);tone(330,392,.075,'triangle',.05);}
 else {click(720,.05,.2,.85);tone(250,180,.09,'triangle',.055);}
}
