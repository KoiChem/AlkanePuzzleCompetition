import {createRoot} from 'react-dom/client';
import App from './App';
import '../../app/globals.css';
import './lite.css';
import {pruneEditorPositions} from './editor-position';
import {readDrafts} from './drafts';
import {recent} from './credentials';
function clean(){pruneEditorPositions();recent();try{for(const key of Object.keys(localStorage))if(key.startsWith('alkanecompetition-markup:'))localStorage.removeItem(key);}catch{}void readDrafts('', '').catch(()=>{});}
clean();window.addEventListener('pageshow',clean);
createRoot(document.getElementById('root')!).render(<App/>);
