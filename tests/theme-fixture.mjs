import {startTheme as startNativeTheme} from '../dist/runtime.mjs';

// jsdom has no image decoder or Blob URL registry. Native rendering is not
// asserted by these fixtures; the player lifetime and bridge are still real.
export async function startTheme(win,options) {
  let id=0;
  win.URL.createObjectURL=()=>`blob:fixture-${++id}`;
  win.URL.revokeObjectURL=()=>{};
  win.Image=class {
    set src(value){this.value=value;if(value)queueMicrotask(()=>{if(this.value===value)this.onload?.();});}
    get src(){return this.value;}
  };
  return startNativeTheme(win,options);
}
