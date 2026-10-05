import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImmediateReviewList } from "../../src/features/play/ImmediateReviewList";
import type { InternalQuestion } from "../../src/games/alkane-puzzle/shared/types";

const question=(id:string,ordinal:number,name:string):InternalQuestion => ({id,ordinal,itemId:id,category:"chain",variant:"arrange",maxScore:1,
  prompt:{kind:"alkane",mode:"arrange",name,grid:null,bounds:{rows:5,cols:7},alcoholEnabled:false,values:[]},fields:[{id:"formula",type:"formula"}],answer:{type:"formula",canonical:JSON.stringify({grid:[[null]]}),accepted:[]}});

describe("immediate review cards", () => {
  it("hides future alkane prompts and canonical answers", () => {
    const html=renderToStaticMarkup(createElement(ImmediateReviewList,{questions:[question("q0",0,"表示する問題"),question("q1",1,"未来の問題")],frontier:0,fields:{"q0:formula":"passed"},disabled:false,onRetry:()=>undefined}));
    expect(html).toContain("表示する問題");expect(html).toContain("第2問：未着手");expect(html).not.toContain("未来の問題");expect(html).not.toContain('"grid"');expect(html).toContain("構造：パス・再解答する");
  });
  it("offers the passed field for retry and marks the current frontier", () => {
    const html=renderToStaticMarkup(createElement(ImmediateReviewList,{questions:[question("q0",0,"過去"),question("q1",1,"続き"),question("q2",2,"未来")],frontier:1,fields:{"q0:formula":"passedRetry"},disabled:false,onRetry:()=>undefined,onContinue:()=>undefined}));
    expect(html).toContain("再挑戦中");expect(html.match(/この問題を解く/g)).toHaveLength(1);expect(html).toContain("第2問の解答に進む");expect(html).not.toContain("未来");
  });
  it("disables continuation while answering is unavailable", () => {
    const html=renderToStaticMarkup(createElement(ImmediateReviewList,{questions:[question("q0",0,"問題")],frontier:0,fields:{},disabled:true,onRetry:()=>undefined,onContinue:()=>undefined}));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>この問題を解く<\/button>/);
  });
});
