import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';

const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const from=source.indexOf('async function companyAccessRequired(');
const to=source.indexOf('function runtimeStateToChatItem(',from);
assert.ok(from>=0&&to>from);
let accessResult=true,received=null;
const userCanAccessCompany=async (...args)=>{
 received=args;
 if(accessResult==='error')throw Error('postgres://secret:private@example:5432/db unauthorized');
 return accessResult;
};
const companyAccessRequired=new Function('userCanAccessCompany',source.slice(from,to)+'\nreturn companyAccessRequired;')(userCanAccessCompany);
const app=express();
app.use('/api/company/:companyId',(req,_res,next)=>{req.session={uid:11,role:'OPERADOR'};next();},companyAccessRequired);
app.get('/api/company/:companyId/summary',(_req,res)=>res.json({ok:true}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
test.after(()=>new Promise(resolve=>server.close(resolve)));
const url=`http://127.0.0.1:${server.address().port}/api/company/A/summary`;

test('valid membership passes through company access middleware',async()=>{
 accessResult=true;const res=await fetch(url);
 assert.equal(res.status,200);
 assert.deepEqual(received,[11,'OPERADOR','A']);
});

test('revoked membership fails closed with forbidden status',async()=>{
 accessResult=false;
 const res=await fetch(url);
 assert.equal(res.status,403);
 assert.equal((await res.json()).ok,false);
});

test('permission database failure is sanitized and never discloses internal connection details',async()=>{
 accessResult='error';
 const res=await fetch(url);
 assert.equal(res.status,503);
 const body=await res.json();
 assert.equal(body.ok,false);
 assert.match(body.error,/No se pudo verificar el acceso/);
 assert.doesNotMatch(JSON.stringify(body),/secret|postgres|private|example/);
});
