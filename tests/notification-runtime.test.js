"use strict";
const test=require("node:test"); const assert=require("node:assert/strict");
const {deliver,id}=require("../search/notification-runtime.js");
const item={docKey:"r:42",username:"alice",snippet:"public reply",title:"Thread"};
function repository(browser=true){return {settings:async()=>({enabled:true,browser}),get:async key=>key==="r:42"?item:null};}
test("permission denial remains local and creates no browser alert",async()=>{
  const created=[]; const result=await deliver({docKeys:["r:42"],repository:repository(),
    permissions:{contains:async()=>false},notifications:{create:async(...args)=>created.push(args)},iconUrl:"icon.png"});
  assert.deepEqual(result,{delivered:0,denied:true}); assert.deepEqual(created,[]);
});
test("granted delivery deduplicates exact reply targets and exposes public metadata only",async()=>{
  const created=[]; const result=await deliver({docKeys:["r:42","r:42"],repository:repository(),
    permissions:{contains:async()=>true},notifications:{create:async(...args)=>created.push(args)},iconUrl:"icon.png"});
  assert.deepEqual(result,{delivered:1,denied:false}); assert.equal(created[0][0],id("r:42"));
  assert.deepEqual(created[0][1],{type:"basic",iconUrl:"icon.png",title:"Reply from alice",message:"public reply",contextMessage:"Thread",priority:0});
});
