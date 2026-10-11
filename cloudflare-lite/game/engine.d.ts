import type { Grid } from './types';
export type GeneratedStructure = { grid: Grid; name: string; parentCarbonCount: number; fellBack: false };
export type EngineOptions = {
  typeMin:number; typeMax:number; lenMin:number; lenMax:number; subMin:number; subMax:number;
  cycloLimitOne?:boolean; ringSizes:number[]; forceRingSubstituent:boolean; useBent:boolean; forceTurn:boolean;
  allowMethane:boolean; categoryWeights:{methane?:number;chain:number;cyclo:number};
  alcoholEnabled:boolean; alcoholRate:number; hydroxylLimitOne:boolean; hydroxylCountsAsSubstituent:boolean;
  maxWidth?:number; maxHeight?:number; bendRange?:[number,number]; balanceLocants?:boolean;
};
export function createAlkaneEngine(random?:()=>number): {
  generateName(grid:Grid):{ok:true;name:string}|{ok:false;error:string};
  generateStructureWithOptions(options:EngineOptions):GeneratedStructure|null;
  generateAvoidingRecentRepeat(options:EngineOptions,history:unknown[],accept?:(result:GeneratedStructure)=>boolean):GeneratedStructure|null;
  rememberQuestion(history:unknown[],result:GeneratedStructure):void;
  rememberGame1LocantProfile(result:GeneratedStructure):void;
  expectedGame2AnswerTokens(name:string):string[]|null;
  reconstructNameFromTokens(tokens:string[]):string|null;
  namedGroupSummary(name:string):{total:number;hydroxylCount:number;types:string[];signature:string;parentCarbonCount:number}|null;
  groupTypeSignature(name:string):string;
  gridExtent(grid:Grid):{w:number;h:number};
  buildGraph(grid:Grid):{nodeIds:string[];adjacency:Map<string,Set<string>>;elements:Map<string,string>};
  findRing(graph:{nodeIds:string[];adjacency:Map<string,Set<string>>}):string[];
  getActiveDirections(panel:{type:number;rotation:number}):Set<string>;
  shuffle<T>(items:T[]):T[];
  CHAIN_NAMES:string[];
  MULTIPLIER_TOKENS:string[];
  SUB_NAME_SET:Set<string>;
};
