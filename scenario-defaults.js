(function(root){
  function resolve(saved,preset){
    const scenario=saved?.config?saved:preset?.config?preset:null;
    return scenario?JSON.parse(JSON.stringify(scenario)):null;
  }
  const api={resolve};
  if(typeof module!=='undefined')module.exports=api;
  root.ScenarioDefaults=api;
})(typeof window!=='undefined'?window:globalThis);
