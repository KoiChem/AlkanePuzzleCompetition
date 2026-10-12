import {expect,test} from 'vitest';
import {bindGestureNavigationGuard} from '../game/client/gesture-navigation';

function touch(type:string,count:number,cancelable=true){const event=new Event(type,{cancelable});Object.defineProperty(event,'touches',{value:Array(count).fill({})});return event;}
function wheel(deltaX:number,deltaY:number,ctrlKey=false){const event=new Event('wheel',{cancelable:true});Object.assign(event,{deltaX,deltaY,ctrlKey});return event;}
function dispatch(target:EventTarget,event:Event){target.dispatchEvent(event);return event.defaultPrevented;}

test('cancels only cancelable single-touch gestures',()=>{
 const target=new EventTarget(),dispose=bindGestureNavigationGuard(target as HTMLElement);
 try{expect(dispatch(target,touch('touchstart',1))).toBe(true);expect(dispatch(target,touch('touchmove',1))).toBe(true);expect(dispatch(target,touch('touchstart',2))).toBe(false);expect(dispatch(target,touch('touchmove',0))).toBe(false);expect(dispatch(target,touch('touchstart',1,false))).toBe(false);}finally{dispose();}
});
test('cancels horizontal wheel gestures while leaving vertical scroll and zoom intact',()=>{
 const target=new EventTarget(),dispose=bindGestureNavigationGuard(target as HTMLElement);
 try{for(const [x,y,ctrl,expected]of [[-100,0,false,true],[100,0,false,true],[1,100,false,true],[0,100,false,false],[100,0,true,false]] as const)expect(dispatch(target,wheel(x,y,ctrl))).toBe(expected);}finally{dispose();}
});
test('removes gesture suppression after repeated mount and cleanup',()=>{
 const target=new EventTarget();
 for(let i=0;i<3;i++){const dispose=bindGestureNavigationGuard(target as HTMLElement);expect(dispatch(target,touch('touchstart',1))).toBe(true);dispose();expect(dispatch(target,touch('touchstart',1))).toBe(false);expect(dispatch(target,touch('touchmove',1))).toBe(false);expect(dispatch(target,wheel(100,0))).toBe(false);}
});
