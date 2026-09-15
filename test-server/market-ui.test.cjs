const {test}=require('node:test');
const assert=require('node:assert/strict');
const {QuoteStore}=require('../market-ui');
test('automatic quotes share requests and reuse fresh prices',async()=>{
 let calls=0;const store=new QuoteStore(async symbol=>{calls++;return {symbol,price:123.45,currency:'USD'};});
 await Promise.all([store.fetch('aapl'),store.fetch('AAPL')]);await store.fetch('AAPL');
 assert.equal(calls,1);assert.equal(store.get('aapl').quote.price,123.45);
});
test('failed quotes require explicit retry and preserve useful errors',async()=>{
 let calls=0;const store=new QuoteStore(async()=>{calls++;throw new Error('Unsupported symbol');});
 await store.fetch('BAD');await store.fetch('BAD');assert.equal(calls,1);
 assert.equal(store.get('BAD').error,'Unsupported symbol');await store.fetch('BAD',true);assert.equal(calls,2);
});
test('disconnect discards late quotes from the previous connection',async()=>{
 let resolve;const store=new QuoteStore(()=>new Promise(r=>{resolve=r;}));
 const pending=store.fetch('AAPL');store.clear();resolve({price:123.45});await pending;
 assert.equal(store.get('AAPL'),undefined);
});
test('invalid ticker reports a useful error without sending a request',async()=>{
 let calls=0;const store=new QuoteStore(async()=>{calls++;});
 await store.fetch('not a ticker');assert.equal(calls,0);assert.match(store.get('not a ticker').error,/valid ticker/i);
});
