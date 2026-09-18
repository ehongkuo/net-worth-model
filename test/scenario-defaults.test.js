const {test,assert}=require('./harness');
const D=require('../scenario-defaults');
test('saved scenarios take precedence over development defaults and are cloned',()=>{
 const preset={config:{salary:100},events:[{id:1}]},saved={config:{salary:200},events:[]};
 const value=D.resolve(saved,preset);assert(value.config.salary===200);value.config.salary=300;assert(saved.config.salary===200);
 const fresh=D.resolve(null,preset);assert(fresh.config.salary===100);fresh.events.pop();assert(preset.events.length===1);
 assert(D.resolve(null,null)===null);
});
