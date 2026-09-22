export const x = JSON.stringify((function(){try{return {hasFn:typeof window.cgGetCache==="function",cb:window.cgGetCache?window.cgGetCache():null}}catch(e){return {err:String((e&&e.name)||e)}})())
