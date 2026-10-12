// Cancel browser gestures without performing edits; Pointer Events own the answer.
export function bindGestureNavigationGuard(element:HTMLElement):()=>void{
  const touch=(event:TouchEvent)=>{
    if(event.cancelable&&event.touches.length===1)event.preventDefault();
  };
  const wheel=(event:WheelEvent)=>{
    if(event.cancelable&&event.deltaX!==0&&!event.ctrlKey)event.preventDefault();
  };
  const options={capture:true,passive:false};
  element.addEventListener('touchstart',touch,options);
  element.addEventListener('touchmove',touch,options);
  element.addEventListener('wheel',wheel,options);
  return()=>{
    element.removeEventListener('touchstart',touch,options);
    element.removeEventListener('touchmove',touch,options);
    element.removeEventListener('wheel',wheel,options);
  };
}
