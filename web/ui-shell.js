import {DEFAULT_PROFILE,evaluateProfile} from './gamepad-profiles.js';

// Application chrome. Commands run in the player so the UI never simulates a game state.
export function initAppShell({
  onCommand, onBeforeOpenSettings, onBeforeCloseSettings, onMenuOpen, getState, getPreferences, onLeavePage,
}) {
  const byId=id=>document.getElementById(id);
  const rail=byId('navigation-rail'), menu=byId('open-menu'), back=byId('settings-done');
  const title=byId('app-title'), logo=document.querySelector('.brand-mark');
  const game=byId('game'), canvas=byId('screen'), overlay=byId('game-overlay');
  const fps=byId('fps-counter'), home=byId('settings-home'), host=byId('snackbar-host');
  const pages=new Map([...document.querySelectorAll('main > .page')].map(page=>[page.id,page]));
  const panes=new Map([...home.parentElement.querySelectorAll('[data-settings-pane]')].map(pane=>[pane.dataset.settingsPane,pane]));
  const pageTitles={settings:'Settings',saves:'Save States',cheats:'Cheats',about:'About'};
  const paneTitles={controllers:'Input Profiles',sound:'Advanced audio',options:'Advanced system',video:'Advanced video'};
  const gameButtons=[...document.querySelectorAll('[data-needs-game]')];
  const start=byId('start-game'), startLabel=start.querySelector('span'), startIcon=start.querySelector('use');
  const fullscreen=byId('full-screen'), loadRom=home.querySelector('[data-command="open-rom"]');
  let activePage=null, activeTab=null, settingsBusy=false, detailOpener=null, homeScroll=0, profileScroll=0, profileOpener=null, profileTitle='', lastFps=0;
  const timers=new Map();

  function removeNotice(notice) {
    clearTimeout(timers.get(notice));
    timers.delete(notice);
    notice.remove();
  }
  function trimNotices() {
    const {notificationsEnabled,notificationMax}=getPreferences();
    const limit=notificationsEnabled?notificationMax:0;
    while(host.children.length>limit)removeNotice(host.firstElementChild);
  }
  function notify(message,context='') {
    const options=getPreferences();
    if(!options.notificationsEnabled)return;
    const notice=document.createElement('div');
    notice.className='snackbar';
    const label=document.createElement('span');
    label.textContent=message;
    notice.append(label);
    if(options.verboseNotifications&&context){
      const detail=document.createElement('span');
      detail.className='snackbar-context';
      detail.textContent=context;
      notice.append(detail);
    }
    host.append(notice);
    trimNotices();
    timers.set(notice,setTimeout(()=>{
      if(!getPreferences().notificationFade){removeNotice(notice);return;}
      notice.classList.add('is-dismissing');
      timers.set(notice,setTimeout(()=>removeNotice(notice),200));
    },options.notificationDuration*1000));
  }
  function report(error){notify(error.message||String(error));}
  function dispatch(command) {
    try{Promise.resolve(onCommand(command)).catch(report);}catch(error){report(error);}
  }

  function closeMenus() {
    if(!rail.open)return;
    rail.close();
    menu.setAttribute('aria-expanded','false');
    if(!menu.hidden)menu.focus({preventScroll:true});
  }
  function showMenu() {
    if(activePage||document.querySelector('dialog[open]'))return;
    onMenuOpen();
    rail.showModal();
    rail.scrollTop=0;
    menu.setAttribute('aria-expanded','true');
    byId('collapse-menu').focus({preventScroll:true});
  }
  menu.addEventListener('click',showMenu);
  byId('collapse-menu').addEventListener('click',closeMenus);
  rail.addEventListener('cancel',event=>{event.preventDefault();closeMenus();});
  rail.addEventListener('click',event=>{if(event.target===rail&&event.clientX>rail.getBoundingClientRect().right)closeMenus();});
  for(const button of document.querySelectorAll('[data-command]'))button.addEventListener('click',()=>{
    closeMenus();
    dispatch(button.dataset.command);
  });
  overlay.addEventListener('click',()=>dispatch(getState().loaded?'start-game':'open-rom'));
  for(const entry of document.querySelectorAll('.warp-entry'))entry.addEventListener('click',()=>{
    notify('Warp unavailable in the browser.',entry.querySelector('.warp-name').textContent);
  });

  function setPage(page,{focus=true}={}) {
    if(activePage!==page&&activePage)onLeavePage(activePage);
    activePage=page;
    for(const [key,element] of pages)element.hidden=key!==page;
    menu.hidden=logo.hidden=Boolean(page);
    back.hidden=!page;
    back.setAttribute('aria-label',page==='settings'&&activeTab==='profile'?'Back to Input Profiles':page==='settings'&&activeTab?'Back to Settings':'Back to game');
    game.classList.toggle('page-backdrop',Boolean(page));
    game.inert=Boolean(page);
    title.textContent=(page==='settings'&&(activeTab==='profile'?profileTitle:paneTitles[activeTab]))||pageTitles[page]||'DKC1R Web';
    window.scrollTo(0,0);
    if(focus)(page?title:getState().loaded?canvas:menu).focus({preventScroll:true});
  }
  async function openSettings(tab=null,opener=null,label='') {
    if(settingsBusy)return false;
    settingsBusy=true;
    try{
      if(await onBeforeOpenSettings(tab)===false)return false;
      if(activePage==='settings'&&!activeTab&&tab){
        detailOpener=opener;
        homeScroll=window.scrollY;
      }
      if(tab==='profile'&&activeTab==='controllers'){
        profileScroll=window.scrollY;profileOpener=opener;profileTitle=label;
      }
      activeTab=tab;
      home.hidden=Boolean(tab);
      for(const [key,pane] of panes)pane.hidden=key!==tab;
      setPage('settings');
      return true;
    }finally{settingsBusy=false;}
  }
  async function closeSettings() {
    if(activePage!=='settings')return true;
    if(settingsBusy)return false;
    settingsBusy=true;
    try{
      if(await onBeforeCloseSettings()===false)return false;
      activeTab=null;
      setPage(null);
      return true;
    }finally{settingsBusy=false;}
  }
  for(const button of home.querySelectorAll('[data-detail]'))button.addEventListener('click',()=>{
    openSettings(button.dataset.detail,button).catch(report);
  });
  async function goBack(){
    if(activePage!=='settings'){setPage(null);return;}
    if(!activeTab){await closeSettings();return;}
    if(activeTab==='profile'){
      if(await openSettings('controllers')){
        window.scrollTo(0,profileScroll);
        (profileOpener?.isConnected?profileOpener:byId('add-profile')).focus({preventScroll:true});
        profileOpener=null;profileScroll=0;
      }
      return;
    }
    if(await openSettings()){
      window.scrollTo(0,homeScroll);
      detailOpener?.focus({preventScroll:true});
      detailOpener=null;homeScroll=0;
    }
  }
  back.addEventListener('click',()=>goBack().catch(report));
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.altKey||document.querySelector('dialog[open]'))return;
    const editable=event.target.closest?.('input,select,textarea,[contenteditable="true"]');
    const key=event.key.toLowerCase(),modifier=(event.metaKey||event.ctrlKey)&&!event.shiftKey;
    const value=getState();
    if(event.key==='Escape'&&activePage){event.preventDefault();goBack().catch(report);return;}
    if(editable||activePage)return;
    let command;
    if(modifier&&key===',')command='settings';
    else if(modifier&&key==='o')command='open-rom';
    else if(event.metaKey&&event.ctrlKey&&key==='f'&&value.fullscreenAvailable)command='fullscreen';
    else if(event.code==='Space'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&event.target===canvas
      &&value.loaded&&!value.spaceIsStart&&(!value.spaceBound||!value.running))command='start-game';
    if(command){event.preventDefault();dispatch(command);}
  });
  document.addEventListener('fullscreenchange',()=>{
    if(document.fullscreenElement===game)game.append(fps,host);
    else{
      game.after(fps);
      document.body.append(host);
    }
    update();
  });

  function setFps(value){
    lastFps=value;
    const label=`${value} FPS`;
    if(fps.textContent!==label)fps.textContent=label;
  }
  function update(value=getState()) {
    const {loaded,running,hasStarted,loading,playbackBusy,playbackError,pausedReason}=value;
    const playable=loaded&&!loading&&!playbackBusy&&!playbackError&&!['error','gpu-error'].includes(pausedReason);
    const label=running?'Pause Game':hasStarted?'Resume Game':'Start Game';
    if(startLabel.textContent!==label)startLabel.textContent=label;
    const icon=running?'#pause-icon':'#play-icon';
    if(startIcon.getAttribute('href')!==icon)startIcon.setAttribute('href',icon);
    start.disabled=!playable;
    for(const button of gameButtons)button.disabled=!loaded||loading;
    fullscreen.disabled=!value.fullscreenAvailable;
    const overlayLabel=loading?'Loading ROM…':loaded?label:'Load ROM';
    const span=overlay.firstElementChild;
    if(span.textContent!==overlayLabel)span.textContent=overlayLabel;
    overlay.hidden=Boolean(running)||Boolean(loaded&&playbackError);
    overlay.disabled=Boolean(loading)||Boolean(loaded&&!playable);
    loadRom.disabled=Boolean(loading);
    fps.hidden=!getPreferences().showFps;
    if(!loaded)setFps(0);
    else if(!fps.textContent)setFps(lastFps);
  }
  return {update,notify,trimNotices,setFps,openSettings,closeSettings,openPage:setPage,goBack,
    renameProfile(titleText){profileTitle=titleText;if(activeTab==='profile')title.textContent=titleText;},
    isSettingsOpen:()=>activePage==='settings',isMenuOpen:()=>rail.open,
    isPageOpen:()=>Boolean(activePage),isSettingsBusy:()=>settingsBusy,
  };
}

