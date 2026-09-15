const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createMarketClient,normalizeQuote,createServer}=require('../market-server');
const sample={symbol:'AAPL',currency:'USD',close:'123.45',timestamp:1700000000};
test('quotes are validated and never invent prices',()=>{
  assert.equal(normalizeQuote(sample,'AAPL').price,123.45);
  for(const close of ['NaN','0','-5']) assert.throws(()=>normalizeQuote({...sample,close},'AAPL'));
  assert.throws(()=>normalizeQuote(sample,'MSFT'));
});
test('same-symbol requests are cached and credentials are not returned',async()=>{
  let calls=0;const client=createMarketClient({key:'test-only',fetcher:async()=>{calls++;return {ok:true,json:async()=>sample};}});
  const first=await client.quote('AAPL'),second=await client.quote('aapl');
  assert.equal(calls,1);assert.equal(second.cached,true);assert(!JSON.stringify(first).includes('test-only'));
});
test('no key and upstream failures leave quotes unavailable',async()=>{
  const client=createMarketClient();await assert.rejects(client.quote('AAPL'),/Connect/);
  const bad=createMarketClient({key:'test-only',fetcher:async()=>({ok:false,status:429})});
  await assert.rejects(bad.quote('AAPL'),/rate limit/);
});
test('local endpoint protects keys and files',async()=>{
  const server=createServer({client:createMarketClient()});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base+'/api/market/status')).status,403);
    assert.equal((await fetch(base+'/api/market/status',{headers:{'x-model-request':'1',Origin:'https://example.com'}})).status,403);
    assert.equal((await fetch(base+'/.env')).status,404);
    const status=await fetch(base+'/api/market/status',{headers:{'x-model-request':'1'}});
    assert.equal((await status.json()).configured,false);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
