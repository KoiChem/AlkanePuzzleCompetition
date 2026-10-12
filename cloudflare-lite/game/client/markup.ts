export type MarkTool='yellow'|'green'|'red'|'blue';
export type MarkStroke={tool:MarkTool;points:{x:number;y:number}[]};
export const markStyles={yellow:{color:'rgba(255, 235, 0, .46)',width:22.5},green:{color:'rgba(120, 220, 120, .46)',width:22.5},red:{color:'rgba(240, 68, 58, .94)',width:3.2},blue:{color:'rgba(22, 141, 225, .94)',width:3.2}};
export function validStrokes(value:unknown):MarkStroke[]{
 if(!Array.isArray(value))return [];
 return value.slice(0,100).filter((s):s is MarkStroke=>!!s&&['yellow','green','red','blue'].includes(s.tool)&&Array.isArray(s.points)&&s.points.length>0&&s.points.length<=2000&&s.points.every((p:{x:number;y:number})=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1));
}