// Use fresh D-pad/button edges so a held game button cannot click into a sheet.
export function createSettingsNavigation(){
  let previous=0,wasOpen=false;
  let menuHeld=true;
  return function navigate(pads,blocked,rawBits=0,onMenu=()=>{},afterClose=()=>{}){
    const dialog=document.querySelector('#settings:not([hidden]) #app-settings');
    const standard=Array.from(pads||[]).filter(p=>p?.connected!==false&&p?.mapping==='standard');
    const down=(pad,i)=>Boolean(pad.buttons[i]?.pressed||pad.buttons[i]?.value>.5||pad.buttons[i]>.5);
    const menu=standard.some(p=>down(p,16)||(down(p,9)&&down(p,8)));
    const openEdge=menu&&!menuHeld;menuHeld=menu;
    if(openEdge&&!blocked&&!dialog){onMenu();return;}
    const mask=standard.reduce((bits,pad)=>bits|evaluateProfile(DEFAULT_PROFILE,pad),rawBits);
    const pressed=mask&~previous;previous=mask;
    if(!dialog||!wasOpen||blocked||!pressed){wasOpen=Boolean(dialog);return;}
    const elements=Array.from(dialog.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary,[tabindex="0"]'))
      .filter(el=>el.getClientRects().length&&!el.closest('[hidden]')&&(!el.closest('details:not([open])')||el.tagName==='SUMMARY'));
    if(!elements.length)return;
    const focus=document.activeElement,current=elements.indexOf(focus),next=pressed&32?1:pressed&16?-1:0;
    if(next){elements[(current+next+elements.length)%elements.length].focus();return;}
    if(pressed&256){document.getElementById('settings-done').click();afterClose();return;}
    const direction=pressed&128?1:pressed&64?-1:0;
    if(direction&&focus?.tagName==='SELECT'){
      focus.selectedIndex=Math.max(0,Math.min(focus.options.length-1,focus.selectedIndex+direction));focus.dispatchEvent(new Event('change',{bubbles:true}));return;
    }
    if(direction&&focus?.matches('input[type=number],input[type=range]')){
      direction>0?focus.stepUp():focus.stepDown();focus.dispatchEvent(new Event('input',{bubbles:true}));focus.dispatchEvent(new Event('change',{bubbles:true}));return;
    }
    if(direction){elements[(current+direction+elements.length)%elements.length].focus();return;}
    if(pressed&1&&current>=0)focus.click();
  };
}
