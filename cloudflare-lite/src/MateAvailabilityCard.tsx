import {useEffect,useState} from 'react';
import {readMateAvailability} from './mate-availability';
import {teacherMutation,type TeacherSession} from './teacher-auth';

export function MateAvailabilityCard({session,onExpired}:{session:TeacherSession;onExpired():void}){
  const [enabled,setEnabled]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{let live=true;setError('');void readMateAvailability().then(value=>{if(live)setEnabled(value);}).catch(e=>{if(live)setError((e as Error).message);});return()=>{live=false;};},[retry]);
  async function toggle(){
    if(enabled===null||busy||!session.isMaster)return;
    setBusy(true);setError('');
    try{const data=await teacherMutation<{mateEnabled:boolean}>('/api/teacher/mate-setting','PUT',session,{enabled:!enabled});setEnabled(data.mateEnabled);}
    catch(e){if((e as {status?:number}).status===401)onExpired();else setError(e instanceof Error?e.message:'保存できません');}
    finally{setBusy(false);}
  }
  return <section className="teacher-admin-card mate-availability-card" aria-labelledby="mate-availability-title">
    <div className="teacher-card-heading"><span className="teacher-card-symbol" aria-hidden="true">⇄</span><div><p className="teacher-card-kicker">参加の管理</p><h2 id="mate-availability-title">メイトマッチの作成</h2></div></div>
    <p>生徒が新しいメイトマッチを作れるかを設定します。</p>
    <div className="teacher-availability-control"><div><strong role="status">{enabled===null?'確認中…':enabled?'新規作成を許可中':'新規作成を停止中'}</strong><span>既存のルームはそのまま続行できます。</span></div><button type="button" className="teacher-switch" role="switch" aria-label="メイトマッチの新規作成を許可" aria-checked={enabled===true} disabled={!session.isMaster||busy||enabled===null} onClick={()=>void toggle()}><span className="teacher-switch-track" aria-hidden="true"><span className="teacher-switch-thumb"/></span><span aria-hidden="true">{enabled?'ON':'OFF'}</span></button></div>
    {error&&<><p role="alert" className="error">{error}</p>{enabled===null&&<button type="button" className="teacher-text-action" onClick={()=>setRetry(v=>v+1)}>設定を再確認</button>}</>}
  </section>;
}
