import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Settings,settingsSummary,DEFAULT_SETTINGS} from '../src/Settings';
test('persisted mixed mode is displayed as ランダム in buttons and summaries',()=>{
 const value={...DEFAULT_SETTINGS,mode:'both' as const};
 const html=renderToStaticMarkup(createElement(Settings,{value,onChange(){}}));
 expect(html).toContain('aria-pressed="true">ランダム</button>');expect(html).not.toContain('両方');
 expect(settingsSummary(value)).toContain('ランダム');expect(settingsSummary(value)).not.toContain('両方');
});
