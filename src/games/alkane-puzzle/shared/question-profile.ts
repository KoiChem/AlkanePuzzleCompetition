export type Rule = {
  typeMin: number; typeMax: number; lenMin: number; lenMax: number;
  subMin: number; subMax: number; ringSizes: number[];
  cycloSubstituentCount: 0 | 1 | 2;
  gridCols?: number; gridRows?: number;
  bendMin?: number; bendMax?: number;
  shuffleWordBankGroups?: boolean;
  alcoholRate: number; hydroxylLimitOne: boolean; hydroxylCountsAsSubstituent: boolean;
};
export type QuestionProfile = {
  version: 1;
  rules: { arrange: { easy: Rule; medium: Rule }; name: { easy: Rule; medium: Rule } };
};
const easyBase = {typeMin:1,typeMax:1,lenMin:1,lenMax:6,subMin:0,subMax:4,ringSizes:[4,6],cycloSubstituentCount:0,alcoholRate:40,hydroxylLimitOne:true,hydroxylCountsAsSubstituent:true} as const;
const mediumBase = {typeMin:1,typeMax:2,lenMin:4,lenMax:8,subMin:3,subMax:6,ringSizes:[6,8],cycloSubstituentCount:1,alcoholRate:40,hydroxylLimitOne:false,hydroxylCountsAsSubstituent:true} as const;
export const DEFAULT_QUESTION_PROFILE: QuestionProfile = Object.freeze({
  version:1,
  rules:{
    arrange:{easy:{...easyBase,ringSizes:[4,6],gridCols:7,gridRows:5},medium:{...mediumBase,ringSizes:[6,8],gridCols:7,gridRows:5}},
    name:{easy:{...easyBase,ringSizes:[4,6],bendMin:0,bendMax:1,shuffleWordBankGroups:false},medium:{...mediumBase,typeMax:1,ringSizes:[6,8],bendMin:2,bendMax:3,shuffleWordBankGroups:false}}
  }
});
const isObject = (v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v);
const between = (v:unknown,min:number,max:number) => Number.isInteger(v) && Number(v)>=min && Number(v)<=max;
function checkKeys(o:Record<string,unknown>,allowed:readonly string[],required:readonly string[]=allowed) {
  if(Object.keys(o).some(k=>!allowed.includes(k)) || required.some(k=>!Object.hasOwn(o,k))) throw new TypeError('出題設定の項目が不正です');
}
export function validateQuestionProfileShape(raw:unknown):QuestionProfile {
  if(!isObject(raw)) throw new TypeError('出題設定が不正です');
  checkKeys(raw,['version','rules']);
  if(raw.version!==1 || !isObject(raw.rules)) throw new TypeError('出題設定の版が不正です');
  checkKeys(raw.rules,['arrange','name']);
  for(const mode of ['arrange','name'] as const) {
    const levels=raw.rules[mode];
    if(!isObject(levels)) throw new TypeError('難易度設定が不正です');
    checkKeys(levels,['easy','medium']);
    for(const difficulty of ['easy','medium'] as const) {
      const rule=levels[difficulty];
      if(!isObject(rule)) throw new TypeError('詳細設定が不正です');
      const common=['typeMin','typeMax','lenMin','lenMax','subMin','subMax','ringSizes','cycloSubstituentCount','alcoholRate','hydroxylLimitOne','hydroxylCountsAsSubstituent'];
      const special=mode==='arrange'?['gridCols','gridRows']:['bendMin','bendMax','shuffleWordBankGroups'];
      checkKeys(rule,[...common,...special],[...common,...special]);
      const ranges=[['typeMin','typeMax',1,6],['lenMin','lenMax',1,10],['subMin','subMax',0,10]] as const;
      for(const [low,high,min,max] of ranges) if(!between(rule[low],min,max)||!between(rule[high],min,max)||Number(rule[low])>Number(rule[high])) throw new RangeError('設定範囲が不正です');
      if(!Array.isArray(rule.ringSizes)||rule.ringSizes.length===0||new Set(rule.ringSizes).size!==rule.ringSizes.length||rule.ringSizes.some((n:unknown)=>typeof n!=='number'||![4,6,8,10].includes(n))) throw new RangeError('シクロ主鎖が不正です');
      if(typeof rule.cycloSubstituentCount!=='number'||![0,1,2].includes(rule.cycloSubstituentCount)) throw new RangeError('シクロ置換基数が不正です');
      if(!between(rule.alcoholRate,0,100)||Number(rule.alcoholRate)%10!==0) throw new RangeError('アルコール出題率が不正です');
      if(typeof rule.hydroxylLimitOne!=='boolean'||typeof rule.hydroxylCountsAsSubstituent!=='boolean') throw new TypeError('OH設定が不正です');
      if(mode==='arrange') {
        if(!between(rule.gridCols,3,7)||!between(rule.gridRows,3,5)) throw new RangeError('枠数が不正です');
      } else {
        if(!between(rule.bendMin,0,10)||!between(rule.bendMax,0,10)||Number(rule.bendMin)>Number(rule.bendMax)||typeof rule.shuffleWordBankGroups!=='boolean') throw new RangeError('折れ曲がり設定が不正です');
      }
    }
  }
  return structuredClone(raw) as QuestionProfile;
}
export function questionProfileCatalog() {
  return { modes:['arrange','name'] as const, difficulties:['easy','medium'] as const, ringSizes:[4,6,8,10] as const };
}
