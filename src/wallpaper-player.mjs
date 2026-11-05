const keyOf = asset => asset ? asset.id+'\0'+(asset.revision??'') : null;

// No image library cache: one displayed image, plus one loading/fading image.
// Blob URLs are revoked when a transition ends, a request loses, or we dispose.
export function createWallpaperPlayer({win,layers,read,onDisplay,onError,reduced}) {
  let disposed=false,busy=false,wanted=null,generation=0,currentKey=null,active=0,timer=null,cancelDecode=null;
  const urls=[null,null];
  const release = index => {
    layers[index].style.backgroundImage=''; layers[index].style.opacity='0';
    if(urls[index])win.URL.revokeObjectURL(urls[index]);urls[index]=null;
  };
  function settle() {win.clearTimeout(timer);timer=null;release(1-active);if(urls[active])layers[active].style.opacity='1';}
  function decode(url) {
    return new Promise((resolve,reject)=>{
      const image=new win.Image();let finished=false;
      const timeout=win.setTimeout(()=>finish(new Error('图片解码超时')),15000);
      const finish=error=>{
        if(finished)return;finished=true;win.clearTimeout(timeout);cancelDecode=null;
        image.onload=null;image.onerror=null;image.src='';
        if(error)reject(error);else resolve();
      };
      cancelDecode=()=>finish(new Error('cancelled'));
      image.decoding='async';image.onload=()=>finish();image.onerror=()=>finish(new Error('图片无法解码'));image.src=url;
    });
  }
  async function drain() {
    if(busy || disposed)return;
    busy=true;
    try {
      while(!disposed && wanted && keyOf(wanted)!==currentKey) {
        const asset=wanted, revision=generation;let candidate=null;
        try {
          const payload=await read(asset);
          if(disposed || revision!==generation)continue;
          if(!payload?.bytes || !/^image\/(png|jpeg|webp|gif)$/.test(payload.mime))throw new Error('图片响应无效');
          candidate=win.URL.createObjectURL(new win.Blob([payload.bytes],{type:payload.mime}));
          await decode(candidate);
          if(disposed || revision!==generation)continue;
          const next=1-active;release(next);
          urls[next]=candidate;candidate=null;
          const duration=reduced()?0:700;
          for(const layer of layers)layer.style.transitionDuration=duration+'ms';
          layers[next].style.backgroundImage=`url("${urls[next]}")`;
          layers[next].style.opacity='1';layers[active].style.opacity='0';
          const old=active;active=next;currentKey=keyOf(asset);
          onDisplay(asset,urls[next]);
          win.clearTimeout(timer);timer=win.setTimeout(()=>{if(old!==active)release(old);timer=null;},duration+30);
        } catch(error) {
          if(!disposed && revision===generation){wanted=null;onError(error,asset);}
        } finally {if(candidate)win.URL.revokeObjectURL(candidate);}
      }
    } finally {busy=false;}
  }
  return {
    show(asset) {
      if(disposed || !asset)return;
      if(keyOf(asset)===keyOf(wanted))return;
      wanted=asset;generation++;if(cancelDecode)cancelDecode();
      // Finish an interrupted fade before allocating another image.
      settle();drain();
    },
    cancel() {wanted=null;generation++;if(cancelDecode)cancelDecode();settle();},
    clear() {wanted=null;generation++;currentKey=null;if(cancelDecode)cancelDecode();win.clearTimeout(timer);timer=null;onDisplay(null,null);release(0);release(1);},
    dispose() {disposed=true;wanted=null;generation++;if(cancelDecode)cancelDecode();win.clearTimeout(timer);onDisplay(null,null);release(0);release(1);},
    diagnose() {return {displayedImages:urls.filter(Boolean).length,readInFlight:busy,libraryImageCache:0};}
  };
}
