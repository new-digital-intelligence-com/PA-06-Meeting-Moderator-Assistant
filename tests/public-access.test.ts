import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {proxy} from '../proxy';
import {encrypt} from '../lib/seal';

process.env.SESSION_SECRET='public-access-test-only';
test('visitors can browse but cannot read or change a client workspace',()=>{
  for(const path of ['/', '/preview','/docs']) assert.equal(proxy(new NextRequest('https://ava.test'+path)).status,200);
  assert.equal(proxy(new NextRequest('https://ava.test/api/portal/setup')).status,401);
  const cookie=encrypt(JSON.stringify({user:{email:'reader@gmail.com',role:'visitor'},until:Date.now()+60000}));
  for(const path of ['/api/portal/setup','/api/auth/google']) {
    assert.equal(proxy(new NextRequest('https://ava.test'+path,{headers:{cookie:'pa_session='+cookie}})).status,403);
  }
  const page=proxy(new NextRequest('https://ava.test/client',{headers:{cookie:'pa_session='+cookie}}));
  assert.equal(new URL(page.headers.get('location')!).pathname,'/preview');
});
