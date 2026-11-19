// A Start press belongs either to the browser host or to the game, never both.
export function createStartShortcut(){
  let identity=null,down=false,armed=false,consumed=false;
  function reset(){identity=null;down=false;armed=false;consumed=false;}
  function sample(pressed,{allowed=false,paused=false,source=null,freshPress=false}={}){
    if(source!==identity){reset();identity=source;}
    const rising=pressed&&!down;down=pressed;
    if(!pressed){consumed=false;armed=allowed;return {resume:false,suppress:false};}
    if(!allowed){armed=false;consumed=true;return {resume:false,suppress:true};}
    if(consumed)return {resume:false,suppress:true};
    // A keyboard keydown can establish a fresh press immediately. Polling a
    // controller must first observe neutral after connection or focus changes.
    if(!armed&&!freshPress){consumed=true;return {resume:false,suppress:true};}
    if(paused&&(rising||freshPress)){
      consumed=true;armed=false;return {resume:true,suppress:true};
    }
    return {resume:false,suppress:false};
  }
  return {sample,reset};
}
