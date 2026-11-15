import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';

const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const begin=source.indexOf('app.get("/health", async (_req, res) => {');
const finish=source.indexOf('app.post("/sync/company"',begin);
assert.ok(begin>0&&finish>begin,'Health endpoint must be registered');
const app=express();
let simulateError=false;
const dbHealth=async()=>{
 if(simulateError)throw Error('postgres://secret:password@database.internal:5432/dllone');
 return {ok:true,ms:2,companies:2};
};
const register=new Function('app','dbHealth','MOTOR_URL','process',source.slice(begin,finish));
register(app,dbHealth,'http://localhost:1234',{env:{}});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
test.after(()=>new Promise(resolve=>server.close(resolve)));
const url=`http://127.0.0.1:${server.address().port}/health`;

test('public health check reports DB availability without requiring a session',async()=>{
 simulateError=false;
 const res=await fetch(url);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.ok,true);
 assert.equal(data.db.companies,2);
});

test('public health check redacts database connection errors',async()=>{
 simulateError=true;
 const res=await fetch(url);
 assert.equal(res.status,503);
 const body=await res.json();
 assert.equal(body.ok,false);
 assert.equal(body.error,'Base de datos temporalmente no disponible.');
 assert.doesNotMatch(JSON.stringify(body),/password|postgres|secret|internal/i);
});
